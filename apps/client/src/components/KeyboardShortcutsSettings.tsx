import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { TauriAPI, ShortcutBinding } from '@/lib/tauri-api';
import {
  getKeyString,
  formatKeyComboForDisplay,
  getCategoryForAction,
  getLabelForAction,
} from '@/lib/shortcut-utils';
import {
  Search,
  FileText,
  Navigation,
  CheckSquare,
  LayoutGrid,
  Settings2,
  Terminal,
  Puzzle,
  RotateCcw,
  X,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Keyboard,
} from 'lucide-react';

interface CategoryDef {
  label: string;
  icon: React.ElementType;
}

const CATEGORIES: Record<string, CategoryDef> = {
  'file-operations': { label: 'fileOperations', icon: FileText },
  navigation: { label: 'navigation', icon: Navigation },
  selection: { label: 'selection', icon: CheckSquare },
  search: { label: 'search', icon: Search },
  view: { label: 'view', icon: LayoutGrid },
  application: { label: 'application', icon: Settings2 },
  terminal: { label: 'terminal', icon: Terminal },
  extensions: { label: 'extensions', icon: Puzzle },
};

const categoryLabel = (t: (k: string) => string, cat: string): string => {
  const key = CATEGORIES[cat]?.label;
  return key ? t(`settings.shortcuts.categories.${key}`) : cat;
};

