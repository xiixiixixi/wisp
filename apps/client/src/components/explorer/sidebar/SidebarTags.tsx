import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getTagPalette, ensureTagPalette } from '@/lib/file-tags-cache';
import { displayTagName } from '@/lib/finder-tags';
import type { FileTag } from '@/lib/tauri-api';

const CUSTOM_TAGS_KEY = 'wisp:custom-finder-tags';

const readCustomTags = (): FileTag[] => {
  try {
    const raw = localStorage.getItem(CUSTOM_TAGS_KEY);
    return raw ? (JSON.parse(raw) as FileTag[]) : [];
  } catch {
    return [];
  }
};

interface SidebarTagsProps {
  currentPath: string;
  navigateToPath: (path: string) => void;
}

/**
 * Finder-style sidebar tags section: the coloured tag list from Finder's
 * own palette (plus custom tags created in Wisp). Clicking one shows every
 * file carrying that tag.
 */
const SidebarTags = ({ currentPath, navigateToPath }: SidebarTagsProps) => {
  const { t } = useTranslation();
  const [tags, setTags] = useState<FileTag[]>([]);

  useEffect(() => {
    ensureTagPalette();
    const refresh = () => {
      const palette = getTagPalette();
      const custom = readCustomTags();
      const names = new Set(palette.map((tag) => tag.name));
      setTags([...palette, ...custom.filter((tag) => !names.has(tag.name))]);
    };
    refresh();
    // Re-read once the Finder palette has loaded asynchronously.
    const timer = setTimeout(refresh, 500);
    const onChanged = () => refresh();
    window.addEventListener('file-tags-changed', onChanged);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('file-tags-changed', onChanged);
    };
  }, []);

  return (
    <div className="wisp-nav-section" role="region" aria-label={t('sidebar.tags')}>
      <h3 className="wisp-nav-section-heading">{t('sidebar.tags')}</h3>
      <div className="space-y-0.5">
        {tags.map((tag) => {
          const target = `wisp://tag/${encodeURIComponent(tag.name)}`;
          const isActive = currentPath === target;
          return (
            <button
              key={tag.name}
              onClick={() => navigateToPath(target)}
              title={t('sidebar.showTagged', { name: displayTagName(tag.name) })}
              aria-current={isActive ? 'page' : undefined}
              className={`wisp-sidebar-item wisp-nav-row ${isActive ? 'wisp-sidebar-item-active' : ''}`}
            >
              <span
                className="h-3 w-3 flex-shrink-0 rounded-full"
                style={{
                  backgroundColor: tag.color,
                }}
                aria-hidden="true"
              />
              <span className="truncate">{displayTagName(tag.name)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default SidebarTags;
