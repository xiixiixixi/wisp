import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditorView } from '@codemirror/view';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';
import { FILE_CONTENT_CHANGED_EVENT } from '@/lib/file-change-events';

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
  const [dirty, setDirtyState] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const loadedPathRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const mountedRef = useRef(false);
  const initialReadPendingRef = useRef(false);
  const readGenerationRef = useRef(0);
  const reloadAfterLoadRef = useRef(false);
  const selectedPathRef = useRef(file.path);
  selectedPathRef.current = file.path;
  const previousVersionRef = useRef({ path: file.path, modified: file.modified, size: file.size });
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const setDirty = useCallback((next: boolean | ((previous: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(dirtyRef.current) : next;
    dirtyRef.current = value;
    if (value) readGenerationRef.current += 1;
    setDirtyState(value);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      readGenerationRef.current += 1;
    };
  }, []);

  const reload = useCallback(
    async (path: string) => {
      const loadedPath = loadedPathRef.current;
      if (
        !mountedRef.current ||
        selectedPathRef.current !== path ||
        (loadedPath !== null && loadedPath !== path) ||
        dirtyRef.current ||
        savingRef.current
      )
        {return;}
      const recovering = loadedPath === null;
      if (recovering) {
        initialReadPendingRef.current = true;
        setLoading(true);
        setError(null);
      }
      const generation = ++readGenerationRef.current;
      const view = editorRef.current;
      const document = view?.state.doc.toString();
      try {
        const text = await TauriAPI.readTextFile(path);
        if (
          !mountedRef.current ||
          generation !== readGenerationRef.current ||
          selectedPathRef.current !== path ||
          loadedPathRef.current !== loadedPath ||
          dirtyRef.current ||
          savingRef.current ||
          (view && (editorRef.current !== view || view.state.doc.toString() !== document))
        )
          {return;}
        loadedPathRef.current = path;
        setContent(text);
        if (recovering) callbacksRef.current?.onLoad?.();
      } catch (err) {
        // Keep the last readable content when a concurrent save briefly replaces the file.
        if (
          recovering &&
          mountedRef.current &&
          generation === readGenerationRef.current &&
          selectedPathRef.current === path
        ) {
          setError(err instanceof Error ? err.message : 'Failed to load file');
        }
      } finally {
        if (recovering && mountedRef.current && selectedPathRef.current === path) {
          initialReadPendingRef.current = false;
          setLoading(false);
          const pending = reloadAfterLoadRef.current;
          reloadAfterLoadRef.current = false;
          if (pending) requestReloadRef.current(path);
        }
      }
    },
    [editorRef],
  );

  const requestReload = useCallback(
    (path: string) => {
      if (
        !mountedRef.current ||
        selectedPathRef.current !== path ||
        dirtyRef.current ||
        savingRef.current
      )
        {return;}
      if (initialReadPendingRef.current) {
        reloadAfterLoadRef.current = true;
        return;
      }
      void reload(path);
    },
    [reload],
  );
  const requestReloadRef = useRef(requestReload);
  requestReloadRef.current = requestReload;

  useEffect(() => {
    let cancelled = false;
    const generation = ++readGenerationRef.current;
    initialReadPendingRef.current = false;
    reloadAfterLoadRef.current = false;
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
        initialReadPendingRef.current = true;
        const text = await TauriAPI.readTextFile(file.path);
        if (
          cancelled ||
          !mountedRef.current ||
          selectedPathRef.current !== file.path ||
          generation !== readGenerationRef.current
        )
          {return;}
        loadedPathRef.current = file.path;
        setContent(text);
        callbacksRef.current?.onLoad?.();
      } catch (err) {
        if (
          cancelled ||
          !mountedRef.current ||
          selectedPathRef.current !== file.path ||
          generation !== readGenerationRef.current
        )
          {return;}
        const message = err instanceof Error ? err.message : 'Failed to load file';
        setError(message);
        callbacksRef.current?.onError?.(err instanceof Error ? err : new Error(message));
      } finally {
        if (!cancelled && mountedRef.current && selectedPathRef.current === file.path) {
          initialReadPendingRef.current = false;
          setLoading(false);
          const pending = reloadAfterLoadRef.current;
          reloadAfterLoadRef.current = false;
          if (pending) requestReloadRef.current(file.path);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      readGenerationRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path]);

  useEffect(() => {
    const previous = previousVersionRef.current;
    previousVersionRef.current = { path: file.path, modified: file.modified, size: file.size };
    if (
      previous.path === file.path &&
      (previous.modified !== file.modified || previous.size !== file.size)
    )
      {requestReload(file.path);}
  }, [file.path, file.modified, file.size, requestReload]);

  useEffect(() => {
    const onWritten = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string }>).detail;
      if (detail?.path) requestReload(detail.path);
    };
    window.addEventListener('wisp-file-written', onWritten);
    window.addEventListener(FILE_CONTENT_CHANGED_EVENT, onWritten);
    return () => {
      window.removeEventListener('wisp-file-written', onWritten);
      window.removeEventListener(FILE_CONTENT_CHANGED_EVENT, onWritten);
    };
  }, [requestReload]);

  const save = useCallback(async () => {
    const view = editorRef.current;
    const path = loadedPathRef.current;
    if (!view || !path || savingRef.current) return;
    try {
      savingRef.current = true;
      readGenerationRef.current += 1;
      setSaving(true);
      const doc = view.state.doc.toString();
      await TauriAPI.saveTextFile(path, doc);
      // An in-flight save must not overwrite newer keystrokes or another file's buffer.
      if (
        mountedRef.current &&
        editorRef.current === view &&
        loadedPathRef.current === path &&
        view.state.doc.toString() === doc
      ) {
        setDirty(false);
        setContent(doc);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (mountedRef.current) window.alert(t('preview.saveFailed', { message }));
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }, [editorRef, setDirty, t]);

  return { content, loading, error, dirty, setDirty, saving, save };
}
