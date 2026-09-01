import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TauriAPI, type FileAnnotation } from '@/lib/tauri-api';
import { MessageSquare, X, Plus, Trash2, CheckCircle, Circle } from 'lucide-react';

interface FileAnnotationsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
}

const FileAnnotationsDialog = ({ isOpen, onClose, filePath }: FileAnnotationsDialogProps) => {
  const { t } = useTranslation();
  const [annotations, setAnnotations] = useState<FileAnnotation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newText, setNewText] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen || !filePath) return;
    setError(null);
    setNewText('');

    setLoading(true);
    TauriAPI.getFileAnnotations(filePath)
      .then(setAnnotations)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [isOpen, filePath]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleAdd = async () => {
    const text = newText.trim();
    if (!text) return;

    setSaving(true);
    setError(null);
    try {
      const annotation = await TauriAPI.addFileAnnotation(filePath, text);
      setAnnotations((prev) => [...prev, annotation]);
      setNewText('');
      inputRef.current?.focus();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleResolved = async (annotationId: string) => {
    setError(null);
    try {
      await TauriAPI.toggleAnnotationResolved(filePath, annotationId);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === annotationId ? { ...a, resolved: !a.resolved } : a)),
      );
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDelete = async (annotationId: string) => {
    setError(null);
    try {
      await TauriAPI.deleteFileAnnotation(filePath, annotationId);
      setAnnotations((prev) => prev.filter((a) => a.id !== annotationId));
    } catch (err) {
      setError(String(err));
    }
  };

  if (!isOpen) return null;

  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  const activeAnnotations = annotations.filter((a) => !a.resolved);
  const resolvedAnnotations = annotations.filter((a) => a.resolved);

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
            <MessageSquare className="h-4 w-4 text-xp-text-muted" />
            <div>
              <h2 className="text-sm font-semibold text-xp-text">
                {t('dialogs.annotations.title')}
              </h2>
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
          ) : annotations.length === 0 ? (
            <p className="text-sm italic text-xp-text-muted">{t('dialogs.annotations.empty')}</p>
          ) : (
            <>
              {/* Active annotations */}
              {activeAnnotations.length > 0 && (
                <div className="space-y-1.5">
                  {activeAnnotations.map((a) => (
                    <div
                      key={a.id}
                      className="group flex items-start space-x-2 rounded px-2 py-2 transition-colors hover:bg-xp-surface-light"
                    >
                      <button
                        onClick={() => handleToggleResolved(a.id)}
                        className="mt-0.5 flex-shrink-0 text-xp-text-muted transition-colors hover:text-xp-green"
                        title={t('dialogs.annotations.markResolved')}
                      >
                        <Circle className="h-4 w-4" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-xp-text">{a.text}</p>
                        <p className="mt-0.5 text-xs text-xp-text-muted">
                          {a.author} &middot; {new Date(a.created_at).toLocaleString()}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDelete(a.id)}
                        className="flex-shrink-0 rounded p-1 text-xp-text-muted opacity-0 transition-all hover:bg-xp-surface-light hover:text-xp-red group-hover:opacity-100"
                        title={t('common.delete')}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Resolved annotations */}
              {resolvedAnnotations.length > 0 && (
                <div className="space-y-1">
                  <p className="pt-1 text-xs font-medium uppercase tracking-wide text-xp-text-muted">
                    {t('dialogs.annotations.resolved', { count: resolvedAnnotations.length })}
                  </p>
                  {resolvedAnnotations.map((a) => (
                    <div
                      key={a.id}
                      className="group flex items-start space-x-2 rounded px-2 py-2 opacity-60 transition-colors hover:bg-xp-surface-light"
                    >
                      <button
                        onClick={() => handleToggleResolved(a.id)}
                        className="mt-0.5 flex-shrink-0 text-xp-green transition-colors hover:text-xp-text-muted"
                        title={t('dialogs.annotations.unresolve')}
                      >
                        <CheckCircle className="h-4 w-4" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-xp-text line-through">{a.text}</p>
                        <p className="mt-0.5 text-xs text-xp-text-muted">
                          {a.author} &middot; {new Date(a.created_at).toLocaleString()}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDelete(a.id)}
                        className="flex-shrink-0 rounded p-1 text-xp-text-muted opacity-0 transition-all hover:bg-xp-surface-light hover:text-xp-red group-hover:opacity-100"
                        title={t('common.delete')}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Error */}
          {error && (
            <p className="rounded border border-xp-red/30 bg-xp-red/10 px-2 py-1 text-xs text-xp-red">
              {error}
            </p>
          )}
        </div>

        {/* Add annotation form */}
        <div className="flex-shrink-0 border-t border-xp-border px-4 py-3">
          <div className="flex items-center space-x-2">
            <input
              ref={inputRef}
              type="text"
              value={newText}
              onChange={(e) => {
                setNewText(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                } else if (e.key === 'Escape') onClose();
              }}
              placeholder={t('dialogs.annotations.inputPlaceholder')}
              maxLength={500}
              className="flex-1 rounded border border-xp-border bg-xp-bg px-3 py-1.5 text-sm text-xp-text placeholder-xp-text-muted transition-colors focus:border-xp-blue focus:outline-none"
            />
            <button
              onClick={handleAdd}
              disabled={saving || !newText.trim()}
              className="flex items-center space-x-1 rounded bg-xp-blue px-2.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              <span>{t('common.add')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FileAnnotationsDialog;
