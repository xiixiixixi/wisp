import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatFileListDate } from '@/lib/file-date-format';

const locale = vi.hoisted(() => ({ value: 'en-US' }));
vi.mock('@/lib/locale', () => ({ getAppLocale: () => locale.value }));

const seconds = (date: Date) => date.getTime() / 1000;

describe('formatFileListDate', () => {
  beforeEach(() => {
    locale.value = 'en-US';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 2, 14, 30));
  });

  afterEach(() => vi.useRealTimers());

  it.each([
    { hour: 0, minute: 5, expected: '00:05' },
    { hour: 3, minute: 7, expected: '03:07' },
    { hour: 12, minute: 0, expected: '12:00' },
    { hour: 23, minute: 59, expected: '23:59' },
  ])('shows today as padded 24-hour time ($expected)', ({ hour, minute, expected }) => {
    expect(formatFileListDate(seconds(new Date(2026, 9, 2, hour, minute)))).toBe(expected);
  });

  it('converts file timestamp seconds to JavaScript milliseconds exactly once', () => {
    expect(formatFileListDate(seconds(new Date(2026, 9, 2, 12, 7, 59, 123)))).toBe('12:07');
  });

  it.each(['en-US', 'zh-CN', 'ja-JP', 'ko-KR'])(
    'keeps 24-hour time independent of the %s date locale',
    (value) => {
      locale.value = value;
      expect(formatFileListDate(seconds(new Date(2026, 9, 2, 17, 40)))).toBe('17:40');
    },
  );

  it('keeps the previous compact month and day style for yesterday', () => {
    expect(formatFileListDate(seconds(new Date(2026, 9, 1, 23, 59)))).toBe('Oct 1');
  });

  it('does not mistake a future calendar day for today', () => {
    expect(formatFileListDate(seconds(new Date(2026, 9, 3, 0, 1)))).toBe('Oct 3');
  });

  it('compares the year as well as the month and day', () => {
    expect(formatFileListDate(seconds(new Date(2025, 9, 2, 14, 30)))).toBe('Oct 2');
  });

  it('uses the local calendar across midnight instead of a rolling 24-hour window', () => {
    vi.setSystemTime(new Date(2026, 9, 2, 0, 1));
    expect(formatFileListDate(seconds(new Date(2026, 9, 1, 23, 59)))).toBe('Oct 1');
    expect(formatFileListDate(seconds(new Date(2026, 9, 2, 0, 0)))).toBe('00:00');
  });

  it('handles midnight at the year boundary', () => {
    vi.setSystemTime(new Date(2027, 0, 1, 0, 1));
    expect(formatFileListDate(seconds(new Date(2026, 11, 31, 23, 59)))).toBe('Dec 31');
    expect(formatFileListDate(seconds(new Date(2027, 0, 1, 0, 0)))).toBe('00:00');
  });

  it.each([NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER])(
    'returns a placeholder for an invalid timestamp (%s)',
    (timestamp) => {
      expect(formatFileListDate(timestamp)).toBe('\u2014');
    },
  );

  it.each([0, -1])('preserves valid epoch and pre-epoch dates (%s)', (timestamp) => {
    const previousLabel = new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    expect(formatFileListDate(timestamp)).toBe(previousLabel);
  });
});
