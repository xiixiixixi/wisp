import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  ChevronDown,
  ChevronLeft,
  ClipboardPaste,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  FolderPlus,
  Info,
  Link2,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Radio,
  RefreshCw,
  Settings2,
  Trash2,
  X,
  PanelLeftClose,
  type LucideIcon,
} from 'lucide-react';
import { type ShelfItem, type ShelfRecord, type ShelfRequest } from '@/lib/tauri-api';
import { useShelfState } from '@/hooks/use-shelf-state';
import ContextMenu, { type ContextMenuItem } from '@/components/ui/ContextMenu';
import { Dialog, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatFileSize } from '@/lib/utils';
import ShelfManagerItem from './ShelfManagerItem';
import ShelfSummaryItem from './ShelfSummaryItem';
import { ShelfIconButton, ShelfViewToggle } from './ShelfManagerControls';
import { fileEntryFor } from './shelf-view-utils';
import './shelf-manager.css';

type Scope = 'all' | 'pinned';
type ConfirmationAction = 'clear' | 'remove' | 'removeItems';
interface Confirmation {
  action: ConfirmationAction;
  shelfId: string;
  itemIds?: string[];
}
interface Menu {
  kind: 'scope' | 'overview' | 'shelf' | 'items';
  x: number;
  y: number;
  shelfId?: string;
  itemIds?: string[];
}
interface Rename {
  shelfId: string;
  name: string;
}

