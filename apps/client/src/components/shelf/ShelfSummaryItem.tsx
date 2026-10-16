import type { KeyboardEvent, MouseEvent } from 'react';
import { Archive, Eye, Pin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ShelfRecord } from '@/lib/tauri-api';
import FinderFileIcon from '@/components/explorer/FinderFileIcon';
import { fileEntryFor } from './shelf-view-utils';

interface ShelfSummaryItemProps {
  shelf: ShelfRecord;
  status: string;
  onOpen: (button: HTMLElement) => void;
  onShow: () => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
}

const ShelfSummaryItem = ({
  shelf,
  status,
  onOpen,
  onShow,
  onContextMenu,
}: ShelfSummaryItemProps) => {
  const { t } = useTranslation();
  const name = shelf.name || t('shelf.manager.unnamed');
  const count = t('shelf.manager.items', { count: shelf.items.length });
  const open = (event: React.MouseEvent<HTMLElement>) => onOpen(event.currentTarget);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onOpen(event.currentTarget);
  };
  return (
    // 卡片本身是"在管理器里看文件"，右上角那颗按钮才是"把悬浮栏叫出来"。
    // 以前后者只藏在右键菜单里，等于没有——从收集架页把悬浮栏叫出来是做不到的。
    <div
      className="shelf-summary"
      data-shelf-summary={shelf.id}
      data-drop-target={`shelf:${shelf.id}`}
      data-drop-action="shelf-add"
      role="button"
      tabIndex={0}
      aria-label={`${name}, ${count}`}
      title={`${name}\n${count} · ${status}`}
      onClick={open}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        className="shelf-summary-show"
        title={t('shelf.manager.show')}
        aria-label={t('shelf.manager.show')}
        onClick={(event) => {
          event.stopPropagation();
          onShow();
        }}
      >
        <Eye size={13} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <span className="shelf-summary-preview" aria-hidden="true">
        {shelf.items.length === 0 ? (
          <Archive size={38} strokeWidth={1.6} />
        ) : (
          shelf.items.slice(0, 3).map((item, index) => (
            <span
              key={item.id}
              className={`shelf-summary-sheet ${!item.available ? 'shelf-summary-sheet-missing' : ''}`}
              data-layer={index}
            >
              <FinderFileIcon
                file={fileEntryFor(item)}
                fallback={<Archive size={36} strokeWidth={1.6} />}
              />
            </span>
          ))
        )}
      </span>
      <span className="shelf-summary-caption">
        <span className="shelf-summary-name">
          <span>{name}</span>
          {shelf.pinned && (
            <Pin size={11} strokeWidth={1.6} aria-label={t('shelf.manager.pinned')} />
          )}
        </span>
        <small>
          {count} · {status}
        </small>
      </span>
    </div>
  );
};

export default ShelfSummaryItem;
