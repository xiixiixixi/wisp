import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ExternalLink, Heart, Search, ShieldCheck, Sparkles, X } from 'lucide-react';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import wispLogo from '../../../../src-tauri/icons/icon.png';

const BETA_DISMISSED_KEY = STORAGE_KEYS.BETA_WARNING_DISMISSED;
const SPONSOR_URL = 'https://github.com/sponsors/kimlimjustin';

export const isBetaWarningDismissed = (): boolean => {
  return localStorage.getItem(BETA_DISMISSED_KEY) === 'true';
};

export const resetBetaWarning = () => {
  localStorage.removeItem(BETA_DISMISSED_KEY);
};

const BetaWarningDialog = () => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const primaryActionRef = useRef<HTMLButtonElement>(null);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(BETA_DISMISSED_KEY, 'true');
    setIsOpen(false);
  }, []);

  useEffect(() => {
    if (!isBetaWarningDismissed()) {
      const timer = setTimeout(() => setIsOpen(true), 400);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    primaryActionRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleDismiss();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleDismiss, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md duration-200 animate-in fade-in">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="beta-welcome-title"
        aria-describedby="beta-welcome-description"
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-xp-border bg-xp-popover shadow-2xl"
      >
        {/* Close button */}
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
          aria-label={t('common.close')}
        >
          <X size={16} />
        </button>

        {/* Product welcome */}
        <div className="px-7 pb-5 pt-7 sm:px-8 sm:pt-8">
          <div className="mb-6 flex items-center gap-3">
            <img
              src={wispLogo}
              alt=""
              className="h-11 w-11 rounded-2xl shadow-lg"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-sm font-semibold text-xp-text">Wisp</span>
                <span className="rounded-full border border-xp-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-xp-blue">
                  {t('dialogs.beta.previewBadge')}
                </span>
              </div>
              <p className="text-xs text-xp-text-muted">{t('dialogs.beta.subtitle')}</p>
            </div>
          </div>

          <div className="mb-6">
            <h2
              id="beta-welcome-title"
              className="text-2xl font-semibold tracking-[-0.025em] text-xp-text"
            >
              {t('dialogs.beta.title')}
            </h2>
            <p
              id="beta-welcome-description"
              className="mt-2 max-w-md text-sm leading-6 text-xp-text-secondary"
            >
              {t('dialogs.beta.intro')}
            </p>
          </div>

          <ul className="space-y-2.5">
            <li className="flex items-center gap-3 rounded-xl border border-xp-border bg-muted p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xp-blue">
                <Search size={18} aria-hidden="true" />
              </span>
              <span className="text-sm text-xp-text">{t('dialogs.beta.bullet1')}</span>
            </li>
            <li className="flex items-center gap-3 rounded-xl border border-xp-border bg-muted p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xp-blue">
                <Sparkles size={18} aria-hidden="true" />
              </span>
              <span className="text-sm text-xp-text">{t('dialogs.beta.bullet2')}</span>
            </li>
            <li className="flex items-center gap-3 rounded-xl border border-xp-border bg-muted p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xp-blue">
                <ShieldCheck size={18} aria-hidden="true" />
              </span>
              <span className="text-sm text-xp-text">{t('dialogs.beta.bullet3')}</span>
            </li>
          </ul>

          <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-amber-200">{t('dialogs.beta.cautionTitle')}</p>
              <p className="mt-0.5 text-xs leading-5 text-amber-100/70">
                {t('dialogs.beta.cautionDesc')}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-xp-text-muted">
            <a
              href="https://github.com/kimlimjustin/xplorer/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-xp-text"
            >
              {t('dialogs.beta.githubIssues')}
              <ExternalLink size={11} />
            </a>
            <a
              href={SPONSOR_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-xp-text"
            >
              <Heart size={12} />
              {t('dialogs.beta.becomeSponsor')}
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-3 border-t border-xp-border bg-muted px-7 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span className="text-xs text-xp-text-muted">{t('dialogs.beta.showAgainHint')}</span>
          <button
            ref={primaryActionRef}
            type="button"
            onClick={handleDismiss}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-xp-blue px-5 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-xp-blue-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('dialogs.beta.iUnderstand')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BetaWarningDialog;
