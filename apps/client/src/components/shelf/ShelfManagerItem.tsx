import type { KeyboardEvent, MouseEvent } from 'react';
import { Archive } from 'lucide-react';
import type { FileEntry, ShelfItem } from '@/lib/tauri-api';
import { formatFileSize } from '@/lib/utils';
import { useDraggable } from '@/hooks/use-draggable';
import FinderFileIcon from '@/components/explorer/FinderFileIcon';

interface ShelfManagerItemProps {
  item: ShelfItem;
  file: FileEntry;
  files: FileEntry[];
  selectedPaths: Set<string>;
  selected: boolean;
  dragEnabled: boolean;
  copyOnly: boolean;
  view: 'list' | 'gallery';
  sourceLabel: string;
  addedLabel: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onDoubleClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
}

const ShelfManagerItem = ({
  item,
  file,
  files,
  selectedPaths,
  selected,
  dragEnabled,
  copyOnly,
  view,
  sourceLabel,
  addedLabel,
  onClick,
  onDoubleClick,
  onKeyDown,
  onContextMenu,
}: ShelfManagerItemProps) => {
  const dragHandlers = useDraggable({
    file,
    allFiles: files,
    selectedFiles: selectedPaths,
    copyOnly,
  });
  const sizeLabel =
    item.available && item.size && item.size > 0 ? formatFileSize(item.size) : '';
  const detailLabel = item.available && sizeLabel ? sizeLabel : sourceLabel;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-shelf-item={item.id}
      className={`shelf-manager-item ${!item.available ? 'shelf-manager-item-missing' : ''}`}
      {...(dragEnabled ? dragHandlers : {})}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
      title={`${item.path}\n${sourceLabel}${sizeLabel ? ` · ${sizeLabel}` : ''}`}
    >
      <span className="shelf-manager-item-image">
        <FinderFileIcon file={file} fallback={<Archive size={26} strokeWidth={1.6} />} />
      </span>
      <span className="shelf-manager-item-name">
        <span>{item.name}</span>
        {view === 'gallery' && <small>{detailLabel}</small>}
      </span>
      {view === 'list' && (
        <>
          <span className="shelf-manager-item-source">{item.path}</span>
          <span className="shelf-manager-item-date">{addedLabel}</span>
        </>
      )}
    </button>
  );
};

export default ShelfManagerItem;
