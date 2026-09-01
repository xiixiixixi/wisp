import { useTranslation } from 'react-i18next';
import { X, RefreshCw } from 'lucide-react';
import useUpdater from '@/hooks/use-updater';

/**
 * Update notification as a compact card in the bottom-right corner.
 * Manual close only — unlike regular toasts this one has no auto-dismiss,
 * so an update you forgot about never silently disappears.
 */
const UpdateBanner = () => {
  const { t } = useTranslation();
  const { status, installUpdate, dismissUpdate } = useUpdater();

  if (!status.available || status.error) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9998] w-80 overflow-hidden rounded-[2px] border border-xp-border bg-xp-popover shadow-2xl duration-200 animate-in fade-in slide-in-from-bottom-2">
      {status.downloading ? (
        <div className="p-4">
          <div className="mb-2 flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-xp-text-muted" />
            <span className="text-sm font-medium text-xp-text">{t('updater.downloading')}</span>
            <span className="ml-auto text-xs text-xp-text-muted">
              {Math.round(status.progress)}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-[2px] bg-xp-bg">
            <div
              className="h-full rounded-[2px] bg-xp-lime transition-all"
              style={{ width: `${status.progress}%` }}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between px-4 pt-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="bg-xp-selection rounded-[2px] p-1.5">
                <RefreshCw className="h-4 w-4 text-xp-lime" />
              </div>
              <span className="truncate text-sm font-medium text-xp-text">
                {t('updater.available', { version: status.version })}
              </span>
            </div>
            <button
              onClick={dismissUpdate}
              className="-mr-1 rounded-[2px] p-1 text-xp-text-muted transition-colors hover:bg-xp-bg hover:text-xp-text"
              aria-label={t('common.close')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {status.body && (
            <p className="line-clamp-3 px-4 pt-1.5 text-xs leading-relaxed text-xp-text-muted">
              {status.body}
            </p>
          )}

          <div className="flex items-center gap-2 px-4 pb-3 pt-3">
            <button
              onClick={installUpdate}
              className="flex-1 rounded-[2px] bg-xp-text px-3 py-1.5 text-xs font-medium text-xp-bg transition-colors hover:bg-xp-accent-hover"
            >
              {t('updater.install')}
            </button>
            <button
              onClick={dismissUpdate}
              className="rounded-[2px] border border-xp-border px-3 py-1.5 text-xs text-xp-text-secondary transition-colors hover:bg-xp-bg hover:text-xp-text"
            >
              {t('updater.dismiss')}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default UpdateBanner;
