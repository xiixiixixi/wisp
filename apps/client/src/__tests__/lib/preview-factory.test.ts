import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PreviewFactory,
  defaultPreviewFactory,
  type PreviewType,
  type PreviewCapability,
} from '@/lib/preview-factory';
import type { FileEntry } from '@/lib/tauri-api';

// Mock all the dynamic imports that preview-factory uses
vi.mock('@/components/previews/ImagePreview', () => ({ default: () => null }));
vi.mock('@/components/previews/PdfPreview', () => ({ default: () => null }));
vi.mock('@/components/previews/DocumentPreview', () => ({ default: () => null }));
vi.mock('@/components/previews/SpreadsheetPreview', () => ({ default: () => null }));
vi.mock('@/components/previews/TextPreview', () => ({ default: () => null }));
vi.mock('@/components/previews/CodePreview', () => ({ default: () => null }));
vi.mock('@/components/previews/CsvPreview', () => ({ default: () => null }));
vi.mock('@/components/previews/JsonPreview', () => ({ default: () => null }));
vi.mock('@/components/previews/MarkdownPreview', () => ({ default: () => null }));
vi.mock('@/components/previews/HtmlPreview', () => ({ default: () => null }));
vi.mock('@/components/previews/VideoPreview', () => ({ default: () => null }));
vi.mock('@/components/previews/AudioPreview', () => ({ default: () => null }));
vi.mock('@/components/previews/IworkPreview', () => ({ default: () => null }));
vi.mock('@/components/previews/FontPreview', () => ({ default: () => null }));
vi.mock('@/components/previews/ArchivePreview', () => ({ default: () => null }));
vi.mock('@/components/previews/PlistPreview', () => ({ default: () => null }));
vi.mock('@/components/previews/ContactPreview', () => ({ default: () => null }));
vi.mock('@/components/previews/QuickLookPreview', () => ({ default: () => null }));

const makeFile = (name: string, overrides: Partial<FileEntry> = {}): FileEntry => {
  return {
    name,
    path: `/home/user/${name}`,
    is_dir: false,
    size: 1000,
    modified: Date.now(),
    file_type: 'file',
    ...overrides,
  };
};

