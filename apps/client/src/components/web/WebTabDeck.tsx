import type { TabItem } from '@/types/split-view';
import WebTabView from './WebTabView';
import type { NativeWebPageState } from '@/lib/native-web-tab';

export default function WebTabDeck({
  tabs,
  activeTabId,
  refreshTokens,
  onPageState,
}: {
  tabs: TabItem[];
  activeTabId: string;
  refreshTokens: Record<string, number>;
  onPageState?: (tabId: string, state: NativeWebPageState) => void;
}) {
  const webTabs = tabs.filter((tab) => tab.type === 'web' && /^https?:\/\//i.test(tab.path));
  const visible = webTabs.some((tab) => tab.id === activeTabId);
  return (
    <div className={visible ? 'min-h-0 flex-1' : 'hidden'}>
      {webTabs.map((tab) => (
        <WebTabView
          key={tab.id}
          tabId={tab.id}
          url={tab.path}
          active={tab.id === activeTabId}
          refreshToken={refreshTokens[tab.id] ?? 0}
          onPageState={onPageState}
        />
      ))}
    </div>
  );
}
