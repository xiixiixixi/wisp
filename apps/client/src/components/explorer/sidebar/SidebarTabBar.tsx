import React from 'react';
import { FolderTree } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface SidebarTab {
  id: string;
  title: string;
  icon: React.ReactNode;
}

interface SidebarTabBarProps {
  activeTabId: string;
  onTabClick: (tabId: string) => void;
  extensionTabs: SidebarTab[];
}

const TAB_CLASS_ACTIVE = 'bg-xp-blue/15 text-xp-blue';
const TAB_CLASS_INACTIVE = 'text-xp-text-muted hover:bg-xp-surface-light hover:text-xp-text';

const SidebarTabBar = ({ activeTabId, onTabClick, extensionTabs }: SidebarTabBarProps) => {
  const { t } = useTranslation();
  const tabClass = (tabId: string) =>
    `wisp-sidebar-tab flex items-center justify-center rounded-[2px] transition-colors ${
      activeTabId === tabId ? TAB_CLASS_ACTIVE : TAB_CLASS_INACTIVE
    }`;

  return (
    <div
      className="border-b border-xp-border"
      style={{
        display: 'flex',
        alignItems: 'center',
        height: '36px',
        padding: '0 8px',
        gap: '2px',
        flexShrink: 0,
      }}
      role="tablist"
      aria-label={t('sidebar.tabs')}
    >
      {/* Explorer tab */}
      <button
        role="tab"
        onClick={() => onTabClick('__explorer__')}
        className={tabClass('__explorer__')}
        style={{ width: 28, height: 28, padding: 0 }}
        aria-label={t('sidebar.fileExplorer')}
        aria-selected={activeTabId === '__explorer__'}
        title={t('sidebar.fileExplorer')}
      >
        <FolderTree size={15} />
      </button>

      {/* Extension-registered sidebar tabs */}
      {extensionTabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          onClick={() => onTabClick(tab.id)}
          className={tabClass(tab.id)}
          style={{ width: 28, height: 28, padding: 0 }}
          aria-label={tab.title}
          aria-selected={activeTabId === tab.id}
          title={tab.title}
        >
          {tab.icon}
        </button>
      ))}
    </div>
  );
};

export default SidebarTabBar;
