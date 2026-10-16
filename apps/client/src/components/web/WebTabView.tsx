import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '@/lib/transport';
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
  const [_slow, setSlow] = useState(false);
  const [attempt] = useState(0);
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

  const observePage = useCallback(
    (page: NativeWebPageState) => {
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
  return (
    <div
      className={`${active ? 'flex' : 'hidden'} relative h-full min-h-0 flex-col overflow-hidden bg-xp-bg`}
      aria-hidden={!active}
    >
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
