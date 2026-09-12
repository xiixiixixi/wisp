import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PreviewProps } from '@/lib/preview-factory';
import { formatFileSize } from '@/lib/utils';
import { WispCodeMirror } from '@/lib/codemirror';
import type { EditorView } from '@codemirror/view';
import { WrapText } from 'lucide-react';
import { PreviewSkeleton } from '@/components/ui/Skeleton';
import { useTextFileEditor } from '@/hooks/use-text-file-editor';

export interface CodeMirrorPreviewProps extends PreviewProps {
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
  language,
  initialEditable = false,
}: CodeMirrorPreviewProps) => {
  const { t } = useTranslation();
  const [editable, setEditable] = useState(initialEditable);
  const [lineWrapping, setLineWrapping] = useState(true);
  const [loadedLanguage, setLoadedLanguage] = useState<{
    path: string;
    override?: string;
    name: string;
  } | null>(null);
  const langName =
    loadedLanguage?.path === file.path && loadedLanguage.override === language
      ? loadedLanguage.name
      : '';
  const handleLanguageLoaded = useCallback(
    (name: string) => {
      setLoadedLanguage({ path: file.path, override: language, name });
    },
    [file.path, language],
  );
  const editorRef = useRef<EditorView | null>(null);
  const { content, loading, error, dirty, setDirty, saving, save } = useTextFileEditor(
    file,
    editorRef,
    { onLoad, onError },
  );

  const handleDocChanged = useCallback(() => {
    setDirty(true);
  }, [setDirty]);

  return (
    <div className="wisp-code-preview flex h-full flex-col">
      {/* Toolbar */}
      <div className="mb-1.5 flex flex-shrink-0 items-center gap-1.5">
        <span className="wisp-code-language px-1 py-1">
          {langName || t('preview.plainText', { defaultValue: 'Plain text' })}
        </span>
        <span className="text-[10px] text-xp-text-muted">{formatFileSize(file.size)}</span>
        <div className="flex-1" />
        <button
          type="button"
          className="wisp-code-wrap"
          aria-label={t('preview.wrapLines', { defaultValue: 'Wrap lines' })}
          title={t('preview.wrapLines', { defaultValue: 'Wrap lines' })}
          aria-pressed={lineWrapping}
          onClick={() => setLineWrapping((value) => !value)}
        >
          <WrapText size={14} aria-hidden="true" />
        </button>
        {dirty && (
          <span className="text-[10px] font-semibold text-xp-orange">● {t('common.unsaved')}</span>
        )}
        {editable ? (
          <>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
              className={`rounded-md border px-2 py-1 text-xs transition-colors ${
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
              className="rounded-md border border-xp-border px-2 py-1 text-xs text-xp-text transition-colors hover:bg-xp-surface-light"
            >
              {t('preview.doneEditing')}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditable(true)}
            className="rounded-md border border-xp-border px-2 py-1 text-xs text-xp-text transition-colors hover:bg-xp-surface-light"
          >
            {t('preview.edit')}
          </button>
        )}
      </div>

      {loading && <PreviewSkeleton />}

      {!loading && error && (
        <div className="flex flex-1 items-center justify-center rounded-md border border-xp-border bg-xp-surface">
          <div className="text-center text-xp-text-muted">
            <p className="text-sm">{t('preview.cannotPreview')}</p>
            <p className="mt-1 text-xs opacity-70">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && (
        <div className="wisp-code-surface min-h-0 flex-1 overflow-hidden rounded-lg border">
          <WispCodeMirror
            doc={content}
            readOnly={!editable}
            lineWrapping={lineWrapping}
            language={language}
            fileName={file.name}
            editorRef={editorRef}
            onDocChanged={handleDocChanged}
            onLanguageLoaded={handleLanguageLoaded}
            onSave={() => void save()}
            ariaLabel={file.name}
            className="h-full"
          />
        </div>
      )}
    </div>
  );
};

export default CodeMirrorPreview;
