import { ExternalLink, LoaderCircle, RotateCw } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '@/lib/transport';
import { TauriAPI } from '@/lib/tauri-api';
import { useNativeWebTab, type WebLoadState } from '@/hooks/use-native-web-tab';
import type { NativeWebPageState } from '@/lib/native-web-tab';

/** Keep mounted while switching tabs; only navigation, refresh or closing replaces the page. */
const WebTabView = ({
  tabId,
  url,
  active = true,
  refreshToken = 0,
  onPageState,
}: {
  tabId: string;
  url: string;
  active?: boolean;
  refreshToken?: number;
  onPageState?: (tabId: string, state: NativeWebPageState) => void;
}) => {
  const { t } = useTranslation();
  const nativeMode = isTauri();
  const contentRef = useRef<HTMLDivElement>(null);
  const [visited, setVisited] = useState(active);
  const [state, setState] = useState<WebLoadState>('loading');
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pageUrl, setPageUrl] = useState(url);
  const refresh = `${refreshToken}:${attempt}`;
  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);
  useEffect(() => {
    setState('loading');
  }, [url, refresh]);
  useEffect(() => setPageUrl(url), [url]);
  useEffect(() => {
    setSlow(false);
    if (state !== 'loading' || !active) return;
    const timer = window.setTimeout(() => setSlow(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [state, active, url, refresh]);

  const observePage = useCallback(
    (page: NativeWebPageState) => {
      setPageUrl(page.url);
      if (page.loading !== null) {
        setState((current) =>
          page.loading ? 'loading' : current === 'loading' ? 'idle' : current,
        );
      }
      onPageState?.(tabId, page);
    },
    [tabId, onPageState],
  );
  useNativeWebTab({
    enabled: nativeMode,
    tabId,
    url,
    active,
    refresh,
    contentRef,
    onState: setState,
    onPageState: observePage,
  });
  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {
    /* Address validation happens before opening. */
  }
  let statusText = '';
  if (state === 'error') statusText = t('navigation.webLoadFailed');
  else if (slow) statusText = t('navigation.webLoadSlow');
  else if (state === 'loading') statusText = t('navigation.webLoading');

  return (
    <div
      className={`${active ? 'flex' : 'hidden'} relative h-full min-h-0 flex-col overflow-hidden bg-xp-bg`}
      aria-hidden={!active}
    >
      {/* 状态+操作浮层胶囊：不再独占一行，浮在网页右上角（用户：整排压缩掉、
          图标要垂直居中）。加载/出错时才出现文字，平时只是两枚小按钮。 */}
      <div className="border-xp-border/60 pointer-events-none absolute right-1.5 top-1.5 z-10 flex items-center gap-1 rounded-md border bg-xp-surface/85 px-1.5 py-1 shadow-sm backdrop-blur-sm">
        {state === 'loading' && (
          <>
            <LoaderCircle
              size={12}
              className="shrink-0 animate-spin text-xp-blue motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span className="text-[11px] text-xp-text-secondary" role="status">
              {statusText}
            </span>
          </>
        )}
        {(slow || state === 'error') && (
          <>
            {state !== 'loading' && (
              <span className="px-1 text-[11px] text-xp-text-secondary" role="status">
                {statusText}
              </span>
            )}
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
              className="wisp-control-icon shrink-0"
              title={t('navigation.webRetry')}
              aria-label={t('navigation.webRetry')}
            >
              <RotateCw size={13} />
            </button>
          </>
        )}
        <a
          href={pageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="wisp-control-icon shrink-0 text-xp-text-secondary"
          aria-label={t('navigation.openInBrowser')}
          title={nativeMode ? t('navigation.openInBrowser') : t('navigation.webEmbedHelp')}
          onClick={
            nativeMode
              ? (event) => {
                  event.preventDefault();
                  void TauriAPI.openUrl(pageUrl).catch(() => setState('error'));
                }
              : undefined
          }
        >
          <ExternalLink size={13} />
        </a>
      </div>
      <div ref={contentRef} className="relative min-h-0 flex-1 bg-white">
        {!nativeMode && (active || visited) && (
          <iframe
            key={`${url}:${refresh}`}
            src={url}
            title={t('navigation.webPage', { hostname })}
            className="h-full w-full border-0"
            loading="eager"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            // Browsers do not expose cross-origin load errors. A load event only
            // ends the indicator, not proof of success; the external-open action
            // remains available for sites that deny embedding via CSP/XFO.
            onLoad={() => setState('idle')}
          />
        )}
      </div>
    </div>
  );
};

export default WebTabView;
