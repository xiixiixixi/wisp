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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';

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
  const [editorMounted, setEditorMounted] = useState(false);
  const [draftPreview, setDraftPreview] = useState<string | null>(null);
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
  const changeTab = (value: string) => {
    if (value === 'rendered') setDraftPreview(editorRef.current?.state.doc.toString() ?? null);
    if (value === 'edit') setEditorMounted(true);
    setTab(value as 'rendered' | 'edit');
  };

  return (
    <Tabs value={tab} onValueChange={changeTab} className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="wisp-text-preview-toolbar">
        <TabsList aria-label={t('extensionsBar.preview')}>
          <TabsTrigger value="rendered">{t('preview.rendered')}</TabsTrigger>
          <TabsTrigger value="edit">{t('preview.edit')}</TabsTrigger>
        </TabsList>
        {dirty && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-xp-text-secondary" role="status">
              {t('common.unsaved')}
            </span>
            <Button variant="outline" size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
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
        <TabsContent
          value="rendered"
          className="md-preview !mt-0 min-h-0 flex-1 overflow-auto rounded-[2px] border border-xp-border bg-xp-surface p-3"
        >
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
            {draftPreview ?? content}
          </ReactMarkdown>
        </TabsContent>
      )}

      {!loading && !error && (
        <TabsContent
          value="edit"
          forceMount
          className="!mt-0 min-h-0 flex-1 overflow-hidden rounded-[2px] border border-xp-border bg-xp-surface"
        >
          {editorMounted && (
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
          )}
        </TabsContent>
      )}
    </Tabs>
  );
};

export default MarkdownPreview;
