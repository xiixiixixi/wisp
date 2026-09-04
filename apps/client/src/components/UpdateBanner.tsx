import { useTranslation } from 'react-i18next';
import { X, RefreshCw } from 'lucide-react';
import useUpdater from '@/hooks/use-updater';
import { BottomRightOverlayStackItem } from '@/components/ui/BottomRightOverlayStack';

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
    <BottomRightOverlayStackItem className="flex justify-end">
      <div
        role="region"
        aria-label={t('updater.notificationLabel')}
        className="w-80 max-w-full overflow-hidden rounded-[2px] border border-xp-border bg-xp-popover shadow-2xl duration-200 animate-in fade-in slide-in-from-bottom-2"
      >
        {status.downloading ? (
          <div className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin text-xp-text-muted" />
              <span role="status" className="text-sm font-medium text-xp-text">
                {t('updater.downloading')}
              </span>
              <span className="ml-auto text-xs tabular-nums text-xp-text-muted">
                {Math.round(status.progress)}%
              </span>
              <button
                type="button"
                onClick={dismissUpdate}
                className="-mr-2 flex h-7 w-7 items-center justify-center rounded-[2px] text-xp-text-muted transition-colors hover:bg-xp-bg hover:text-xp-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-xp-blue"
                aria-label={t('updater.closeNotification')}
                title={t('updater.closeNotification')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div
              role="progressbar"
              aria-label={t('updater.downloadProgress')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, Math.max(0, Math.round(status.progress)))}
              className="h-1.5 w-full overflow-hidden rounded-[2px] bg-xp-bg"
            >
              <div
                className="h-full w-full origin-left rounded-[2px] bg-xp-lime transition-transform"
                style={{
                  transform: `scaleX(${Math.min(100, Math.max(0, status.progress)) / 100})`,
                }}
              />
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between px-4 pt-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="bg-xp-selection rounded-[2px] p-1.5">
                  <RefreshCw aria-hidden="true" className="h-4 w-4 text-xp-lime" />
                </div>
                <span role="status" className="truncate text-sm font-medium text-xp-text">
                  {t('updater.available', { version: status.version })}
                </span>
              </div>
              <button
                type="button"
                onClick={dismissUpdate}
                className="-mr-2 flex h-7 w-7 items-center justify-center rounded-[2px] text-xp-text-muted transition-colors hover:bg-xp-bg hover:text-xp-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-xp-blue"
                aria-label={t('updater.closeNotification')}
                title={t('updater.closeNotification')}
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
                type="button"
                onClick={installUpdate}
                className="flex-1 rounded-[2px] bg-xp-text px-3 py-1.5 text-xs font-medium text-xp-bg transition-colors hover:bg-xp-accent-hover"
              >
                {t('updater.install')}
              </button>
              <button
                type="button"
                onClick={dismissUpdate}
                className="rounded-[2px] border border-xp-border px-3 py-1.5 text-xs text-xp-text-secondary transition-colors hover:bg-xp-bg hover:text-xp-text"
              >
                {t('updater.dismiss')}
              </button>
            </div>
          </>
        )}
      </div>
    </BottomRightOverlayStackItem>
  );
};

export default UpdateBanner;
