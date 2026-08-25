import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TauriAPI, type TagCategory } from '@/lib/tauri-api';
import { Tags, X, Plus, Check, Pencil, Trash2, ChevronRight } from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

const PRESET_COLORS = [
  { label: 'dialogs.colors.blue', value: '#7aa2f7' },
  { label: 'dialogs.colors.green', value: '#9ece6a' },
  { label: 'dialogs.colors.red', value: '#f7768e' },
  { label: 'dialogs.colors.orange', value: '#ff9e64' },
  { label: 'dialogs.colors.purple', value: '#bb9af7' },
  { label: 'dialogs.colors.yellow', value: '#e0af68' },
];

interface TagCategoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TreeNode {
  category: TagCategory;
  children: TreeNode[];
  depth: number;
}

const buildTree = (categories: TagCategory[]): TreeNode[] => {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  // Create nodes
  for (const cat of categories) {
    map.set(cat.id, { category: cat, children: [], depth: 0 });
  }

  // Build tree
  for (const cat of categories) {
    const node = map.get(cat.id)!;
    if (cat.parent_id && map.has(cat.parent_id)) {
      const parent = map.get(cat.parent_id)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Fix depths recursively
  const setDepths = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      n.depth = depth;
      setDepths(n.children, depth + 1);
    }
  };
  setDepths(roots, 0);

  return roots;
};

const flattenTree = (nodes: TreeNode[]): TreeNode[] => {
  const result: TreeNode[] = [];
  for (const n of nodes) {
    result.push(n);
    result.push(...flattenTree(n.children));
  }
  return result;
};

