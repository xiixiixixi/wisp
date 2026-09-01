import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TauriAPI, type FileNote } from '@/lib/tauri-api';
import {
  StickyNote,
  X,
  Plus,
  Check,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

interface FileNotesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  onSaved?: () => void;
}

const FileNotesDialog = ({ isOpen, onClose, filePath, onSaved }: FileNotesDialogProps) => {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<FileNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);

  // New note form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [saving, setSaving] = useState(false);

  // Edit state
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen || !filePath) return;
    setError(null);
    setShowAddForm(false);
    setEditingNoteId(null);
    setExpandedNoteId(null);

    setLoading(true);
    TauriAPI.getFileNotes(filePath)
      .then(setNotes)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [isOpen, filePath]);

  useEffect(() => {
    if (showAddForm) {
      setTimeout(() => titleInputRef.current?.focus(), 50);
    }
  }, [showAddForm]);

  const handleAddNote = async () => {
    const title = newTitle.trim();
    if (!title) return;

    setSaving(true);
    setError(null);
    try {
      const note = await TauriAPI.addFileNote(filePath, title, newContent);
      setNotes((prev) => [...prev, note]);
      setNewTitle('');
      setNewContent('');
      setShowAddForm(false);
      onSaved?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateNote = async (noteId: string) => {
    setSaving(true);
    setError(null);
    try {
      await TauriAPI.updateFileNote(filePath, noteId, editTitle, editContent);
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId
            ? { ...n, title: editTitle, content: editContent, updated_at: new Date().toISOString() }
            : n,
        ),
      );
      setEditingNoteId(null);
      onSaved?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    setError(null);
    try {
      await TauriAPI.deleteFileNote(filePath, noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      if (editingNoteId === noteId) setEditingNoteId(null);
      if (expandedNoteId === noteId) setExpandedNoteId(null);
      onSaved?.();
    } catch (err) {
      setError(String(err));
    }
  };

  const startEditing = (note: FileNote) => {
    setEditingNoteId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content);
    setExpandedNoteId(note.id);
  };

  if (!isOpen) return null;

  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mx-4 flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-xp-border bg-xp-surface shadow-2xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-xp-border px-4 py-3">
          <div className="flex items-center space-x-2">
            <StickyNote className="h-4 w-4 text-xp-text-muted" />
            <div>
              <h2 className="text-sm font-semibold text-xp-text">{t('dialogs.notes.title')}</h2>
              <p className="max-w-xs truncate text-xs text-xp-text-muted" title={filePath}>
                {fileName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {/* eslint-disable-next-line no-nested-ternary */}
          {loading ? (
            <p className="text-sm text-xp-text-muted">{t('common.loading')}</p>
          ) : notes.length === 0 && !showAddForm ? (
            <p className="text-sm italic text-xp-text-muted">{t('dialogs.notes.empty')}</p>
          ) : (
            notes.map((note) => (
              <div key={note.id} className="overflow-hidden rounded-md border border-xp-border">
                {/* Note header */}
                <button
                  className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-xp-surface-light"
                  onClick={() => setExpandedNoteId(expandedNoteId === note.id ? null : note.id)}
                >
                  <div className="flex min-w-0 items-center space-x-2">
                    {expandedNoteId === note.id ? (
                      <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-xp-text-muted" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-xp-text-muted" />
                    )}
                    <span className="truncate text-sm font-medium text-xp-text">{note.title}</span>
                  </div>
                  <div className="ml-2 flex flex-shrink-0 items-center space-x-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditing(note);
                      }}
                      className="rounded p-1 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-blue"
                      title={t('common.edit')}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteNote(note.id);
                      }}
                      className="rounded p-1 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-red"
                      title={t('common.delete')}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </button>

                {/* Expanded content */}
                {expandedNoteId === note.id && (
                  <div className="border-t border-xp-border px-3 pb-3">
                    {editingNoteId === note.id ? (
                      <div className="space-y-2 pt-2">
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full rounded border border-xp-border bg-xp-bg px-3 py-1.5 text-sm text-xp-text transition-colors focus:border-xp-blue focus:outline-none"
                          placeholder={t('dialogs.notes.titlePlaceholder')}
                        />
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          rows={5}
                          className="w-full resize-y rounded border border-xp-border bg-xp-bg px-3 py-1.5 text-sm text-xp-text transition-colors focus:border-xp-blue focus:outline-none"
                          placeholder={t('dialogs.notes.contentPlaceholder')}
                        />
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={() => setEditingNoteId(null)}
                            className="rounded px-2.5 py-1 text-xs text-xp-text-muted transition-colors hover:text-xp-text"
                          >
                            {t('common.cancel')}
                          </button>
                          <button
                            onClick={() => handleUpdateNote(note.id)}
                            disabled={saving || !editTitle.trim()}
                            className="flex items-center space-x-1 rounded bg-xp-blue px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-opacity-90 disabled:opacity-40"
                          >
                            <Check className="h-3 w-3" />
                            <span>{t('common.save')}</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="pt-2">
                        <p className="whitespace-pre-wrap text-sm text-xp-text">
                          {note.content || (
                            <span className="italic text-xp-text-muted">
                              {t('dialogs.notes.noContent')}
                            </span>
                          )}
                        </p>
                        <p className="mt-2 text-xs text-xp-text-muted">
                          {t('dialogs.notes.updated', {
                            date: new Date(note.updated_at).toLocaleString(),
                          })}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}

          {/* Add note form */}
          {showAddForm && (
            <div className="space-y-2 rounded-md border border-xp-blue border-opacity-50 p-3">
              <input
                ref={titleInputRef}
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setShowAddForm(false);
                }}
                className="w-full rounded border border-xp-border bg-xp-bg px-3 py-1.5 text-sm text-xp-text placeholder-xp-text-muted transition-colors focus:border-xp-blue focus:outline-none"
                placeholder={t('dialogs.notes.titlePlaceholder')}
                maxLength={100}
              />
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                rows={4}
                className="w-full resize-y rounded border border-xp-border bg-xp-bg px-3 py-1.5 text-sm text-xp-text placeholder-xp-text-muted transition-colors focus:border-xp-blue focus:outline-none"
                placeholder={t('dialogs.notes.contentPlaceholder')}
              />
              <div className="flex items-center justify-end space-x-2">
                <button
                  onClick={() => setShowAddForm(false)}
                  className="rounded px-2.5 py-1 text-xs text-xp-text-muted transition-colors hover:text-xp-text"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleAddNote}
                  disabled={saving || !newTitle.trim()}
                  className="flex items-center space-x-1 rounded bg-xp-blue px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-opacity-90 disabled:opacity-40"
                >
                  {saving ? (
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  <span>{t('dialogs.notes.addNote')}</span>
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="rounded border border-xp-red/30 bg-xp-red/10 px-2 py-1 text-xs text-xp-red">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-between border-t border-xp-border px-4 py-3">
          <span className="text-xs text-xp-text-muted">
            {t('dialogs.notes.noteCount', { count: notes.length })}
          </span>
          <div className="flex items-center space-x-2">
            {!showAddForm && (
              <button
                onClick={() => setShowAddForm(true)}
                className="flex items-center space-x-1.5 rounded bg-xp-blue px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-opacity-90"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t('dialogs.notes.addNote')}</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded px-3 py-1.5 text-sm text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FileNotesDialog;
