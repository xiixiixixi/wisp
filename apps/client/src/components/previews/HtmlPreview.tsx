import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PreviewProps } from '@/lib/preview-factory';
import { WispCodeMirror } from '@/lib/codemirror';
import type { EditorView } from '@codemirror/view';
import { PreviewSkeleton } from '@/components/ui/Skeleton';
import { useTextFileEditor } from '@/hooks/use-text-file-editor';

/**
 * HTML preview: rendered in a sandboxed iframe (scripts stay sandboxed and
 * the app CSP keeps inline script from executing — a static render), with a
 * CodeMirror source tab and ⌘S save.
 */
const HtmlPreview = ({ file, onError, onLoad }: PreviewProps) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'rendered' | 'edit'>('rendered');
  const editorRef = useRef<EditorView | null>(null);
  const { content, loading, error, dirty, setDirty, saving, save } = useTextFileEditor(
    file,
    editorRef,
    { onLoad, onError },
  );

  const handleDocChanged = useCallback(() => setDirty(true), [setDirty]);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="mb-1.5 flex flex-shrink-0 items-center gap-1.5">
        <div className="flex overflow-hidden rounded-md border border-xp-border bg-xp-bg text-xs">
          <button
            type="button"
            onClick={() => setTab('rendered')}
            className={`px-2.5 py-1 transition-colors ${
              tab === 'rendered'
                ? 'bg-xp-selection-bg text-xp-blue'
                : 'text-xp-text-muted hover:text-xp-text'
            }`}
          >
            {t('preview.rendered')}
          </button>
          <button
            type="button"
            onClick={() => setTab('edit')}
            className={`px-2.5 py-1 transition-colors ${
              tab === 'edit'
                ? 'bg-xp-selection-bg text-xp-blue'
                : 'text-xp-text-muted hover:text-xp-text'
            }`}
          >
            {t('preview.edit')}
          </button>
        </div>
        <div className="flex-1" />
        {dirty && (
          <>
            <span className="text-[10px] font-medium text-xp-orange">● {t('common.unsaved')}</span>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="border-xp-blue/40 hover:bg-xp-selection-bg rounded-md border px-2 py-1 text-xs text-xp-blue transition-colors"
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </>
        )}
      </div>

      {loading && <PreviewSkeleton />}

      {!loading && error && (
        <div className="flex flex-1 items-center justify-center rounded border border-xp-border bg-xp-surface">
          <div className="text-center text-xp-text-muted">
            <p className="text-sm">{t('preview.cannotPreview')}</p>
            <p className="mt-1 text-xs opacity-70">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && tab === 'rendered' && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-xp-border bg-white">
          <iframe
            title={t('preview.htmlPreview')}
            sandbox="allow-scripts"
            srcDoc={content}
            className="h-full w-full border-0"
          />
        </div>
      )}

      {!loading && !error && tab === 'edit' && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-xp-border bg-xp-surface">
          <WispCodeMirror
            doc={content}
            readOnly={false}
            language="html"
            fileName={file.name}
            editorRef={editorRef}
            onDocChanged={handleDocChanged}
            onSave={() => void save()}
            ariaLabel={file.name}
            className="h-full"
          />
        </div>
      )}
    </div>
  );
};

export default HtmlPreview;
