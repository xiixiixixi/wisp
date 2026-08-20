import { describe, it, expect, vi } from 'vitest';
import { buildWeblocXml, uniqueDroppedName, parseBrowserDrop } from '@/lib/drag-drop-content';

const fakeDataTransfer = (overrides: Partial<DataTransfer> = {}): DataTransfer =>
  ({
    types: [],
    getData: () => '',
    files: [],
    ...overrides,
  }) as unknown as DataTransfer;

describe('drag-drop-content', () => {
  describe('buildWeblocXml', () => {
    it('wraps the URL in a macOS webloc plist', () => {
      const xml = buildWeblocXml('https://example.com/a?b=1&c=2');
      expect(xml).toContain('<key>URL</key>');
      expect(xml).toContain('<string>https://example.com/a?b=1&amp;c=2</string>');
      expect(xml).toContain('<!DOCTYPE plist');
    });
  });

  describe('uniqueDroppedName', () => {
    it('appends a timestamp so repeated drops never collide', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-20T12:00:00Z'));
      const name = uniqueDroppedName('/home/user/docs', 'dropped-text', 'txt');
      expect(name).toBe('/home/user/docs/dropped-text-1787227200000.txt');
      vi.useRealTimers();
    });
  });

  describe('parseBrowserDrop', () => {
    it('parses a URL drag into a webloc plan', async () => {
      const dt = fakeDataTransfer({
        types: ['text/uri-list'],
        getData: (type: string) => (type === 'text/uri-list' ? 'https://example.com\n' : ''),
      });
      const plan = await parseBrowserDrop(dt);
      expect(plan?.kind).toBe('url');
      if (plan?.kind === 'url') expect(plan.content).toContain('https://example.com');
    });

    it('parses a text drag into a text plan', async () => {
      const dt = fakeDataTransfer({
        types: ['text/plain'],
        getData: (type: string) => (type === 'text/plain' ? 'hello wisp' : ''),
      });
      const plan = await parseBrowserDrop(dt);
      expect(plan).toEqual({ kind: 'text', content: 'hello wisp' });
    });

    it('parses an image blob into a binary plan with the right extension', async () => {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const dt = fakeDataTransfer({
        types: ['Files'],
        files: [
          {
            type: 'image/png',
            arrayBuffer: async () => bytes.buffer,
          } as unknown as File,
        ],
      });
      const plan = await parseBrowserDrop(dt);
      expect(plan).toEqual({ kind: 'image', bytes: [0x89, 0x50, 0x4e, 0x47], ext: 'png' });
    });

    it('maps jpeg mime type to jpg extension', async () => {
      const dt = fakeDataTransfer({
        files: [
          {
            type: 'image/jpeg',
            arrayBuffer: async () => new Uint8Array([1]).buffer,
          } as unknown as File,
        ],
      });
      const plan = await parseBrowserDrop(dt);
      if (plan?.kind === 'image') expect(plan.ext).toBe('jpg');
    });

    it('returns null for unknown content', async () => {
      const plan = await parseBrowserDrop(fakeDataTransfer());
      expect(plan).toBeNull();
    });

    it('prefers URL over text when both are present', async () => {
      const dt = fakeDataTransfer({
        types: ['text/uri-list', 'text/plain'],
        getData: (type: string) => (type === 'text/uri-list' ? 'https://example.com' : 'some text'),
      });
      const plan = await parseBrowserDrop(dt);
      expect(plan?.kind).toBe('url');
    });
  });
});
