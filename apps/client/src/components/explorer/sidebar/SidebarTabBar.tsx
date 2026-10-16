import { useRef, type ReactNode } from 'react';
import { FolderTree } from 'lucide-react';
import { useTranslation } from 'react-i18next';
interface SidebarTab {
  id: string;
  title: string;
  icon: ReactNode;
}
interface SidebarTabBarProps {
  activeTabId: string;
  onTabClick: (tabId: string) => void;
  extensionTabs: SidebarTab[];
}
const SidebarTabBar = ({ activeTabId, onTabClick, extensionTabs }: SidebarTabBarProps) => {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const tabs = [
    { id: '__explorer__', title: t('sidebar.fileExplorer'), icon: <FolderTree size={16} /> },
    ...extensionTabs,
  ];
  return (
    <div
      ref={listRef}
      className="wisp-sidebar-tablist"
      role="tablist"
      aria-label={t('sidebar.tabs')}
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          onClick={() => onTabClick(tab.id)}
          className="wisp-sidebar-tab"
          tabIndex={activeTabId === tab.id ? 0 : -1}
          aria-selected={activeTabId === tab.id}
          aria-label={tab.title}
          title={tab.title}
          onKeyDown={(event) => {
            let next: number;
            if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
            else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = tabs.length - 1;
            else return;
            event.preventDefault();
            onTabClick(tabs[next].id);
            listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
          }}
        >
          <span aria-hidden="true" className="shrink-0">
            {tab.icon}
          </span>
          <span className="truncate">{tab.title}</span>
        </button>
      ))}
    </div>
  );
};
export default SidebarTabBar;
