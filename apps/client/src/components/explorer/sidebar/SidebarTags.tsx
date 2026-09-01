import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getTagPalette, ensureTagPalette } from '@/lib/file-tags-cache';
import { displayTagName, hexA } from '@/lib/finder-tags';
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
    <div
      className="border-b border-xp-border px-3 py-2"
      role="region"
      aria-label={t('sidebar.tags')}
    >
      <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-xp-text-muted">
        {t('sidebar.tags')}
      </h4>
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
              className={`flex min-h-7 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors ${
                isActive ? 'text-xp-text' : 'text-xp-text-secondary hover:text-xp-text'
              }`}
              style={isActive ? { backgroundColor: hexA(tag.color, 0.12) } : undefined}
            >
              <span
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
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
