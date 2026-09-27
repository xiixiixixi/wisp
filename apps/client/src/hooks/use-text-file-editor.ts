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
  const savingRef = useRef(false);
  const loadedPathRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (dirtyRef.current) {
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
        loadedPathRef.current = null;
        const text = await TauriAPI.readTextFile(file.path);
        if (cancelled) return;
        loadedPathRef.current = file.path;
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

  // 文件被改写（AI 工具/其他窗口）→ 重读内容，画布"改完即见"。
  // 有未保存手改时不覆盖，避免吃掉用户的草稿。
  useEffect(() => {
    const onWritten = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string }>).detail;
      if (!detail?.path || detail.path !== file.path) return;
      if (dirtyRef.current || savingRef.current) return;
      let stale = false;
      const reload = async () => {
        try {
          const text = await TauriAPI.readTextFile(file.path);
          if (stale || dirtyRef.current) return;
          setContent(text);
        } catch {
          // 读失败保留现有内容
        }
      };
      void reload();
      return () => {
        stale = true;
      };
    };
    window.addEventListener('wisp-file-written', onWritten);
    return () => window.removeEventListener('wisp-file-written', onWritten);
  }, [file.path]);

  const save = useCallback(async () => {
    const view = editorRef.current;
    const path = loadedPathRef.current;
    if (!view || !path || savingRef.current) return;
    try {
      savingRef.current = true;
      setSaving(true);
      const doc = view.state.doc.toString();
      await TauriAPI.saveTextFile(path, doc);
      // An in-flight save must not overwrite newer keystrokes or another file's buffer.
      if (
        editorRef.current === view &&
        loadedPathRef.current === path &&
        view.state.doc.toString() === doc
      ) {
        setDirty(false);
        setContent(doc);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      window.alert(t('preview.saveFailed', { message }));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [editorRef, t]);

  return { content, loading, error, dirty, setDirty, saving, save };
}
