/**
 * Shiki highlighter singleton — JavaScript regex engine (no WASM startup
 * cost). Only the requested grammar and its dependencies are imported.
 */
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { bundledLanguagesInfo } from 'shiki/langs';

let highlighterPromise: Promise<HighlighterCore> | null = null;
const languageLoads = new Map<string, Promise<void>>();
const languages = new Map(
  bundledLanguagesInfo.flatMap((language) =>
    [language.id, ...(language.aliases ?? [])].map((id) => [id, language] as const),
  ),
);
// Editor language ids aren't included in Shiki's fence aliases.
const editorAliases: Record<string, string> = {
  typescriptreact: 'tsx',
  javascriptreact: 'jsx',
};

const resolveLanguage = (lang: string) => {
  const id = lang.trim().toLowerCase();
  return languages.get(Object.hasOwn(editorAliases, id) ? editorAliases[id] : id);
};

/** Canonical grammar id, shared by aliases and concurrent load requests. */
export const normalizeCodeLanguage = (lang: string): string | null =>
  resolveLanguage(lang)?.id ?? null;

export const getCodeLanguageLabel = (lang: string): string | null =>
  resolveLanguage(lang)?.name ?? null;

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [
      import('shiki/themes/github-light-default.mjs').then(({ default: theme }) => ({
        ...theme,
        // GitHub's light comments need slightly more ink on our pearl code surface.
        tokenColors: [
          ...(theme.tokenColors ?? []),
          {
            scope: ['comment', 'punctuation.definition.comment', 'string.comment'],
            settings: { foreground: '#57606a' },
          },
        ],
      })),
      import('shiki/themes/github-dark-default.mjs'),
    ],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  }).catch((error) => {
    highlighterPromise = null;
    throw error;
  });
  return highlighterPromise;
}

/** Highlight to dual-theme HTML (light + dark CSS vars, switched in CSS). */
export async function highlightCode(code: string, lang: string): Promise<string | null> {
  const language = resolveLanguage(lang);
  if (!language) return null;
  const { id } = language;
  try {
    const highlighter = await getHighlighter();
    if (!highlighter.getLoadedLanguages().includes(id)) {
      let pending = languageLoads.get(id);
      if (!pending) {
        pending = highlighter.loadLanguage(language.import).finally(() => {
          languageLoads.delete(id);
        });
        languageLoads.set(id, pending);
      }
      await pending;
    }
    return highlighter.codeToHtml(code, {
      lang: id,
      themes: { light: 'github-light-default', dark: 'github-dark-default' },
      defaultColor: false,
    });
  } catch {
    return null;
  }
}