describe('PreviewFactory', () => {
  let factory: PreviewFactory;

  beforeEach(() => {
    factory = new PreviewFactory();
  });

  describe('getFileType', () => {
    // Image types
    it.each([
      'jpg',
      'jpeg',
      'png',
      'gif',
      'bmp',
      'webp',
      'svg',
      'ico',
      'tiff',
      // Finder-parity: WebKit-native newer formats
      'avif',
      'heic',
      'heif',
      'tif',
      // Finder-parity via the ImageIO conversion bridge
      'psd',
      'dng',
      'cr2',
      'cr3',
      'nef',
      'arw',
      'rw2',
      'raf',
      'orf',
      'exr',
      'icns',
    ])('identifies .%s as image', (ext) => {
      expect(factory.getFileType(makeFile(`photo.${ext}`))).toBe('image');
    });

    // PDF
    it('identifies .pdf as pdf', () => {
      expect(factory.getFileType(makeFile('doc.pdf'))).toBe('pdf');
    });

    // Document types
    it.each(['docx', 'doc', 'odt', 'rtf', 'rtfd', 'webarchive'])(
      'identifies .%s as document',
      (ext) => {
        expect(factory.getFileType(makeFile(`file.${ext}`))).toBe('document');
      },
    );

    // Spreadsheet types
    it.each(['xlsx', 'xls', 'ods'])('identifies .%s as spreadsheet', (ext) => {
      expect(factory.getFileType(makeFile(`data.${ext}`))).toBe('spreadsheet');
    });

    // Text types
    it.each(['txt', 'log', 'ini', 'cfg', 'conf'])('identifies .%s as text', (ext) => {
      expect(factory.getFileType(makeFile(`readme.${ext}`))).toBe('text');
    });

    // Code types
    it.each([
      'js',
      'ts',
      'jsx',
      'tsx',
      'py',
      'java',
      'cpp',
      'c',
      'cs',
      'php',
      'rb',
      'go',
      'rs',
      'css',
      'scss',
      'less',
      'vue',
      'svelte',
      // Finder-parity additions
      'xml',
      'yml',
      'yaml',
      'diff',
      'patch',
      'ps1',
      'lua',
      'h',
      'hpp',
      'm',
      'mm',
    ])('identifies .%s as code', (ext) => {
      expect(factory.getFileType(makeFile(`app.${ext}`))).toBe('code');
    });

    it.each([
      'main.mjs',
      'main.cjs',
      'main.mts',
      'main.cts',
      'Makefile',
      'GNUmakefile',
      'Dockerfile',
      'Dockerfile.dev',
      'Containerfile',
      'Containerfile.prod',
      '.env',
      '.env.local',
      '.gitignore',
      '.gitattributes',
      '.gitconfig',
      '.editorconfig',
      '.bashrc',
      '.zshrc',
      'Gemfile',
      'Rakefile',
    ])('routes source or config file %s to a text-capable preview', (name) => {
      const file = makeFile(name);
      expect(factory.getFileType(file)).toBe('code');
      expect(factory.canPreview(file)).toBe(true);
    });

    it('does not guess a code preview for an unknown binary format', () => {
      expect(factory.getFileType(makeFile('workspace.fig'))).toBe('unknown');
      expect(factory.canPreview(makeFile('workspace.fig'))).toBe(false);
    });

    // HTML renders in its own sandboxed preview instead of showing markup
    it('identifies .html and .htm as html', () => {
      expect(factory.getFileType(makeFile('index.html'))).toBe('html');
      expect(factory.getFileType(makeFile('page.htm'))).toBe('html');
    });

    // CSV/TSV
    it('identifies .csv as csv', () => {
      expect(factory.getFileType(makeFile('data.csv'))).toBe('csv');
    });

    it('identifies .tsv as csv', () => {
      expect(factory.getFileType(makeFile('data.tsv'))).toBe('csv');
    });

    // JSON
    it.each(['json', 'jsonl', 'ndjson', 'ipynb'])('identifies .%s as json', (ext) => {
      expect(factory.getFileType(makeFile(`config.${ext}`))).toBe('json');
    });

    // Markdown
    it.each(['md', 'markdown', 'mdown', 'mkd'])('identifies .%s as markdown', (ext) => {
      expect(factory.getFileType(makeFile(`README.${ext}`))).toBe('markdown');
    });

    // Video types
    it.each(['mp4', 'webm', 'mkv', 'avi', 'mov', 'm4v', 'ogv', 'mpg', 'mpeg', '3gp'])(
      'identifies .%s as video',
      (ext) => {
        expect(factory.getFileType(makeFile(`clip.${ext}`))).toBe('video');
      },
    );

    // Audio types
    it.each([
      'mp3',
      'wav',
      'ogg',
      'flac',
      'm4a',
      'aac',
      'wma',
      'opus',
      'aiff',
      'aif',
      'caf',
      'm4r',
      'ac3',
    ])('identifies .%s as audio', (ext) => {
      expect(factory.getFileType(makeFile(`song.${ext}`))).toBe('audio');
    });

    // iWork documents — embedded QuickLook PDF
    it.each(['pages', 'numbers', 'key'])('identifies .%s as iwork', (ext) => {
      expect(factory.getFileType(makeFile(`document.${ext}`))).toBe('iwork');
    });

    // Fonts
    it.each(['ttf', 'otf', 'ttc', 'woff', 'woff2'])('identifies .%s as font', (ext) => {
      expect(factory.getFileType(makeFile(`typeface.${ext}`))).toBe('font');
    });

    // Archives
    it.each(['zip', 'jar', 'apk'])('identifies .%s as archive', (ext) => {
      expect(factory.getFileType(makeFile(`bundle.${ext}`))).toBe('archive');
    });

    // Property lists
    it.each(['plist', 'strings', 'mobileconfig'])('identifies .%s as plist', (ext) => {
      expect(factory.getFileType(makeFile(`settings.${ext}`))).toBe('plist');
    });

    // Contact/calendar cards
    it.each(['vcf', 'vcard', 'ics', 'ical'])('identifies .%s as contact', (ext) => {
      expect(factory.getFileType(makeFile(`card.${ext}`))).toBe('contact');
    });

    // Quick Look thumbnail fallback types
    it.each(['ppt', 'pptx', 'ppsx', 'usdz', 'icc'])('identifies .%s as quicklook', (ext) => {
      expect(factory.getFileType(makeFile(`deck.${ext}`))).toBe('quicklook');
    });

    // Folders
    it('identifies directories as folder', () => {
      expect(factory.getFileType(makeFile('mydir', { is_dir: true }))).toBe('folder');
    });

    // Unknown
    it('returns unknown for unrecognized extensions', () => {
      expect(factory.getFileType(makeFile('file.xyz'))).toBe('unknown');
    });

    // MIME type fallback
    it('identifies by mime_type when extension does not match', () => {
      const file = makeFile('noext', { mime_type: 'image/png' });
      expect(factory.getFileType(file)).toBe('image');
    });

    it('uses mime_type for code detection (text/*)', () => {
      const file = makeFile('file.unknown', { mime_type: 'text/x-python' });
      expect(factory.getFileType(file)).toBe('code');
    });
  });

  describe('canPreview', () => {
    it('returns true for previewable files', () => {
      expect(factory.canPreview(makeFile('photo.jpg'))).toBe(true);
      expect(factory.canPreview(makeFile('doc.pdf'))).toBe(true);
      expect(factory.canPreview(makeFile('app.ts'))).toBe(true);
    });

    it('returns false for directories', () => {
      expect(factory.canPreview(makeFile('dir', { is_dir: true }))).toBe(false);
    });

    it('returns false for unknown file types', () => {
      expect(factory.canPreview(makeFile('file.xyz123'))).toBe(false);
    });

    it('returns false for files exceeding maxFileSize', () => {
      const bigFile = makeFile('huge.jpg', { size: 500 * 1024 * 1024 }); // > 200MB image cap
      expect(factory.canPreview(bigFile)).toBe(false);
    });

    it('applies per-type size caps instead of the global cap', () => {
      // 100MB used to be blocked by the global 50MB limit; images allow 200MB
      expect(factory.canPreview(makeFile('big.jpg', { size: 100 * 1024 * 1024 }))).toBe(true);
      // Videos preview up to 2GB like Finder's Quick Look
      expect(factory.canPreview(makeFile('movie.mp4', { size: 1.5 * 1024 * 1024 * 1024 }))).toBe(
        true,
      );
      // Code stays bounded at 10MB
      expect(factory.canPreview(makeFile('huge.ts', { size: 20 * 1024 * 1024 }))).toBe(false);
    });

    it('respects custom maxFileSize configuration', () => {
      const smallFactory = new PreviewFactory({ maxFileSize: 500 });
      const file = makeFile('small.txt', { size: 1000 });
      expect(smallFactory.canPreview(file)).toBe(false);
    });
  });

  describe('getPreviewComponent', () => {
    it('returns a component for previewable files', async () => {
      const component = await factory.getPreviewComponent(makeFile('photo.jpg'));
      expect(component).toBeDefined();
    });

    it('returns null for unknown file types', async () => {
      const component = await factory.getPreviewComponent(makeFile('file.xyz'));
      expect(component).toBeNull();
    });

    it('returns null for directories', async () => {
      const component = await factory.getPreviewComponent(makeFile('dir', { is_dir: true }));
      expect(component).toBeNull();
    });

    it('resolves components for every Finder-parity type', async () => {
      for (const name of [
        'photo.heic',
        'doc.rtf',
        'paper.pages',
        'typeface.otf',
        'bundle.zip',
        'settings.plist',
        'card.vcf',
        'deck.pptx',
      ]) {
        const component = await factory.getPreviewComponent(makeFile(name));
        expect(component, `${name} should resolve a preview component`).toBeDefined();
      }
    });
  });

  describe('registerPreview', () => {
    it('registers a custom preview capability', () => {
      const customCapability: PreviewCapability = {
        type: 'code' as PreviewType, // Override code
        extensions: ['custom'],
        priority: 100,
        canPreview: (file) => file.name.endsWith('.custom'),
        getPreviewComponent: () => Promise.resolve(() => null),
      };

      factory.registerPreview(customCapability);

      // The custom extension should now be recognized
      const file = makeFile('test.custom');
      expect(factory.getFileType(file)).toBe('code');
    });
  });

  describe('unregisterPreview', () => {
    it('removes a preview capability', () => {
      factory.unregisterPreview('image');

      // Image files should now be unknown
      expect(factory.getFileType(makeFile('photo.jpg'))).not.toBe('image');
    });
  });

  describe('custom config', () => {
    it('respects enabledTypes configuration', () => {
      const limitedFactory = new PreviewFactory({
        enabledTypes: ['image', 'pdf'],
      });

      expect(limitedFactory.getFileType(makeFile('photo.jpg'))).toBe('image');
      expect(limitedFactory.getFileType(makeFile('doc.pdf'))).toBe('pdf');
      // Code is not in enabledTypes, so it becomes unknown
      expect(limitedFactory.getFileType(makeFile('app.ts'))).toBe('unknown');
    });
  });

  describe('defaultPreviewFactory', () => {
    it('is a PreviewFactory instance', () => {
      expect(defaultPreviewFactory).toBeInstanceOf(PreviewFactory);
    });

    it('can identify common file types', () => {
      expect(defaultPreviewFactory.getFileType(makeFile('image.png'))).toBe('image');
      expect(defaultPreviewFactory.getFileType(makeFile('doc.pdf'))).toBe('pdf');
      expect(defaultPreviewFactory.getFileType(makeFile('app.js'))).toBe('code');
      expect(defaultPreviewFactory.getFileType(makeFile('data.json'))).toBe('json');
    });
  });

  describe('priority handling', () => {
    it('csv has higher priority than spreadsheet for .csv files', () => {
      // CSV capability has priority 10, spreadsheet has priority 9
      // csv includes 'csv' in its extensions, and spreadsheet also includes 'csv'
      // CSV should win because it has higher priority
      const result = factory.getFileType(makeFile('data.csv'));
      expect(result).toBe('csv');
    });
  });
});
