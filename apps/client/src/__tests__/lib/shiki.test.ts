import { afterAll, describe, expect, it, vi } from 'vitest';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { highlightCode, normalizeCodeLanguage } from '@/lib/shiki';

const highlighters = vi.hoisted(() => [] as HighlighterCore[]);
vi.mock('shiki/core', async (original) => {
  const actual = await original<typeof import('shiki/core')>();
  return {
    ...actual,
    createHighlighterCore: vi.fn(
      async (options: Parameters<typeof actual.createHighlighterCore>[0]) => {
        const highlighter = await actual.createHighlighterCore(options);
        vi.spyOn(highlighter, 'loadLanguage');
        vi.spyOn(highlighter, 'codeToHtml');
        highlighters.push(highlighter);
        return highlighter;
      },
    ),
  };
});

afterAll(() => highlighters.forEach((highlighter) => highlighter.dispose()));

describe('on-demand Shiki grammars', () => {
  it('does not initialize the highlighter for unknown or plain text languages', async () => {
    for (const language of ['unknown-lang', 'text', 'plaintext', '', '__proto__', 'constructor']) {
      expect(await highlightCode('<script>alert(1)</script>', language)).toBeNull();
    }
    expect(createHighlighterCore).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent canonical and alias loads without preloading other grammars', async () => {
    const results = await Promise.all(
      ['ts', 'typescript', ' TS '].map((language) =>
        highlightCode('const answer: number = 42;', language),
      ),
    );
    expect(results.every((html) => html?.includes('--shiki-light'))).toBe(true);
    expect(results[0]).toBe(results[1]);
    expect(createHighlighterCore).toHaveBeenCalledOnce();
    expect(vi.mocked(createHighlighterCore).mock.calls[0][0].langs).toEqual([]);
    expect(highlighters[0].loadLanguage).toHaveBeenCalledOnce();
    expect(highlighters[0].getLoadedLanguages()).toContain('typescript');
    expect(highlighters[0].getLoadedLanguages()).not.toContain('python');
    expect(highlighters[0].getLoadedLanguages()).not.toContain('jsx');
  });

  it.each([
    ['js', 'javascript', '// Ready\nconst answer = 42;'],
    ['tsx', 'tsx', 'const view = <Button label="Save" />;'],
    ['typescriptreact', 'tsx', 'const view: JSX.Element = <Button />;'],
    ['jsx', 'jsx', 'const view = <Button label="Save" />;'],
    ['javascriptreact', 'jsx', 'const view = <Button />;'],
    ['py', 'python', 'def greet(name):\n    return "Hello " + name'],
    ['sh', 'shellscript', 'echo "$HOME"'],
    ['bash', 'shellscript', 'echo "hello"'],
    ['yml', 'yaml', 'enabled: true'],
    ['c++', 'cpp', 'int answer = 42;'],
  ])('loads %s using the actual %s grammar', async (alias, canonical, code) => {
    expect(normalizeCodeLanguage(alias)).toBe(canonical);
    const html = await highlightCode(code, alias);
    expect(html).toContain('--shiki-light:');
    expect(html).toContain('--shiki-dark:');
    expect(highlighters[0].codeToHtml).toHaveBeenLastCalledWith(code, {
      lang: canonical,
      themes: { light: 'github-light-default', dark: 'github-dark-default' },
      defaultColor: false,
    });
    const result = document.createElement('div');
    result.innerHTML = html!;
    expect(result.querySelector('pre')?.textContent).toBe(code);
    expect(result.querySelector('Button')).toBeNull();
    if (canonical === 'javascript') {
      const tokens = Array.from(result.querySelectorAll<HTMLElement>('span[style]'));
      const comment = tokens.find((token) => token.textContent === '// Ready');
      const keyword = tokens.find((token) => token.textContent === 'const');
      expect(comment?.style.getPropertyValue('--shiki-light').toLowerCase()).toBe('#57606a');
      expect(comment?.style.getPropertyValue('--shiki-dark').toLowerCase()).toBe('#8b949e');
      expect(keyword?.style.getPropertyValue('--shiki-light').toLowerCase()).toBe('#cf222e');
      expect(keyword?.style.getPropertyValue('--shiki-dark').toLowerCase()).toBe('#ff7b72');
    }
  });

  it('escapes HTML markup and script content while keeping dual-theme tokens', async () => {
    const code = '<img src=x onerror="alert(1)"><script>alert("unsafe & text")</script>';
    const html = await highlightCode(code, 'html');
    expect(html).not.toBeNull();
    const result = document.createElement('div');
    result.innerHTML = html!;
    expect(result.querySelector('img, script, [onerror]')).toBeNull();
    expect(result.querySelector('pre')?.textContent).toBe(code);
    expect(result.querySelector('[style*="--shiki-light"]')).not.toBeNull();
    expect(result.querySelector('[style*="--shiki-dark"]')).not.toBeNull();
  });

  it('falls back after a grammar load failure and permits a later retry', async () => {
    const highlighter = highlighters[0];
    vi.mocked(highlighter.loadLanguage).mockRejectedValueOnce(new Error('Chunk unavailable'));
    expect(await highlightCode('{"answer":42}', 'json')).toBeNull();
    expect(highlighter.getLoadedLanguages()).not.toContain('json');
    expect(await highlightCode('{"answer":42}', 'json')).toContain('--shiki-light:');
    expect(highlighter.getLoadedLanguages()).toContain('json');
  });
});