const TagCategoryDialog = ({ isOpen, onClose }: TagCategoryDialogProps) => {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<TagCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0].value);
  const [newParentId, setNewParentId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setShowAddForm(false);
    setEditingId(null);

    setLoading(true);
    TauriAPI.getTagCategories()
      .then(setCategories)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [isOpen]);

  useEffect(() => {
    if (showAddForm) {
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [showAddForm]);

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;

    if (
      categories.some(
        (c) => c.name.toLowerCase() === name.toLowerCase() && c.parent_id === (newParentId || null),
      )
    ) {
      setError(`Category "${name}" already exists at this level.`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const cat = await TauriAPI.addTagCategory(name, newColor, newParentId || undefined);
      setCategories((prev) => [...prev, cat]);
      setNewName('');
      setNewColor(PRESET_COLORS[0].value);
      setNewParentId('');
      setShowAddForm(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      await TauriAPI.updateTagCategory(id, editName || undefined, editColor || undefined);
      setCategories((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, name: editName || c.name, color: editColor || c.color } : c,
        ),
      );
      setEditingId(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await TauriAPI.deleteTagCategory(id);
      // Orphan children (set their parent to null)
      setCategories((prev) =>
        prev
          .filter((c) => c.id !== id)
          .map((c) => (c.parent_id === id ? { ...c, parent_id: null } : c)),
      );
      if (editingId === id) setEditingId(null);
    } catch (err) {
      setError(String(err));
    }
  };

  const startEditing = (cat: TagCategory) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditColor(cat.color);
  };

  if (!isOpen) return null;

  const tree = buildTree(categories);
  const flatNodes = flattenTree(tree);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mx-4 flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-xp-border bg-xp-surface shadow-2xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-xp-border px-4 py-3">
          <div className="flex items-center space-x-2">
            <Tags className="h-4 w-4 text-xp-text-muted" />
            <h2 className="text-sm font-semibold text-xp-text">Tag Categories</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
            aria-label="Close tag categories dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {/* eslint-disable-next-line no-nested-ternary */}
          {loading ? (
            <p className="text-sm text-xp-text-muted">Loading...</p>
          ) : flatNodes.length === 0 && !showAddForm ? (
            <p className="text-sm italic text-xp-text-muted">
              No tag categories yet — add one below.
            </p>
          ) : (
            <ul className="space-y-1">
              {flatNodes.map((node) => (
                <li
                  key={node.category.id}
                  className="group flex items-center justify-between rounded px-2 py-1.5 transition-colors hover:bg-xp-surface-light"
                  style={{ paddingLeft: `${8 + node.depth * 20}px` }}
                >
                  {editingId === node.category.id ? (
                    <div className="flex flex-1 items-center space-x-2">
                      <span
                        className="h-3 w-3 flex-shrink-0 cursor-pointer rounded-full border border-black border-opacity-20"
                        style={{ backgroundColor: editColor }}
                        onClick={() => {
                          const idx = PRESET_COLORS.findIndex((c) => c.value === editColor);
                          setEditColor(PRESET_COLORS[(idx + 1) % PRESET_COLORS.length].value);
                        }}
                        title={t('dialogs.tagCategory.clickToCycle')}
                        aria-label={t('dialogs.tagCategory.cycleAria')}
                      />
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdate(node.category.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="flex-1 rounded border border-xp-border bg-xp-bg px-2 py-0.5 text-sm text-xp-text focus:border-xp-blue focus:outline-none focus:ring-2 focus:ring-xp-blue"
                        autoFocus
                      />
                      <button
                        onClick={() => handleUpdate(node.category.id)}
                        className="rounded p-1 text-xp-green transition-colors hover:bg-xp-surface-light"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="rounded p-1 text-xp-text-muted transition-colors hover:bg-xp-surface-light"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex min-w-0 items-center space-x-2">
                        {node.children.length > 0 && (
                          <ChevronRight className="h-3 w-3 flex-shrink-0 text-xp-text-muted" />
                        )}
                        <span
                          className="h-3 w-3 flex-shrink-0 rounded-full border border-black border-opacity-20"
                          style={{ backgroundColor: node.category.color }}
                        />
                        <span className="truncate text-sm text-xp-text">{node.category.name}</span>
                      </div>
                      <div className="ml-2 flex flex-shrink-0 items-center space-x-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => startEditing(node.category)}
                          className="rounded p-1 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-blue"
                          title="Edit"
                          aria-label={`Edit category ${node.category.name}`}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => handleDelete(node.category.id)}
                          className="rounded p-1 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-red"
                          title="Delete"
                          aria-label={`Delete category ${node.category.name}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Add form */}
          {showAddForm && (
            <div className="space-y-2 rounded-md border border-xp-blue border-opacity-50 p-3">
              <input
                ref={nameInputRef}
                type="text"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd();
                  if (e.key === 'Escape') setShowAddForm(false);
                }}
                className="w-full rounded border border-xp-border bg-xp-bg px-3 py-1.5 text-sm text-xp-text placeholder-xp-text-muted transition-colors focus:border-xp-blue focus:outline-none focus:ring-2 focus:ring-xp-blue"
                placeholder={t('dialogs.tagCategory.categoryNamePlaceholder')}
                maxLength={50}
              />

              {/* Color picker */}
              <div className="flex items-center space-x-1.5">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setNewColor(c.value)}
                    className="flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all"
                    style={{
                      backgroundColor: c.value,
                      borderColor: newColor === c.value ? 'white' : 'transparent',
                      boxShadow: newColor === c.value ? `0 0 0 1px ${c.value}` : 'none',
                    }}
                    title={t(c.label)}
                    aria-label={t('dialogs.tagCategory.selectColor', { color: t(c.label) })}
                  >
                    {newColor === c.value && (
                      <Check className="h-2.5 w-2.5 text-white drop-shadow" />
                    )}
                  </button>
                ))}
              </div>

              {/* Parent dropdown */}
              <Select
                value={newParentId || '__none__'}
                onValueChange={(v) => setNewParentId(v === '__none__' ? '' : v)}
              >
                <SelectTrigger className="h-8 w-full">
                  <SelectValue placeholder={t('dialogs.tagCategory.noParent')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t('dialogs.tagCategory.noParent')}</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center justify-end space-x-2">
                <button
                  onClick={() => setShowAddForm(false)}
                  className="rounded px-2.5 py-1 text-xs text-xp-text-muted transition-colors hover:text-xp-text"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdd}
                  disabled={saving || !newName.trim()}
                  className="flex items-center space-x-1 rounded bg-xp-blue px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-opacity-90 disabled:opacity-40"
                >
                  {saving ? (
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                  <span>Add</span>
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="rounded border border-red-400 border-opacity-30 bg-red-400 bg-opacity-10 px-2 py-1 text-xs text-xp-red">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-between border-t border-xp-border px-4 py-3">
          <span className="text-xs text-xp-text-muted">
            {categories.length} categor{categories.length !== 1 ? 'ies' : 'y'}
          </span>
          <div className="flex items-center space-x-2">
            {!showAddForm && (
              <button
                onClick={() => setShowAddForm(true)}
                className="flex items-center space-x-1.5 rounded bg-xp-blue px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-opacity-90"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Category</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded px-3 py-1.5 text-sm text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TagCategoryDialog;
