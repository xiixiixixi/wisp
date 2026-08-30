/**
 * Shiki highlighter singleton — JavaScript regex engine (no WASM startup
 * cost) with a lazily-imported core set of grammars. Code blocks outside the
 * preloaded set fall back to a plain <pre> instead of growing the bundle.
 */
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
    langs: [
      import('shiki/langs/typescript.mjs'),
      import('shiki/langs/javascript.mjs'),
      import('shiki/langs/tsx.mjs'),
      import('shiki/langs/python.mjs'),
      import('shiki/langs/rust.mjs'),
      import('shiki/langs/go.mjs'),
      import('shiki/langs/json.mjs'),
      import('shiki/langs/shellscript.mjs'),
      import('shiki/langs/css.mjs'),
      import('shiki/langs/html.mjs'),
      import('shiki/langs/markdown.mjs'),
      import('shiki/langs/yaml.mjs'),
      import('shiki/langs/sql.mjs'),
      import('shiki/langs/java.mjs'),
      import('shiki/langs/c.mjs'),
      import('shiki/langs/cpp.mjs'),
    ],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighterPromise;
}

/** Shiki language ids that resolve to the loaded grammars. */
const LOADED_LANGS = new Set([
  'typescript',
  'typescriptreact',
  'javascript',
  'javascriptreact',
  'python',
  'rust',
  'go',
  'json',
  'shellscript',
  'bash',
  'sh',
  'shell',
  'zsh',
  'css',
  'html',
  'markdown',
  'md',
  'yaml',
  'yml',
  'sql',
  'java',
  'c',
  'cpp',
]);

/** Highlight to dual-theme HTML (light + dark CSS vars, switched in CSS). */
export async function highlightCode(code: string, lang: string): Promise<string | null> {
  const id = lang.toLowerCase();
  if (!LOADED_LANGS.has(id)) return null;
  try {
    const highlighter = await getHighlighter();
    if (!highlighter.getLoadedLanguages().includes(id)) return null;
    return highlighter.codeToHtml(code, {
      lang: id,
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    });
  } catch {
    return null;
  }
}
