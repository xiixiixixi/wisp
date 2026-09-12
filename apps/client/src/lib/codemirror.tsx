/**
 * Shared CodeMirror 6 setup for Wisp previews.
 *
 * Syntax colors have their own light/dark palette. CSS changes the appearance
 * without rebuilding the editor or touching the document and undo history.
 */
import React, { useEffect, useRef } from 'react';
import {
  EditorView,
  keymap,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from '@codemirror/view';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  foldGutter,
  foldKeymap,
  indentOnInput,
  bracketMatching,
  syntaxHighlighting,
  HighlightStyle,
  LanguageDescription,
} from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { languages } from '@codemirror/language-data';
import '@/styles/code-preview.css';

/** Stable semantic classes work with both Lezer and legacy stream grammars. */
export const wispHighlightStyle = HighlightStyle.define([
  { tag: t.comment, class: 'code-token-comment' },
  { tag: [t.keyword, t.operatorKeyword], class: 'code-token-keyword' },
  { tag: [t.string, t.special(t.string), t.regexp], class: 'code-token-string' },
  { tag: [t.number, t.bool, t.null, t.atom], class: 'code-token-constant' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: 'code-token-function' },
  { tag: [t.typeName, t.className, t.namespace], class: 'code-token-type' },
  { tag: [t.propertyName, t.attributeName], class: 'code-token-property' },
  { tag: t.variableName, class: 'code-token-variable' },
  { tag: [t.operator, t.punctuation], class: 'code-token-punctuation' },
  { tag: t.tagName, class: 'code-token-tag' },
  { tag: t.link, class: 'code-token-link' },
  { tag: t.heading, class: 'code-token-heading' },
  { tag: t.emphasis, class: 'code-token-emphasis' },
  { tag: t.strong, class: 'code-token-strong' },
  { tag: t.invalid, class: 'code-token-invalid' },
]);

export const wispEditorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--code-background)',
    color: 'var(--code-foreground)',
    fontSize: '12px',
    height: '100%',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: '"SF Mono", ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace',
    lineHeight: '1.55',
  },
  '.cm-content': { caretColor: 'var(--code-cursor)', padding: '10px 0' },
  '.cm-line': { padding: '0 14px 0 8px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--code-cursor)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--code-selection)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--code-active-line)' },
  '.cm-gutters': {
    backgroundColor: 'var(--code-background)',
    color: 'var(--code-gutter)',
    border: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--code-foreground)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--code-bracket)',
    outline: 'none',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'var(--code-search-match)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--code-panel)',
    color: 'var(--code-foreground)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--code-search-match)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--code-bracket)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--code-panel)',
    border: '1px solid var(--code-border)',
    color: 'var(--code-foreground)',
  },
});

export function baseExtensions(): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(wispHighlightStyle, { fallback: true }),
    bracketMatching(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap]),
    wispEditorTheme,
  ];
}

/** Resolve a CodeMirror language for a filename; loads the grammar lazily. */
export async function loadLanguageFor(
  fileName: string,
  override?: string,
): Promise<LanguageDescription | null> {
  const desc = resolveLanguage(fileName, override);
  if (!desc) return null;
  return desc
    .load()
    .then(() => desc)
    .catch(() => null);
}

const languageAliases: Record<string, string> = {
  typescriptreact: 'tsx',
  javascriptreact: 'jsx',
  shellscript: 'shell',
};

function languageByName(name: string): LanguageDescription | null {
  const normalized = name.trim().toLowerCase();
  // The upstream registry aliases JSON5 to the strict JSON grammar. Do not
  // claim support for JSON5/JSONC or fall back from an explicit plain-text mode.
  if (
    ['text', 'txt', 'plaintext', 'plain text', 'text/plain', 'json5', 'jsonc'].includes(normalized)
  ) {
    return null;
  }
  return LanguageDescription.matchLanguageName(
    languages,
    languageAliases[normalized] ?? normalized,
    false,
  );
}

function resolveLanguage(fileName: string, override?: string): LanguageDescription | null {
  if (override?.trim()) return languageByName(override);
  const baseName = fileName.split(/[\\/]/).pop() ?? '';
  const lowerName = baseName.toLowerCase();
  if (/^(?:dockerfile|containerfile)(?:\..+)?$/.test(lowerName)) {
    return languageByName('dockerfile');
  }
  if (
    /\.(?:zsh|bash|ksh|sh)$/.test(lowerName) ||
    /^\.(?:bashrc|bash_profile|bash_login|bash_logout|zshrc|zprofile|zshenv|zlogin|zlogout|profile)$/.test(
      lowerName,
    ) ||
    /^\.env(?:\..+)?$/.test(lowerName)
  ) {
    return languageByName('shell');
  }
  if (['.editorconfig', '.gitconfig', '.gitmodules'].includes(lowerName)) {
    return languageByName('properties');
  }
  // Match case-sensitive special filenames first (for example Python's BUILD),
  // then case-insensitive extensions, including .TSX, .MTS, .CJS and .YAML.
  return (
    LanguageDescription.matchFilename(languages, baseName) ??
    LanguageDescription.matchFilename(languages, lowerName)
  );
}

