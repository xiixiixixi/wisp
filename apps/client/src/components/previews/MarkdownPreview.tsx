import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PreviewProps } from '@/lib/preview-factory';
import { WispCodeMirror } from '@/lib/codemirror';
import type { EditorView } from '@codemirror/view';
import { PreviewSkeleton } from '@/components/ui/Skeleton';
import { useTextFileEditor } from '@/hooks/use-text-file-editor';
import { getCodeLanguageLabel, highlightCode } from '@/lib/shiki';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Check, Copy } from 'lucide-react';
import '@/styles/code-preview.css';

/** Async Shiki block; output is generated HTML (code is escaped by Shiki). */
const ShikiBlock = ({ code, lang }: { code: string; lang: string }) => {
  const { t } = useTranslation();
  const labelId = useId();
  const [highlighted, setHighlighted] = useState<{
    code: string;
    lang: string;
    html: string;
  } | null>(null);
  const [copyState, setCopyState] = useState<{
    code: string;
    status: 'copying' | 'copied' | 'error';
  } | null>(null);
  const copyAttemptRef = useRef(0);
  useEffect(() => {
    let cancelled = false;
    void highlightCode(code, lang).then((result) => {
      if (!cancelled) setHighlighted({ code, lang, html: result ?? '' });
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);
  useEffect(
    () => () => {
      copyAttemptRef.current += 1;
    },
    [code],
  );

  const html = highlighted?.code === code && highlighted.lang === lang ? highlighted.html : '';
  const status = copyState?.code === code ? copyState.status : null;
  const languageLabel =
    getCodeLanguageLabel(lang) ??
    (/^(text|txt|plaintext|plain)?$/i.test(lang)
      ? t('preview.plainText', { defaultValue: 'Plain text' })
      : lang);
  const copyCode = async () => {
    const attempt = ++copyAttemptRef.current;
    setCopyState({ code, status: 'copying' });
    try {
      await navigator.clipboard.writeText(code);
      if (attempt === copyAttemptRef.current) setCopyState({ code, status: 'copied' });
    } catch {
      if (attempt === copyAttemptRef.current) setCopyState({ code, status: 'error' });
    }
  };

  return (
    <div className="md-code-block">
      <div className="md-code-toolbar">
        <span id={labelId} className="md-code-language">
          {languageLabel}
        </span>
        <span className="md-code-copy-status" role="status" data-status={status}>
          {status === 'copied' && t('preview.codeCopied', { defaultValue: 'Code copied' })}
          {status === 'error' &&
            t('preview.copyCodeFailed', { defaultValue: 'Could not copy code' })}
        </span>
        <button
          type="button"
          className="md-code-copy"
          onClick={() => void copyCode()}
          disabled={status === 'copying'}
          aria-label={t('preview.copyCode', { defaultValue: 'Copy code' })}
        >
          {status === 'copied' ? (
            <Check size={14} aria-hidden="true" />
          ) : (
            <Copy size={14} aria-hidden="true" />
          )}
          <span>{t('preview.copyCode', { defaultValue: 'Copy code' })}</span>
        </button>
      </div>
      <div className="md-code-body" tabIndex={0} role="region" aria-labelledby={labelId}>
        {html ? (
          <div className="code-highlight md-code" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className="md-code-fallback">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
};

// Read fences from their <pre> parent so single-line, empty, indented and
// punctuation-bearing language ids (c++, c#) remain distinct from inline code.
const markdownComponents: Components = {
  pre: ({ children }) => {
    const child = React.Children.toArray(children)[0];
    if (!React.isValidElement<{ className?: string; children?: React.ReactNode }>(child)) {
      return <pre>{children}</pre>;
    }
    const language = /(?:^|\s)language-([^\s]+)/.exec(child.props.className ?? '')?.[1] ?? 'text';
    return (
      <ShikiBlock code={String(child.props.children ?? '').replace(/\n$/, '')} lang={language} />
    );
  },
  code: ({ children }) => <code className="md-inline-code">{children}</code>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
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
        <div className="flex flex-1 items-center justify-center rounded-md border border-xp-border bg-xp-surface">
          <div className="text-center text-xp-text-muted">
            <p className="text-sm">{t('preview.cannotPreview')}</p>
            <p className="mt-1 text-xs opacity-70">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && (
        <TabsContent
          value="rendered"
          className="md-preview !mt-0 min-h-0 flex-1 overflow-auto rounded-md border border-xp-border bg-xp-surface p-3"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {draftPreview ?? content}
          </ReactMarkdown>
        </TabsContent>
      )}

      {!loading && !error && (
        <TabsContent
          value="edit"
          forceMount
          className="!mt-0 min-h-0 flex-1 overflow-hidden rounded-md border border-xp-border bg-xp-surface"
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
