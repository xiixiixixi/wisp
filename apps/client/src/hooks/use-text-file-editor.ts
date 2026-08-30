import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditorView } from '@codemirror/view';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';

/**
 * Load-a-text-file + dirty-tracking + ⌘S-save state shared by the
 * CodeMirror-backed preview components (code/text, markdown, html).
 * The buffer itself lives in the CodeMirror view; `content` is the last
 * committed doc used to (re)seed the editor.
 */
export function useTextFileEditor(
  file: FileEntry,
  editorRef: React.MutableRefObject<EditorView | null>,
  callbacks?: { onLoad?: () => void; onError?: (error: Error) => void },
) {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const contentRef = useRef('');
  contentRef.current = content;
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (dirtyRef.current && contentRef.current) {
          // Switching files would discard unsaved edits — ask first; refusing
          // keeps the current buffer so the user can save or discard.
          if (!window.confirm(t('preview.unsavedChanges'))) {
            setLoading(false);
            return;
          }
        }
        setLoading(true);
        setError(null);
        setDirty(false);
        const text = await TauriAPI.readTextFile(file.path);
        if (cancelled) return;
        setContent(text);
        callbacksRef.current?.onLoad?.();
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load file';
        setError(message);
        callbacksRef.current?.onError?.(err instanceof Error ? err : new Error(message));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path]);

  const save = useCallback(async () => {
    const view = editorRef.current;
    if (!view || saving) return;
    try {
      setSaving(true);
      const doc = view.state.doc.toString();
      await TauriAPI.saveTextFile(file.path, doc);
      setDirty(false);
      setContent(doc);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      window.alert(t('preview.saveFailed', { message }));
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, saving, editorRef]);

  return { content, loading, error, dirty, setDirty, saving, save };
}