const KeyboardShortcutsSettings = () => {
  const { t } = useTranslation();
  const [shortcuts, setShortcuts] = useState<ShortcutBinding[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [capturedCombo, setCapturedCombo] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ShortcutBinding | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const loadShortcuts = useCallback(async () => {
    try {
      const data = await TauriAPI.getShortcuts();
      setShortcuts(data);
    } catch (err) {
      console.error('Failed to load shortcuts:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadShortcuts();
  }, [loadShortcuts]);

  // Key capture handler
  useEffect(() => {
    if (!editingId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const combo = getKeyString(e);
      // Ignore bare modifier presses
      if (!combo || combo === 'ctrl' || combo === 'alt' || combo === 'shift' || combo === 'meta') {
        return;
      }

      // Escape cancels editing
      if (e.key === 'Escape') {
        setEditingId(null);
        setCapturedCombo(null);
        setConflict(null);
        return;
      }

      setCapturedCombo(combo);

      // Check for conflicts
      const existing = shortcuts.find(
        (s) =>
          s.id !== editingId &&
          (typeof s.key_combination === 'string' ? s.key_combination : '') === combo &&
          s.enabled,
      );
      setConflict(existing || null);
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [editingId, shortcuts]);

  const handleConfirmEdit = async () => {
    if (!editingId || !capturedCombo) return;

    const binding = shortcuts.find((s) => s.id === editingId);
    if (!binding) return;

    const updated: ShortcutBinding = {
      ...binding,
      key_combination: capturedCombo,
      keys: capturedCombo.split('+'),
    };

    try {
      await TauriAPI.updateShortcut(updated);
      await loadShortcuts();
      window.dispatchEvent(new CustomEvent('shortcuts-changed'));
    } catch (err) {
      console.error('Failed to update shortcut:', err);
    }

    setEditingId(null);
    setCapturedCombo(null);
    setConflict(null);
  };

  const handleResetSingle = async (id: string) => {
    try {
      await TauriAPI.resetSingleShortcut(id);
      await loadShortcuts();
      window.dispatchEvent(new CustomEvent('shortcuts-changed'));
    } catch (err) {
      console.error('Failed to reset shortcut:', err);
    }
  };

  const handleResetAll = async () => {
    try {
      await TauriAPI.resetShortcuts();
      await loadShortcuts();
      window.dispatchEvent(new CustomEvent('shortcuts-changed'));
    } catch (err) {
      console.error('Failed to reset shortcuts:', err);
    }
  };

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // Group shortcuts by category
  const getKeyComboString = (s: ShortcutBinding): string =>
    typeof s.key_combination === 'string' ? s.key_combination : '';

  const query = searchQuery.toLowerCase();
  const filtered = shortcuts.filter((s) => {
    if (!query) return true;
    const desc = (s.description || '').toLowerCase();
    const id = s.id.toLowerCase();
    const combo = getKeyComboString(s).toLowerCase();
    const label = getLabelForAction(s.action).toLowerCase();
    return (
      desc.includes(query) || id.includes(query) || combo.includes(query) || label.includes(query)
    );
  });

  const grouped = new Map<string, ShortcutBinding[]>();
  for (const s of filtered) {
    const cat = s.id.includes('.') ? 'extensions' : getCategoryForAction(s.action);
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(s);
  }

  // Sort categories in defined order
  const categoryOrder = Object.keys(CATEGORIES);
  const sortedCategories = [...grouped.keys()].sort(
    (a, b) =>
      (categoryOrder.indexOf(a) === -1 ? 99 : categoryOrder.indexOf(a)) -
      (categoryOrder.indexOf(b) === -1 ? 99 : categoryOrder.indexOf(b)),
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-xp-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-xp-text-secondary"
        />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('settings.shortcuts.searchPlaceholder')}
          className="placeholder:text-xp-text-secondary/50 h-9 w-full rounded-md border border-xp-border bg-xp-bg pl-9 pr-3 text-sm text-xp-text transition-colors focus:border-xp-accent focus:outline-none focus:ring-1 focus:ring-xp-accent"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-xp-text-secondary hover:text-xp-text"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Shortcut count */}
      <div className="px-1 text-xs text-xp-text-secondary">
        {searchQuery
          ? t('settings.shortcuts.countMatching', { count: filtered.length, query: searchQuery })
          : t('settings.shortcuts.count', { count: filtered.length })}
      </div>

      {/* Category groups */}
      <div className="space-y-2">
        {sortedCategories.map((cat) => {
          const def = CATEGORIES[cat];
          const Icon = def?.icon || Keyboard;
          const items = grouped.get(cat)!;
          const isCollapsed = collapsedCategories.has(cat);

          return (
            <div key={cat} className="border-xp-border/50 overflow-hidden rounded-lg border">
              {/* Category header */}
              <button
                onClick={() => toggleCategory(cat)}
                className="bg-xp-surface/50 flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-xp-surface"
              >
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <Icon size={15} className="text-xp-text-secondary" />
                <span className="text-sm font-medium text-xp-text">{categoryLabel(t, cat)}</span>
                <span className="ml-auto text-xs text-xp-text-secondary">{items.length}</span>
              </button>

              {/* Shortcut rows */}
              {!isCollapsed && (
                <div className="divide-xp-border/30 divide-y">
                  {items.map((shortcut) => {
                    const combo = getKeyComboString(shortcut);
                    const isEditing = editingId === shortcut.id;
                    const isExtension = shortcut.id.includes('.');
                    const extensionName = isExtension ? shortcut.id.split('.')[0] : null;

                    return (
                      <div
                        key={shortcut.id}
                        className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
                          isEditing ? 'bg-xp-accent/5' : 'hover:bg-xp-surface-light/30'
                        }`}
                      >
                        {/* Label + description */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm text-xp-text">
                              {(() => {
                                const actionLabel = getLabelForAction(shortcut.action);
                                return typeof shortcut.action === 'string' &&
                                  actionLabel !== shortcut.action
                                  ? actionLabel
                                  : shortcut.description || actionLabel;
                              })()}
                            </span>
                            {isExtension && (
                              <span className="bg-xp-purple/15 inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-xp-purple">
                                <Puzzle size={10} />
                                {extensionName}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Key badge */}
                        <button
                          onClick={() => {
                            if (isEditing) {
                              setEditingId(null);
                              setCapturedCombo(null);
                              setConflict(null);
                            } else {
                              setEditingId(shortcut.id);
                              setCapturedCombo(null);
                              setConflict(null);
                            }
                          }}
                          title={
                            isEditing
                              ? t('settings.shortcuts.cancelEditing')
                              : t('settings.shortcuts.clickToEdit')
                          }
                          className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-xs transition-all ${
                            isEditing
                              ? 'bg-xp-accent/10 animate-pulse border-xp-accent text-xp-accent'
                              : 'border-xp-border bg-xp-bg text-xp-text-secondary hover:border-xp-text-secondary hover:text-xp-text'
                          }`}
                        >
                          {(() => {
                            if (isEditing) {
                              return capturedCombo
                                ? formatKeyComboForDisplay(capturedCombo)
                                : t('settings.shortcuts.pressKeys');
                            }
                            return (
                              formatKeyComboForDisplay(combo) || t('settings.shortcuts.unbound')
                            );
                          })()}
                        </button>

                        {/* Confirm / Reset */}
                        {isEditing && capturedCombo ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={handleConfirmEdit}
                              className="hover:bg-xp-accent/80 shrink-0 rounded bg-xp-accent px-2 py-1 text-xs font-medium text-white transition-colors"
                            >
                              {t('settings.shortcuts.save')}
                            </button>
                            <button
                              onClick={() => {
                                setEditingId(null);
                                setCapturedCombo(null);
                                setConflict(null);
                              }}
                              className="shrink-0 rounded px-2 py-1 text-xs text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text"
                            >
                              {t('settings.shortcuts.cancel')}
                            </button>
                          </div>
                        ) : (
                          !isEditing &&
                          !isExtension && (
                            <button
                              onClick={() => handleResetSingle(shortcut.id)}
                              title={t('settings.shortcuts.resetToDefault')}
                              className="text-xp-text-secondary/40 shrink-0 rounded p-1 transition-colors hover:text-xp-text-secondary"
                            >
                              <RotateCcw size={13} />
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Conflict warning (shown when editing) */}
      {editingId && conflict && (
        <div className="border-xp-yellow/30 bg-xp-yellow/5 flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm">
          <AlertTriangle size={16} className="shrink-0 text-xp-yellow" />
          <span className="text-xp-text">
            {t('settings.shortcuts.conflictsWith', {
              name: conflict.description || conflict.id,
            })}
          </span>
        </div>
      )}

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="py-8 text-center text-xp-text-secondary">
          {searchQuery
            ? t('settings.shortcuts.noMatching', { query: searchQuery })
            : t('settings.shortcuts.noShortcuts')}
        </div>
      )}

      {/* Reset all */}
      <div className="pt-2">
        <button
          onClick={handleResetAll}
          className="hover:bg-xp-red/5 flex items-center gap-2 rounded-md px-3 py-2 text-sm text-xp-text-secondary transition-colors hover:text-xp-red"
        >
          <RotateCcw size={14} />
          {t('settings.shortcuts.resetAll')}
        </button>
      </div>
    </div>
  );
};

export default KeyboardShortcutsSettings;
