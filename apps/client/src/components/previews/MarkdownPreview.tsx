import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PreviewProps } from '@/lib/preview-factory';
import { WispCodeMirror } from '@/lib/codemirror';
import type { EditorView } from '@codemirror/view';
import { PreviewSkeleton } from '@/components/ui/Skeleton';
import { useTextFileEditor } from '@/hooks/use-text-file-editor';
import { highlightCode } from '@/lib/shiki';

/** Async Shiki block; output is generated HTML (code is escaped by Shiki). */
const ShikiBlock = ({ code, lang }: { code: string; lang: string }) => {
  const [html, setHtml] = useState('');
  useEffect(() => {
    let cancelled = false;
    void highlightCode(code, lang).then((result) => {
      if (!cancelled) setHtml(result ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);
  if (!html) {
    return (
      <pre className="md-code-fallback">
        <code>{code}</code>
      </pre>
    );
  }
  return <div className="code-highlight md-code" dangerouslySetInnerHTML={{ __html: html }} />;
};

/**
 * Markdown preview v2: rendered view (react-markdown + GFM + Shiki) and a
 * live CodeMirror source editor sharing one ⌘S save path.
 */
const MarkdownPreview = ({ file, onError, onLoad }: PreviewProps) => {
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
        <div className="flex overflow-hidden rounded-[2px] border border-xp-border bg-xp-bg text-xs">
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
              className="rounded-[2px] border border-xp-blue/40 px-2 py-1 text-xs text-xp-blue transition-colors hover:bg-xp-selection-bg"
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </>
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

      {!loading && !error && tab === 'rendered' && (
        <div className="md-preview min-h-0 flex-1 overflow-auto rounded-[2px] border border-xp-border bg-xp-surface p-3">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre: ({ children }) => <>{children}</>,
              code: ({ className, children }) => {
                const text = String(children);
                const match = /language-([\w-]+)/.exec(className || '');
                if (match || text.includes('\n')) {
                  return <ShikiBlock code={text.replace(/\n$/, '')} lang={match?.[1] ?? 'text'} />;
                }
                return <code className="md-inline-code">{children}</code>;
              },
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noreferrer noopener">
                  {children}
                </a>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      )}

      {!loading && !error && tab === 'edit' && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-[2px] border border-xp-border bg-xp-surface">
          <WispCodeMirror
            doc={content}
            readOnly={false}
            language="markdown"
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

export default MarkdownPreview;
