import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PreviewProps } from '@/lib/preview-factory';
import { formatFileSize } from '@/lib/utils';
import { WispCodeMirror } from '@/lib/codemirror';
import type { EditorView } from '@codemirror/view';
import { PreviewSkeleton } from '@/components/ui/Skeleton';
import { useTextFileEditor } from '@/hooks/use-text-file-editor';
import CodeAIActions from './CodeAIActions';

export interface CodeMirrorPreviewProps extends PreviewProps {
  /** Show the AI action row (code files). */
  showAiActions?: boolean;
  /** Force a CodeMirror language instead of filename detection. */
  language?: string;
  /** Start in edit mode. */
  initialEditable?: boolean;
}

/**
 * Unified text/code preview built on CodeMirror 6: read-only preview by
 * default, one click into a live editor with ⌘S save. No truncation —
 * CodeMirror only materialises the visible viewport, so multi-MB files
 * preview in full.
 */
const CodeMirrorPreview = ({
  file,
  onError,
  onLoad,
  showAiActions = false,
  language,
  initialEditable = false,
}: CodeMirrorPreviewProps) => {
  const { t } = useTranslation();
  const [editable, setEditable] = useState(initialEditable);
  const [langName, setLangName] = useState('');
  const [aiSnapshot, setAiSnapshot] = useState<string | null>(null);
  const editorRef = useRef<EditorView | null>(null);
  const aiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { content, loading, error, dirty, setDirty, saving, save } = useTextFileEditor(
    file,
    editorRef,
    { onLoad, onError },
  );

  // Seed the AI snapshot with the loaded file; refreshes lazily while typing.
  useEffect(() => {
    if (content && aiSnapshot === null) setAiSnapshot(content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  // The AI action row wants a plain string; refresh it lazily so typing never
  // stringifies the whole buffer per keystroke.
  const handleDocChanged = useCallback(() => {
    setDirty(true);
    if (!showAiActions) return;
    if (aiTimer.current) clearTimeout(aiTimer.current);
    aiTimer.current = setTimeout(() => {
      const doc = editorRef.current?.state.doc.toString();
      if (doc !== undefined) setAiSnapshot(doc);
    }, 400);
  }, [setDirty, showAiActions]);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="mb-1.5 flex flex-shrink-0 items-center gap-1.5">
        <span className="rounded-[2px] bg-xp-bg px-2 py-1 text-[10px] uppercase tracking-wide text-xp-text-muted">
          {langName || file.name.split('.').pop() || 'text'}
        </span>
        <span className="text-[10px] text-xp-text-muted">{formatFileSize(file.size)}</span>
        <div className="flex-1" />
        {dirty && (
          <span className="text-[10px] font-medium text-xp-orange">● {t('common.unsaved')}</span>
        )}
        {editable ? (
          <>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
              className={`rounded-[2px] border px-2 py-1 text-xs transition-colors ${
                dirty
                  ? 'border-xp-blue/40 text-xp-blue hover:bg-xp-selection-bg'
                  : 'border-xp-border text-xp-text-muted opacity-50'
              }`}
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
            <button
              type="button"
              onClick={() => setEditable(false)}
              className="rounded-[2px] border border-xp-border px-2 py-1 text-xs text-xp-text transition-colors hover:bg-xp-surface-light"
            >
              {t('preview.doneEditing')}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditable(true)}
            className="rounded-[2px] border border-xp-border px-2 py-1 text-xs text-xp-text transition-colors hover:bg-xp-surface-light"
          >
            {t('preview.edit')}
          </button>
        )}
      </div>

      {loading && <PreviewSkeleton />}

      {!loading && error && (
        <div className="flex flex-1 items-center justify-center rounded-[2px] border border-xp-border bg-xp-surface">
          <div className="text-center text-xp-text-muted">
            <p className="text-sm">{t('preview.cannotPreview')}</p>
            <p className="mt-1 text-xs opacity-70">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-[2px] border border-xp-border bg-xp-surface">
          <WispCodeMirror
            doc={content}
            readOnly={!editable}
            language={language}
            fileName={file.name}
            editorRef={editorRef}
            onDocChanged={handleDocChanged}
            onLanguageLoaded={setLangName}
            onSave={() => void save()}
            ariaLabel={file.name}
            className="h-full"
          />
        </div>
      )}

      {showAiActions && !loading && !error && aiSnapshot !== null && (
        <div className="mt-1.5 flex-shrink-0">
          <CodeAIActions
            filePath={file.path}
            language={langName}
            content={aiSnapshot}
            fileName={file.name}
          />
        </div>
      )}
    </div>
  );
};

export default CodeMirrorPreview;
