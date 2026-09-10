import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X, Check } from 'lucide-react';
import { TauriAPI, type Application, type FileAssociation } from '@/lib/tauri-api';
import { isTauri } from '@/lib/transport';
import { formatFileSize } from '@/lib/utils';

/**
 * Finder-style "choose application" dialog: recommended apps from
 * LaunchServices (exactly what Finder's 打开方式 menu lists), searchable
 * full app list, and 始终用此应用打开 which writes the SYSTEM-wide default
 * (LaunchServices) — Finder picks the change up immediately.
 */

interface OpenWithDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  /** Legacy handler callback — no longer used; kept for call-site compat. */
  onChoose?: (handler: unknown) => void;
}

const OpenWithDialog = ({ isOpen, onClose, filePath }: OpenWithDialogProps) => {
  const { t } = useTranslation();
  const [assoc, setAssoc] = useState<FileAssociation | null>(null);
  const [allApps, setAllApps] = useState<Application[]>([]);
  const [selected, setSelected] = useState<Application | null>(null);
  const [always, setAlways] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const fileName = filePath.split(/[/\\]/).pop() ?? '';
  const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';

  useEffect(() => {
    if (!isOpen || !isTauri()) return;
    setSelected(null);
    setAlways(false);
    setQuery('');
    setAssoc(null);
    TauriAPI.getFileAssociations(filePath)
      .then((a) => {
        setAssoc(a);
        if (a.default_app) setSelected(a.default_app);
      })
      .catch(() => setAssoc(null));
    TauriAPI.getSystemApplications()
      .then((apps) => {
        const seen = new Set<string>();
        setAllApps(apps.filter((a) => !seen.has(a.path) && seen.add(a.path)));
      })
      .catch(() => setAllApps([]));
  }, [isOpen, filePath]);

  const recommended = useMemo(() => {
    if (!assoc) return [];
    const def = assoc.default_app;
    const rest = assoc.available_apps.filter((a) => a.path !== def?.path);
    return def ? [def, ...rest] : rest;
  }, [assoc]);

  const filteredApps = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allApps.slice(0, 60);
    return allApps
      .filter((a) => a.name.toLowerCase().includes(q))
      .slice(0, 60);
  }, [allApps, query]);

  const recommendedPaths = useMemo(
    () => new Set(recommended.map((a) => a.path)),
    [recommended],
  );

  const handleOpen = useCallback(async () => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      if (always && ext) {
        await TauriAPI.setDefaultApplication(ext, selected.path).catch((err: unknown) => {
          console.error('setDefaultApplication failed:', err);
        });
      }
      await TauriAPI.openFileWithApplication(filePath, selected.path);
      onClose();
    } catch (err) {
      console.error('open with application failed:', err);
    } finally {
      setBusy(false);
    }
  }, [selected, busy, always, ext, filePath, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'Enter') void handleOpen();
    },
    [onClose, handleOpen],
  );

  if (!isOpen) return null;

  const appRow = (app: Application) => (
    <button
      key={app.path}
      onClick={() => setSelected(app)}
      onDoubleClick={() => {
        setSelected(app);
        void handleOpen();
      }}
      className={`flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-xs transition-colors ${
        selected?.path === app.path
          ? 'bg-xp-surface-light text-xp-text'
          : 'text-xp-text-secondary hover:bg-xp-surface-light/60'
      }`}
    >
      <span className="min-w-0 flex-1 truncate" title={app.name}>
        {app.name}
      </span>
      {app.is_default && (
        <span className="shrink-0 text-[10px] text-xp-text-muted">
          {t('contextMenu.defaultTag')}
        </span>
      )}
      {selected?.path === app.path && <Check size={12} className="shrink-0" aria-hidden />}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label={t('openWith.title')}
    >
      <div className="flex h-[460px] w-[440px] flex-col rounded-[6px] border border-xp-border bg-xp-surface shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-xp-border px-3 py-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-xp-text">{t('openWith.title')}</h3>
            <p className="truncate text-xs text-xp-text-muted" title={fileName}>
              {fileName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-[2px] p-1 text-xp-text-secondary hover:bg-xp-surface-light"
            aria-label={t('common.close')}
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-xp-border px-3 py-2">
          <div className="flex items-center gap-2 rounded-[2px] border border-xp-border bg-xp-bg px-2 py-1">
            <Search size={13} className="shrink-0 text-xp-text-muted" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('openWith.searchApps')}
              className="min-w-0 flex-1 bg-transparent text-xs text-xp-text outline-none"
              autoFocus
            />
          </div>
        </div>

        {/* List */}
        <div className="min-h-0 flex-1 overflow-auto px-2 py-1">
          {query.trim() === '' && recommended.length > 0 && (
            <>
              <p className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-wide text-xp-text-muted">
                {t('openWith.recommended')}
              </p>
              {recommended.slice(0, 8).map(appRow)}
              <p className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-wide text-xp-text-muted">
                {t('openWith.allApps')}
              </p>
            </>
          )}
          {filteredApps
            .filter((a) => query.trim() !== '' || !recommendedPaths.has(a.path))
            .map(appRow)}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-xp-border px-3 py-2">
          <label className="flex min-w-0 items-center gap-1.5 text-xs text-xp-text-secondary">
            <input
              type="checkbox"
              checked={always}
              onChange={(e) => setAlways(e.target.checked)}
              disabled={!ext}
            />
            {t('openWith.alwaysOpenWith')}
          </label>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={onClose}
              className="rounded-[2px] border border-xp-border px-3 py-1 text-xs text-xp-text-secondary hover:bg-xp-surface-light"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => void handleOpen()}
              disabled={!selected || busy}
              className="rounded-[2px] bg-[var(--xp-lime)] px-3 py-1 text-xs font-medium text-black disabled:opacity-40"
            >
              {busy ? t('common.loading') : t('openWith.openButton')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OpenWithDialog;
