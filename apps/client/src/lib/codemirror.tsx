/**
 * Shared CodeMirror 6 setup for Wisp previews.
 *
 * One material language: transparent background so the editor sits on the
 * theme's glass surfaces, syntax colours mapped to the --xp-* tokens so dark
 * and light themes both work without reconfiguring the view.
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

/** Syntax colours reuse the theme palette (var() is legal in any CSS value). */
export const wispHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: 'var(--xp-text-muted)', fontStyle: 'italic' },
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], color: 'var(--xp-purple)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--xp-green)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--xp-orange)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--xp-blue)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--xp-yellow)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--xp-cyan)' },
  { tag: [t.definition(t.variableName), t.variableName], color: 'var(--xp-text)' },
  { tag: t.operator, color: 'var(--xp-text-secondary)' },
  { tag: t.link, color: 'var(--xp-blue)', textDecoration: 'underline' },
  { tag: t.heading, color: 'var(--xp-text)', fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.invalid, color: 'var(--xp-red)' },
]);

export const wispEditorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--xp-text)',
    fontSize: '12px',
    height: '100%',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: '"SF Mono", ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace',
    lineHeight: '1.55',
  },
  '.cm-content': { caretColor: 'var(--xp-blue)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--xp-blue)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--xp-selection-bg)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--xp-text) 6%, transparent)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--xp-text-muted)',
    border: 'none',
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--xp-text)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in srgb, var(--xp-blue) 28%, transparent)',
    outline: 'none',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'color-mix(in srgb, var(--xp-yellow) 22%, transparent)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--glass-tint-strong, rgba(128, 128, 128, 0.2))',
    color: 'var(--xp-text)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--xp-yellow) 30%, transparent)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--glass-tint-strong, rgba(128, 128, 128, 0.2))',
    border: '1px solid var(--glass-hairline, rgba(128, 128, 128, 0.3))',
    color: 'var(--xp-text)',
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
  if (override) {
    const target = override.toLowerCase();
    const byName = languages.find(
      (l) => l.name.toLowerCase() === target || l.alias?.includes(target),
    );
    if (byName)
      {return byName
        .load()
        .then(() => byName)
        .catch(() => null);}
  }
  const desc = LanguageDescription.matchFilename(languages, fileName);
  if (!desc) return null;
  return desc
    .load()
    .then(() => desc)
    .catch(() => null);
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
  /** Force a language by CodeMirror name (e.g. 'markdown'); default: detect from fileName. */
  language?: string;
  fileName?: string;
  /** Dirty signal — fires without a doc payload so callers never stringify per keystroke. */
  onDocChanged?: () => void;
  /** Resolved CodeMirror language display name (after lazy grammar load). */
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
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel ?? '代码内容' }),
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

  // Editability toggle.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: roComp.current.reconfigure(readonlyExtensions(readOnly)),
    });
  }, [readOnly]);

  // Language grammar (lazy-loaded Lezer package).
  useEffect(() => {
    let cancelled = false;
    void loadLanguageFor(fileName, language).then((desc) => {
      if (cancelled || !viewRef.current) return;
      viewRef.current.dispatch({
        effects: langComp.current.reconfigure(desc?.support ?? []),
      });
      if (desc) onLanguageLoadedRef.current?.(desc.name);
    });
    return () => {
      cancelled = true;
    };
  }, [language, fileName]);

  return <div ref={hostRef} className={className} style={{ height: '100%' }} />;
}

function readonlyExtensions(readOnly: boolean): Extension[] {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}
