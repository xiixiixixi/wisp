import { ExternalLink, Globe, LoaderCircle, RotateCw } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '@/lib/transport';
import { TauriAPI } from '@/lib/tauri-api';
import { useNativeWebTab, type WebLoadState } from '@/hooks/use-native-web-tab';

/** Keep mounted while switching tabs; only navigation, refresh or closing replaces the page. */
const WebTabView = ({
  tabId,
  url,
  active = true,
  refreshToken = 0,
}: {
  tabId: string;
  url: string;
  active?: boolean;
  refreshToken?: number;
}) => {
  const { t } = useTranslation();
  const nativeMode = isTauri();
  const contentRef = useRef<HTMLDivElement>(null);
  const [visited, setVisited] = useState(active);
  const [state, setState] = useState<WebLoadState>('loading');
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const refresh = `${refreshToken}:${attempt}`;
  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);
  useEffect(() => {
    setState('loading');
  }, [url, refresh]);
  useEffect(() => {
    setSlow(false);
    if (state !== 'loading' || !active) return;
    const timer = window.setTimeout(() => setSlow(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [state, active, url, refresh]);

  useNativeWebTab({
    enabled: nativeMode,
    tabId,
    url,
    active,
    refresh,
    contentRef,
    onState: setState,
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
      className={`${active ? 'flex' : 'hidden'} h-full min-h-0 flex-col overflow-hidden bg-xp-bg`}
      aria-hidden={!active}
    >
      <div className="border-xp-border/40 flex min-h-9 shrink-0 items-center gap-2 border-b bg-xp-surface/60 px-3 py-1">
        {state === 'loading' ? (
          <LoaderCircle
            size={13}
            className="shrink-0 animate-spin text-xp-blue motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : (
          <Globe size={13} className="shrink-0 text-xp-text-muted" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1 text-xs text-xp-text-secondary" role="status">
          {statusText}
        </span>
        {(slow || state === 'error') && (
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="wisp-control-icon shrink-0"
            title={t('navigation.webRetry')}
            aria-label={t('navigation.webRetry')}
          >
            <RotateCw size={14} />
          </button>
        )}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="wisp-control-icon shrink-0 text-xp-text-secondary"
          aria-label={t('navigation.openInBrowser')}
          title={nativeMode ? t('navigation.openInBrowser') : t('navigation.webEmbedHelp')}
          onClick={
            nativeMode
              ? (event) => {
                  event.preventDefault();
                  void TauriAPI.openUrl(url).catch(() => setState('error'));
                }
              : undefined
          }
        >
          <ExternalLink size={14} />
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
