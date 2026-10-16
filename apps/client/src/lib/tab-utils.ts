import { FolderClosed, File, FileCode, GitCompareArrows, Cloud, House, Archive } from 'lucide-react';
import type { TabItem } from '@/types/split-view';

/** Return the appropriate lucide icon component for a given tab type. */
export const getTabIcon = (tab: TabItem) => {
  if (tab.path === 'wisp://home') return House;
  if (tab.path === 'wisp://shelves') return Archive;
  switch (tab.type) {
    case 'editor':
      return FileCode;
    case 'comparison':
      return GitCompareArrows;
    case 'gdrive':
    case 'gdrive-manager':
      return Cloud;
    case 'folder':
      return FolderClosed;
    default:
      return File;
  }
};