const ShelfManagerPage = () => {
  const { t, i18n } = useTranslation();
  const { state, loading, error, request, refresh } = useShelfState();
  const [scope, setScope] = useState<Scope>('all');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [view, setView] = useState<'list' | 'gallery'>('gallery');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [rename, setRename] = useState<Rename | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const anchor = useRef<string | null>(null);
  const contentsRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const scopeButtonRef = useRef<HTMLButtonElement>(null);
  const overviewContentsRef = useRef<HTMLDivElement>(null);
  const overviewScrollRef = useRef(0);
  const returnShelfIdRef = useRef<string | null>(null);

  const shelves = useMemo(() => {
    const records = state?.shelves ?? [];
    return scope === 'pinned' ? records.filter((shelf) => shelf.pinned) : records;
  }, [state, scope]);
  const activeShelf = shelves.find((shelf) => shelf.id === activeId) ?? null;
  const inDetails = detailsOpen && activeShelf !== null && state?.supported === true;
  const items = useMemo(() => activeShelf?.items ?? [], [activeShelf]);
  const files = useMemo(() => items.map(fileEntryFor), [items]);
  const draggableFiles = useMemo(
    () => files.filter((_, index) => items[index].available),
    [files, items],
  );
  const selectedPaths = useMemo(
    () =>
      new Set(
        items.filter((item) => selection.has(item.id) && item.available).map((item) => item.path),
      ),
    [items, selection],
  );
  const selectedItems = items.filter((item) => selection.has(item.id));
  const supported = state?.supported === true;
  const canCreate = supported && !pending;
  const canOperate = supported && !pending && activeShelf?.busy !== true;
  const canUseFiles =
    canOperate && inDetails && selectedItems.length > 0 && selectedItems.every((item) => item.available);
  const initialLoading = loading && !state;
  const unavailable = state?.supported === false || (!state && !!error);
  const emptyKey = { all: 'empty', pinned: 'pinnedEmpty' }[scope];
  const locale = i18n.resolvedLanguage || i18n.language || 'zh';
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  );
  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    setSelection(new Set());
    setRename(null);
    setConfirmation(null);
    closeMenu();
    anchor.current = null;
  }, [activeShelf?.id, scope, closeMenu]);

  useEffect(() => {
    const ids = new Set(items.map((item) => item.id));
    setSelection((previous) => {
      const next = new Set([...previous].filter((id) => ids.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [items]);

  useEffect(() => {
    if (state && detailsOpen && !activeShelf) setDetailsOpen(false);
  }, [state, detailsOpen, activeShelf]);

  useEffect(() => {
    if (!inDetails) return;
    const frame = requestAnimationFrame(() => {
      detailRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [inDetails, activeId]);

  const run = async (command: ShelfRequest) => {
    setPending(true);
    try {
      const result = await request(command);
      if (
        command.action === 'create' ||
        command.action === 'clipboard' ||
        (command.action === 'context' && command.command === 'moveToNewShelf')
      ) {
        const before = new Map(state?.shelves.map((shelf) => [shelf.id, shelf]));
        const created = result.shelves.find((shelf) => !before.has(shelf.id));
        const changed = result.shelves.find((shelf) =>
          shelf.items.some(
            (item) => !before.get(shelf.id)?.items.some((old) => old.id === item.id),
          ),
        );
        const destination = created ?? changed;
        setScope('all');
        if (destination) {
          setActiveId(destination.id);
          setDetailsOpen(true);
        }
      } else if (command.action === 'remove' && command.shelfId === activeId) {
        // 删除的是正在查看的架子：回到总览，别停在一条已消失的记录上。
        setDetailsOpen(false);
        setActiveId(null);
      }
      if (command.action === 'clear' || command.action === 'removeItems') setSelection(new Set());
    } catch {
      // Native failures stay visible in the shared resource without inventing local records.
    } finally {
      setPending(false);
    }
  };

  const shelfCommand = (action: 'show' | 'hide' | 'dock', shelfId: string) =>
    void run({ action, shelfId });
  const contextCommand = (
    command: string,
    ids = selectedItems.map((item) => item.id),
    shelfId = activeShelf?.id,
  ) => {
    if (shelfId && ids.length > 0) void run({ action: 'context', shelfId, command, itemIds: ids });
  };
  const showSettings = () =>
    window.dispatchEvent(
      new CustomEvent('wisp-open-settings', {
        detail: { tab: 'shelf', returnFocus: document.activeElement },
      }),
    );
  const openButtonMenu = (kind: Menu['kind'], event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({
      kind,
      x: kind === 'scope' ? rect.left : Math.max(0, rect.right - 216),
      y: rect.bottom + 5,
      shelfId: activeShelf?.id,
    });
  };
  const goBack = () => {
    returnShelfIdRef.current = activeShelf?.id ?? returnShelfIdRef.current;
    setDetailsOpen(false);
    closeMenu();
    requestAnimationFrame(() => {
      const overview = overviewContentsRef.current;
      if (overview) overview.scrollTop = overviewScrollRef.current;
      const target = Array.from(
        overview?.querySelectorAll<HTMLButtonElement>('[data-shelf-summary]') ?? [],
      ).find((button) => button.dataset.shelfSummary === returnShelfIdRef.current);
      (target ?? scopeButtonRef.current)?.focus({ preventScroll: true });
    });
  };
  const openShelf = (shelf: ShelfRecord) => {
    overviewScrollRef.current = overviewContentsRef.current?.scrollTop ?? 0;
    returnShelfIdRef.current = shelf.id;
    setActiveId(shelf.id);
    setDetailsOpen(true);
  };
  const statusLabel = (shelf: ShelfRecord) => {
    if (shelf.busy) return t('shelf.manager.busy');
    if (shelf.docked) return t('shelf.manager.docked');
    return t(`shelf.manager.${shelf.visible ? 'visible' : 'hidden'}`);
  };
  const itemSourceLabel = (item: ShelfItem) =>
    !item.available
      ? t('shelf.manager.missing')
      : t(`shelf.manager.${item.managed ? 'managed' : 'reference'}`);
  const shelfTotalSize = (shelf: ShelfRecord) =>
    shelf.items.filter((item) => item.available).reduce((sum, item) => sum + (item.size ?? 0), 0);

  const selectItem = (item: ShelfItem, event: MouseEvent<HTMLButtonElement>) => {
    if (event.shiftKey && anchor.current) {
      const first = items.findIndex((candidate) => candidate.id === anchor.current);
      const last = items.findIndex((candidate) => candidate.id === item.id);
      if (first >= 0 && last >= 0) {
        const range = items
          .slice(Math.min(first, last), Math.max(first, last) + 1)
          .map((candidate) => candidate.id);
        setSelection(new Set(event.metaKey || event.ctrlKey ? [...selection, ...range] : range));
        return;
      }
    }
    anchor.current = item.id;
    setSelection((previous) => {
      if (!event.metaKey && !event.ctrlKey) return new Set([item.id]);
      const next = new Set(previous);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };
  const removeSelected = () => {
    if (activeShelf) {
      setConfirmation({
        action: 'removeItems',
        shelfId: activeShelf.id,
        itemIds: selectedItems.map((item) => item.id),
      });
    }
  };
  const handleItemKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelection(new Set(items.map((item) => item.id)));
      return;
    }
    if (event.key === ' ' && canUseFiles) {
      event.preventDefault();
      contextCommand('preview');
      return;
    }
    if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      canOperate &&
      selection.size > 0
    ) {
      event.preventDefault();
      removeSelected();
      return;
    }
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = index + 1;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = index - 1;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (nextIndex === null || nextIndex < 0 || nextIndex >= items.length) return;
    event.preventDefault();
    const item = items[nextIndex];
    setSelection(new Set([item.id]));
    anchor.current = item.id;
    const buttons = contentsRef.current?.querySelectorAll<HTMLButtonElement>('[data-shelf-item]');
    buttons?.[nextIndex]?.focus();
  };
  const openItemMenu = (item: ShelfItem, event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!activeShelf) return;
    const ids = selection.has(item.id) ? selectedItems.map((selected) => selected.id) : [item.id];
    setSelection(new Set(ids));
    setMenu({
      kind: 'items',
      x: event.clientX,
      y: event.clientY,
      shelfId: activeShelf.id,
      itemIds: ids,
    });
  };

  const menuAction = (
    id: string,
    label: string,
    Icon: LucideIcon,
    action: () => void,
    disabled = false,
  ): ContextMenuItem => ({
    id,
    label,
    icon: <Icon size={14} strokeWidth={1.6} aria-hidden="true" />,
    action,
    disabled,
  });
  const commonMenuItems = [
    menuAction(
      'refresh',
      t('shelf.manager.refresh'),
      RefreshCw,
      () => void refresh().catch(() => undefined),
      pending || loading,
    ),
    menuAction('settings', t('shelf.manager.settings'), Settings2, showSettings),
  ];
  const menuItems = (() => {
    if (!menu) return [];
    if (menu.kind === 'scope') {
      return (['all', 'pinned'] as const).map((value) => ({
        id: value,
        label: t(`shelf.manager.${value}`),
        checked: scope === value,
        action: () => {
          setScope(value);
          setDetailsOpen(false);
        },
      }));
    }
    if (menu.kind === 'overview') {
      return [
        menuAction(
          'create',
          t('shelf.manager.create'),
          Plus,
          () => void run({ action: 'create' }),
          !canCreate,
        ),
        menuAction(
          'clipboard',
          t('shelf.manager.clipboard'),
          ClipboardPaste,
          () => void run({ action: 'clipboard', forceNew: true }),
          !canCreate,
        ),
        { id: 'create-separator', label: '', separator: true },
        ...commonMenuItems,
      ];
    }
    const shelf = (state?.shelves ?? []).find((record) => record.id === menu.shelfId);
    if (!shelf) return commonMenuItems;
    const disabled = !supported || pending || shelf.busy;
    if (menu.kind === 'items') {
      const ids = menu.itemIds ?? [];
      const available =
        ids.length > 0 &&
        ids.every((id) => shelf.items.some((item) => item.id === id && item.available));
      return [
        menuAction(
          'preview',
          t('shelf.manager.preview'),
          Eye,
          () => contextCommand('preview', ids, shelf.id),
          disabled || !available,
        ),
        menuAction(
          'reveal',
          t('shelf.manager.reveal'),
          FolderOpen,
          () => contextCommand('reveal', ids, shelf.id),
          disabled || !available,
        ),
        menuAction(
          'open',
          t('shelf.manager.open'),
          ExternalLink,
          () => contextCommand('open', ids, shelf.id),
          disabled || !available,
        ),
        { id: 'items-share-separator', label: '', separator: true },
        menuAction(
          'airdrop',
          t('shelf.manager.airdrop'),
          Radio,
          () => contextCommand('airdrop', ids, shelf.id),
          disabled || !available,
        ),
        menuAction(
          'mail',
          t('shelf.manager.mail'),
          Mail,
          () => contextCommand('mail', ids, shelf.id),
          disabled || !available,
        ),
        menuAction(
          'messages',
          t('shelf.manager.messages'),
          MessageSquare,
          () => contextCommand('messages', ids, shelf.id),
          disabled || !available,
        ),
        { id: 'items-file-separator', label: '', separator: true },
        menuAction(
          'copy',
          t('shelf.manager.copy'),
          Copy,
          () => contextCommand('copyItems', ids, shelf.id),
          disabled || !available,
        ),
        menuAction(
          'copyPath',
          t('shelf.manager.copyPath'),
          Link2,
          () => contextCommand('utility:copyPaths', ids, shelf.id),
          disabled || !available,
        ),
        menuAction(
          'moveToNewShelf',
          t('shelf.manager.moveToNewShelf'),
          FolderPlus,
          () => contextCommand('moveToNewShelf', ids, shelf.id),
          disabled || ids.length === 0,
        ),
        menuAction(
          'getInfo',
          t('shelf.manager.getInfo'),
          Info,
          () => contextCommand('getInfo', ids, shelf.id),
          disabled || !available,
        ),
        { id: 'items-danger-separator', label: '', separator: true },
        menuAction(
          'moveToTrash',
          t('shelf.manager.moveToTrash'),
          Trash2,
          () => contextCommand('utility:moveToTrash', ids, shelf.id),
          disabled || !available,
        ),
        { id: 'items-separator', label: '', separator: true },
        menuAction(
          'remove',
          t('shelf.manager.remove'),
          X,
          () => setConfirmation({ action: 'removeItems', shelfId: shelf.id, itemIds: ids }),
          disabled,
        ),
      ];
    }
    const shown = shelf.visible === true;
    const actions = [
      menuAction(
        'visibility',
        t(`shelf.manager.${shown ? 'hide' : 'show'}`),
        shown ? EyeOff : Eye,
        () => shelfCommand(shown ? 'hide' : 'show', shelf.id),
        disabled,
      ),
      menuAction(
        'pin',
        t(`shelf.manager.${shelf.pinned ? 'unpin' : 'pin'}`),
        Pin,
        () => void run({ action: 'pin', shelfId: shelf.id, pinned: !shelf.pinned }),
        disabled,
      ),
      menuAction(
        'rename',
        t('shelf.manager.rename'),
        Pencil,
        () => setRename({ shelfId: shelf.id, name: shelf.name }),
        disabled,
      ),
      menuAction(
        'dock',
        t('shelf.manager.dock'),
        PanelLeftClose,
        () => shelfCommand('dock', shelf.id),
        disabled,
      ),
      { id: 'shelf-separator', label: '', separator: true },
      menuAction(
        'clear',
        t('shelf.manager.clear'),
        Trash2,
        () => setConfirmation({ action: 'clear', shelfId: shelf.id }),
        disabled || shelf.items.length === 0,
      ),
      menuAction(
        'remove',
        t('shelf.manager.delete'),
        Trash2,
        () => setConfirmation({ action: 'remove', shelfId: shelf.id }),
        disabled,
      ),
    ];
    return [
      ...actions,
      { id: 'settings-separator', label: '', separator: true },
      ...commonMenuItems,
    ];
  })();

  const confirmAction = () => {
    if (!confirmation) return;
    if (confirmation.action === 'removeItems') {
      void run({
        action: 'removeItems',
        shelfId: confirmation.shelfId,
        itemIds: confirmation.itemIds ?? [],
      });
    } else void run({ action: confirmation.action, shelfId: confirmation.shelfId });
    setConfirmation(null);
  };
  const confirmationShelf = state?.shelves.find((shelf) => shelf.id === confirmation?.shelfId);
  // 「删除架子」的标题要带上架名，其余沿用通用确认键。
  const confirmationTitle =
    confirmation?.action === 'remove'
      ? t('shelf.manager.deleteConfirm', { name: confirmationShelf?.name ?? '' })
      : t(`shelf.manager.${{ clear: 'clearConfirm', removeItems: 'removeConfirm' }[confirmation?.action ?? 'clear']}`);
  const confirmationMessage =
    confirmation?.action === 'remove'
      ? t('shelf.manager.deleteSafe')
      : t('shelf.manager.originalSafe');
  const confirmationButtonMap: Record<ConfirmationAction, string> = {
    clear: 'clear',
    remove: 'delete',
    removeItems: 'remove',
  };
  const confirmationButtonKey = confirmation
    ? confirmationButtonMap[confirmation.action]
    : 'clear';

  return (
    <section className="shelf-manager" aria-label={t('shelf.manager.title')}>
      {error && state?.supported !== false && (
        <div className="shelf-manager-error" role="alert">
          {error}
        </div>
      )}
      <div className="shelf-manager-stage" data-mode={inDetails ? 'detail' : 'overview'}>
        {/* Only the current scene is mounted; visibility never depends on compositor opacity. */}
        {!inDetails && (
          <div className="shelf-manager-scene shelf-manager-overview">
            <header className="shelf-manager-header">
              <button
                ref={scopeButtonRef}
                type="button"
                className="shelf-manager-scope"
                aria-label={t('shelf.manager.scope')}
                aria-haspopup="menu"
                aria-expanded={menu?.kind === 'scope'}
                title={t(`shelf.manager.${scope}`)}
                onClick={(event) => openButtonMenu('scope', event)}
              >
                <span>{t(`shelf.manager.${scope === 'all' ? 'title' : scope}`)}</span>
                <small>{shelves.length}</small>
                <ChevronDown size={12} strokeWidth={1.6} aria-hidden="true" />
              </button>
              <div className="shelf-manager-tools">
                <ShelfIconButton
                  label={t('shelf.manager.create')}
                  icon={Plus}
                  disabled={!canCreate}
                  onClick={() => void run({ action: 'create' })}
                />
                <ShelfIconButton
                  label={t('shelf.manager.clipboard')}
                  icon={ClipboardPaste}
                  disabled={!canCreate}
                  onClick={() => void run({ action: 'clipboard', forceNew: true })}
                />
                <ShelfViewToggle view={view} onChange={setView} />
                <ShelfIconButton
                  label={t('shelf.manager.more')}
                  icon={MoreHorizontal}
                  menu
                  expanded={menu?.kind === 'overview'}
                  onClick={(event) => openButtonMenu('overview', event)}
                />
              </div>
            </header>
            {initialLoading && (
              <div
                className="shelf-manager-loading"
                role="status"
                aria-label={t('shelf.manager.loading')}
              >
                <div />
                <div />
                <div />
              </div>
            )}
            {!initialLoading && unavailable && (
              <div className="shelf-manager-empty">
                <Archive size={34} strokeWidth={1.6} aria-hidden="true" />
                <h3>{t('shelf.manager.unavailable')}</h3>
                <p>{state?.error || error || t('shelf.manager.desktopOnly')}</p>
                <button
                  className="shelf-manager-command"
                  type="button"
                  onClick={() => void refresh().catch(() => undefined)}
                >
                  <RefreshCw size={14} strokeWidth={1.6} />
                  {t('shelf.manager.retry')}
                </button>
              </div>
            )}
            {!initialLoading && !unavailable && (
              <div
                ref={overviewContentsRef}
                className={`shelf-manager-summaries shelf-manager-summaries-${view}`}
                data-drop-target={supported ? 'wisp://shelves' : undefined}
                data-drop-action={supported ? 'shelf-add' : undefined}
                onContextMenu={(event) => {
                  if ((event.target as Element).closest('[data-shelf-summary]')) return;
                  event.preventDefault();
                  setMenu({ kind: 'overview', x: event.clientX, y: event.clientY });
                }}
              >
                {shelves.map((shelf) => (
                  <ShelfSummaryItem
                    key={shelf.id}
                    shelf={shelf}
                    status={statusLabel(shelf)}
                    onOpen={() => openShelf(shelf)}
                    onShow={() => void shelfCommand('show', shelf.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenu({
                        kind: 'shelf',
                        x: event.clientX,
                        y: event.clientY,
                        shelfId: shelf.id,
                      });
                    }}
                  />
                ))}
                {shelves.length === 0 && (
                  <div className="shelf-manager-empty">
                    <Archive size={34} strokeWidth={1.6} aria-hidden="true" />
                    <h3>{t(`shelf.manager.${emptyKey}`)}</h3>
                    {scope === 'all' && (
                      <button
                        type="button"
                        className="shelf-manager-command"
                        disabled={!canCreate}
                        onClick={() => void run({ action: 'create' })}
                      >
                        <Plus size={14} strokeWidth={1.6} />
                        {t('shelf.manager.create')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {inDetails && activeShelf && (
          <div ref={detailRef} className="shelf-manager-scene shelf-manager-detail">
            <header className="shelf-manager-header">
              <ShelfIconButton
                label={t('shelf.manager.back')}
                icon={ChevronLeft}
                className="shelf-manager-back"
                onClick={goBack}
              />
              <div className="shelf-manager-detail-title">
                <h2 title={activeShelf.name}>{activeShelf.name || t('shelf.manager.unnamed')}</h2>
                <small>
                  {t('shelf.manager.items', { count: items.length })}
                  {shelfTotalSize(activeShelf) > 0
                    ? ` · ${formatFileSize(shelfTotalSize(activeShelf))}`
                    : ''}{' '}
                  · {statusLabel(activeShelf)}
                  {selection.size > 0 &&
                    ` · ${t('shelf.manager.selected', { count: selection.size })}`}
                </small>
              </div>
              <div className="shelf-manager-tools">
                <ShelfViewToggle view={view} onChange={setView} />
                <ShelfIconButton
                  label={t('shelf.manager.more')}
                  icon={MoreHorizontal}
                  menu
                  expanded={menu?.kind === 'shelf'}
                  onClick={(event) => openButtonMenu('shelf', event)}
                />
              </div>
            </header>
            <div
              ref={contentsRef}
              className={`shelf-manager-contents shelf-manager-${view}`}
              role="listbox"
              aria-label={t('shelf.manager.contents')}
              aria-multiselectable="true"
              data-drop-target={`shelf:${activeShelf.id}`}
              data-drop-action="shelf-add"
              onContextMenu={(event) => {
                if ((event.target as Element).closest('[data-shelf-item]')) return;
                event.preventDefault();
                setSelection(new Set());
                setMenu({
                  kind: 'shelf',
                  x: event.clientX,
                  y: event.clientY,
                  shelfId: activeShelf.id,
                });
              }}
              onClick={(event) => {
                if (
                  !(event.target instanceof Element) ||
                  !event.target.closest('[data-shelf-item]')
                ) {
                  setSelection(new Set());
                }
              }}
            >
              {view === 'list' && items.length > 0 && (
                <div className="shelf-manager-list-head" aria-hidden="true">
                  <span>{t('shelf.manager.name')}</span>
                  <span>{t('shelf.manager.source')}</span>
                  <span>{t('shelf.manager.added')}</span>
                </div>
              )}
              {items.map((item, index) => (
                <ShelfManagerItem
                  key={item.id}
                  item={item}
                  file={files[index]}
                  files={draggableFiles}
                  selectedPaths={selectedPaths}
                  selected={selection.has(item.id)}
                  copyOnly={state?.settings?.copyOnDrag === true}
                  dragEnabled={
                    inDetails &&
                    canOperate &&
                    item.available &&
                    selectedItems.every((selected) => selected.available)
                  }
                  view={view}
                  sourceLabel={itemSourceLabel(item)}
                  addedLabel={dateFormatter.format(item.addedAt)}
                  onClick={(event) => selectItem(item, event)}
                  onDoubleClick={() => {
                    if (item.available && canOperate) {
                      contextCommand('preview', [item.id]);
                    }
                  }}
                  onKeyDown={(event) => handleItemKey(event, index)}
                  onContextMenu={(event) => openItemMenu(item, event)}
                />
              ))}
              {items.length === 0 && (
                <div className="shelf-manager-empty">
                  <Archive size={34} strokeWidth={1.6} aria-hidden="true" />
                  <h3>{t('shelf.manager.noItems')}</h3>
                  <p>{t('shelf.manager.dropHint')}</p>
                </div>
              )}
            </div>
            {selection.size > 0 && (
              <div
                className="shelf-manager-selection"
                role="toolbar"
                aria-label={t('shelf.manager.selected', { count: selection.size })}
              >
                <span>{t('shelf.manager.selected', { count: selection.size })}</span>
                <div className="shelf-manager-tools">
                  <ShelfIconButton
                    label={t('shelf.manager.preview')}
                    icon={Eye}
                    disabled={!canUseFiles}
                    onClick={() => contextCommand('preview')}
                  />
                  <ShelfIconButton
                    label={t('shelf.manager.reveal')}
                    icon={FolderOpen}
                    disabled={!canUseFiles}
                    onClick={() => contextCommand('reveal')}
                  />
                  <ShelfIconButton
                    label={t('shelf.manager.airdrop')}
                    icon={Radio}
                    disabled={!canUseFiles}
                    onClick={() => contextCommand('airdrop')}
                  />
                  <button
                    type="button"
                    className="shelf-manager-primary"
                    disabled={!canUseFiles}
                    onClick={() => contextCommand('copyItems')}
                  >
                    {t('shelf.manager.copyCount', { count: selection.size })}
                  </button>
                  <ShelfIconButton
                    label={t('shelf.manager.remove')}
                    icon={X}
                    disabled={!canOperate}
                    onClick={removeSelected}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {menu &&
        createPortal(
          <ContextMenu isOpen x={menu.x} y={menu.y} onClose={closeMenu} items={menuItems} />,
          document.body,
        )}
      <Dialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
        maxWidth={380}
      >
        <div className="shelf-manager-confirm">
          <DialogTitle>{confirmationTitle}</DialogTitle>
          <p>{confirmationMessage}</p>
          <div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setConfirmation(null)}
              data-autofocus
            >
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={confirmAction}>
              {t(`shelf.manager.${confirmationButtonKey}`)}
            </Button>
          </div>
        </div>
      </Dialog>
      <Dialog
        open={rename !== null}
        onOpenChange={(open) => {
          if (!open) setRename(null);
        }}
        maxWidth={360}
      >
        <form
          className="shelf-manager-rename"
          onSubmit={(event) => {
            event.preventDefault();
            if (rename?.name.trim()) {
              void run({ action: 'rename', shelfId: rename.shelfId, name: rename.name.trim() });
            }
            setRename(null);
          }}
        >
          <DialogTitle>{t('shelf.manager.rename')}</DialogTitle>
          <input
            aria-label={t('shelf.manager.name')}
            value={rename?.name ?? ''}
            autoFocus
            maxLength={200}
            onChange={(event) =>
              setRename((previous) =>
                previous ? { ...previous, name: event.target.value } : previous,
              )
            }
          />
          <div>
            <Button size="sm" variant="secondary" onClick={() => setRename(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={!rename?.name.trim()}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
};

export default ShelfManagerPage;
