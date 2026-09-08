import { describe, expect, it } from 'vitest';
import { addressToWebUrl } from '@/lib/address-url';

describe('addressToWebUrl', () => {
  it.each([
    ['github.com', 'https://github.com/'],
    ['linear.app', 'https://linear.app/'],
    ['bun.sh', 'https://bun.sh/'],
    ['docs.rs', 'https://docs.rs/'],
    [' www.apple.com ', 'https://www.apple.com/'],
    [
      'github.com/xiixiixixi/wisp?tab=readme#top',
      'https://github.com/xiixiixixi/wisp?tab=readme#top',
    ],
    ['example.com/My Folder', 'https://example.com/My%20Folder'],
    ['例子.中国', 'https://xn--fsqu00a.xn--fiqs8s/'],
    ['localhost:5190', 'http://localhost:5190/'],
    ['127.0.0.1:5190/?demo=1', 'http://127.0.0.1:5190/?demo=1'],
    ['192.168.1.20:8080', 'http://192.168.1.20:8080/'],
    ['[::1]:3000', 'http://[::1]:3000/'],
    ['printer.local', 'http://printer.local/'],
    ['https://localhost:8443', 'https://localhost:8443/'],
    ['http://example.com/path', 'http://example.com/path'],
    ['https://readme.md', 'https://readme.md/'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(addressToWebUrl(input)).toBe(expected);
  });

  it.each([
    '',
    'Documents',
    'report.pdf',
    'notes.md',
    'main.ts',
    '.env',
    '/Users/test/example.com',
    '~/example.com',
    './example.com',
    '../example.com',
    'C:\\Users\\test',
    'C:/Users/test',
    '\\\\server\\share',
    '//server/share',
    'wisp://home',
    'gdrive://folder',
    'user@example.com',
    'javascript:alert(1)',
    'data:text/html,<h1>hi</h1>',
    'ftp://example.com',
    'https://',
    'example..com',
    '-bad.com',
    '127.1',
    '010.0.0.1',
    '999.999.999.999',
    'example.com:99999',
    'https://example.com\n.evil.com',
  ])('keeps non-web or ambiguous input %s out of implicit URL navigation', (input) => {
    expect(addressToWebUrl(input)).toBeNull();
  });
});