/**
 * React wrapper: mounts one EditorView for the component's lifetime.
 * Uncontrolled buffer — read the live document through `editorRef`
 * (avoids materialising multi-MB strings on every keystroke). Pass a new
 * `doc` to replace the buffer (file switch / external reload).
 */
export interface WispCodeMirrorProps {
  doc: string;
  readOnly?: boolean;
  /** Soft-wrap long lines without changing the document. */
  lineWrapping?: boolean;
  /** Force a language by CodeMirror name (e.g. 'markdown'); default: detect from fileName. */
  language?: string;
  fileName?: string;
  /** Dirty signal — fires without a doc payload so callers never stringify per keystroke. */
  onDocChanged?: () => void;
  /** Resolved grammar name; empty while loading or when plain text is used. */
  onLanguageLoaded?: (name: string) => void;
  /** Live view handle; parents save via `editorRef.current?.state.doc`. */
  editorRef?: React.MutableRefObject<EditorView | null>;
  /** Cmd/Ctrl+S inside the editor. */
  onSave?: () => void;
  className?: string;
  ariaLabel?: string;
}

export function WispCodeMirror({
  doc,
  readOnly = true,
  lineWrapping = false,
  language,
  fileName = '',
  onDocChanged,
  onLanguageLoaded,
  editorRef,
  onSave,
  className,
  ariaLabel,
}: WispCodeMirrorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langComp = useRef(new Compartment());
  const roComp = useRef(new Compartment());
  const saveComp = useRef(new Compartment());
  const labelComp = useRef(new Compartment());
  const wrapComp = useRef(new Compartment());
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onDocChangedRef = useRef(onDocChanged);
  onDocChangedRef.current = onDocChanged;
  const onLanguageLoadedRef = useRef(onLanguageLoaded);
  onLanguageLoadedRef.current = onLanguageLoaded;

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc,
        extensions: [
          ...baseExtensions(),
          langComp.current.of([]),
          roComp.current.of(readonlyExtensions(readOnly)),
          wrapComp.current.of(lineWrapping ? EditorView.lineWrapping : []),
          saveComp.current.of(
            keymap.of([
              {
                key: 'Mod-s',
                preventDefault: true,
                run: () => {
                  onSaveRef.current?.();
                  return true;
                },
              },
            ]),
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onDocChangedRef.current?.();
          }),
          labelComp.current.of(
            EditorView.contentAttributes.of({ 'aria-label': ariaLabel ?? '代码内容' }),
          ),
        ],
      }),
    });
    viewRef.current = view;
    if (editorRef) editorRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
      if (editorRef) editorRef.current = null;
    };
    // Mount once; everything below reconfigures in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External doc replacement (file switch / revert).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (doc !== current) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
    }
  }, [doc]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: labelComp.current.reconfigure(
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel ?? '代码内容' }),
      ),
    });
  }, [ariaLabel]);

  // Editability toggle.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: roComp.current.reconfigure(readonlyExtensions(readOnly)),
    });
  }, [readOnly]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapComp.current.reconfigure(lineWrapping ? EditorView.lineWrapping : []),
    });
  }, [lineWrapping]);

  // Language grammar (lazy-loaded Lezer package).
  useEffect(() => {
    let cancelled = false;
    // A different file must never temporarily retain the previous grammar or
    // its badge while the next grammar downloads (or fails to load).
    viewRef.current?.dispatch({ effects: langComp.current.reconfigure([]) });
    onLanguageLoadedRef.current?.('');
    void loadLanguageFor(fileName, language).then((desc) => {
      if (cancelled || !viewRef.current) return;
      viewRef.current.dispatch({
        effects: langComp.current.reconfigure(desc?.support ?? []),
      });
      onLanguageLoadedRef.current?.(desc?.name ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [language, fileName]);

  return (
    <div
      ref={hostRef}
      className={`wisp-code-editor ${className ?? ''}`}
      style={{ height: '100%' }}
    />
  );
}

function readonlyExtensions(readOnly: boolean): Extension[] {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}
