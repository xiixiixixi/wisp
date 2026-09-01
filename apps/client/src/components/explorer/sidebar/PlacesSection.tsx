import { Home, FileText, Download, Monitor, Image } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface UserDirectories {
  home: string;
  documents: string;
  downloads: string;
  desktop: string;
  pictures: string;
  videos: string;
  music: string;
}

interface PlacesSectionProps {
  userDirectories: UserDirectories | null;
  currentPath: string;
  navigateToPath: (path: string) => void;
}

const PlacesSection = ({ userDirectories, currentPath, navigateToPath }: PlacesSectionProps) => {
  const { t } = useTranslation();
  return (
    <div
      className="border-b border-xp-border px-3 py-2"
      role="region"
      aria-label={t('sidebar.quickAccess')}
    >
      <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-xp-text-muted">
        {t('sidebar.quickAccess')}
      </h4>
      <div className="space-y-0.5">
        {userDirectories &&
          (
            [
              {
                path: 'wisp://home',
                Icon: Home,
                labelKey: 'sidebar.home',
              },
              {
                path: userDirectories.documents,
                Icon: FileText,
                labelKey: 'sidebar.documents',
              },
              {
                path: userDirectories.downloads,
                Icon: Download,
                labelKey: 'sidebar.downloads',
              },
              {
                path: userDirectories.desktop,
                Icon: Monitor,
                labelKey: 'sidebar.desktop',
              },
              {
                path: userDirectories.pictures,
                Icon: Image,
                labelKey: 'sidebar.pictures',
              },
            ] as const
          ).map(({ path, Icon, labelKey }) => {
            const label = t(labelKey);
            const isActive = currentPath === path;
            return (
              <button
                key={labelKey}
                onClick={() => navigateToPath(path)}
                className={`flex w-full items-center rounded-[2px] px-2 py-1.5 text-xs transition-colors ${
                  isActive ? 'wisp-sidebar-item-active' : 'text-xp-text hover:bg-xp-surface-light'
                }`}
                aria-label={t('sidebar.navigateTo', { label })}
              >
                <Icon
                  size={15}
                  className="mr-2.5 flex-shrink-0 text-xp-text-secondary"
                  aria-hidden="true"
                />
                {label}
              </button>
            );
          })}
      </div>
    </div>
  );
};

export type { UserDirectories };

export default PlacesSection;
