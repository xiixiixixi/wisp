import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PreviewProps } from '@/lib/preview-factory';
import { WispCodeMirror } from '@/lib/codemirror';
import type { EditorView } from '@codemirror/view';
import { PreviewSkeleton } from '@/components/ui/Skeleton';
import { useTextFileEditor } from '@/hooks/use-text-file-editor';
import { convertAssetUrl, isTauri } from '@/lib/transport';
import { TauriAPI } from '@/lib/tauri-api';

/**
 * HTML preview: saved files load from their asset URL so relative styles and
 * images resolve beside the HTML file. Unsaved drafts use srcDoc. Both are
 * script-blocked; the source tab can still edit and save the file.
 */
const HtmlPreview = ({ file, onError, onLoad }: PreviewProps) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'rendered' | 'edit'>('rendered');
  const [editorMounted, setEditorMounted] = useState(false);
  const [draftPreview, setDraftPreview] = useState<string | null>(null);
  const nativeMode = isTauri();
  const [assetScope, setAssetScope] = useState<{ path: string; allowed: boolean | null }>({
    path: file.path,
    allowed: null,
  });
  let assetAllowed: boolean | null = false;
  if (nativeMode) {
    assetAllowed = assetScope.path === file.path ? assetScope.allowed : null;
  }
  const editorRef = useRef<EditorView | null>(null);
  const { content, loading, error, dirty, setDirty, saving, save } = useTextFileEditor(
    file,
    editorRef,
    { onLoad, onError },
  );

  const handleDocChanged = useCallback(() => setDirty(true), [setDirty]);
  useEffect(() => {
    setDraftPreview(null);
  }, [content, file.path]);

  useEffect(() => {
    if (!nativeMode) return;
    let cancelled = false;
    setAssetScope({ path: file.path, allowed: null });
    void TauriAPI.previewAssetAllowed(file.path)
      .then((allowed) => {
        if (!cancelled) setAssetScope({ path: file.path, allowed });
      })
      .catch(() => {
        if (!cancelled) setAssetScope({ path: file.path, allowed: false });
      });
    return () => {
      cancelled = true;
    };
  }, [file.path, nativeMode]);

  const savedUrl = useMemo(() => {
    if (assetAllowed !== true) return null;
    try {
      // Bust the asset cache after this component reads a changed file, even
      // when an edit leaves the byte length unchanged.
      let hash = 2166136261;
      for (let i = 0; i < content.length; i += 1) {
        hash = Math.imul(hash ^ content.charCodeAt(i), 16777619);
      }
      const url = new URL(convertAssetUrl(file.path));
      // Tauri's convertFileSrc encodes the entire path as one URL segment.
      // Its asset handler decodes the path after removing the first URL slash.
      // Preserve the directory separators in the URL so a stylesheet's or
      // image's relative URL resolves beside the HTML file.
      const encodedSeparator = file.path.startsWith('/') ? /%2F/gi : /%5C/gi;
      url.pathname = url.pathname.replace(encodedSeparator, '/');
      url.searchParams.set('wisp-preview', `${file.modified}-${(hash >>> 0).toString(36)}`);
      return url.toString();
    } catch {
      // An invalid asset URL must not take away the readable static preview.
      return null;
    }
  }, [assetAllowed, content, file.modified, file.path]);
  const renderSavedFile = savedUrl !== null && (draftPreview === null || draftPreview === content);
  const waitingForAsset = !loading && !error && tab === 'rendered' && assetAllowed === null;

  return (
    <div
      className="flex h-full flex-col"
      data-preview-editing={tab === 'edit' || dirty ? 'true' : undefined}
    >
      {/* Toolbar */}
      <div className="mb-1.5 flex flex-shrink-0 items-center gap-1.5">
        <div className="flex overflow-hidden rounded-md border border-xp-border bg-xp-bg text-xs">
          <button
            type="button"
            onClick={() => {
              setDraftPreview(editorRef.current?.state.doc.toString() ?? null);
              setTab('rendered');
            }}
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
            onClick={() => {
              setEditorMounted(true);
              setTab('edit');
            }}
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
            <span className="text-[10px] font-semibold text-xp-orange">
              ● {t('common.unsaved')}
            </span>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-md border border-xp-blue/40 px-2 py-1 text-xs text-xp-blue transition-colors hover:bg-xp-selection-bg"
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </>
        )}
      </div>

      {(loading || waitingForAsset) && <PreviewSkeleton />}

      {!loading && error && (
        <div className="flex flex-1 items-center justify-center rounded-md border border-xp-border bg-xp-surface">
          <div className="text-center text-xp-text-muted">
            <p className="text-sm">{t('preview.cannotPreview')}</p>
            <p className="mt-1 text-xs opacity-70">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && !waitingForAsset && tab === 'rendered' && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-xp-border bg-white">
          <iframe
            key={renderSavedFile ? savedUrl : 'draft'}
            title={t('preview.htmlPreview')}
            sandbox=""
            referrerPolicy="no-referrer"
            src={renderSavedFile ? savedUrl : undefined}
            srcDoc={renderSavedFile ? undefined : (draftPreview ?? content)}
            className="h-full w-full border-0"
          />
        </div>
      )}

      {!loading && !error && editorMounted && (
        <div
          hidden={tab !== 'edit'}
          style={{ display: tab === 'edit' ? undefined : 'none' }}
          className="min-h-0 flex-1 overflow-hidden rounded-md border border-xp-border bg-xp-surface"
        >
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
