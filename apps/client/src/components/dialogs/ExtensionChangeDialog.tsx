import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type ExtensionChangeChoice = 'use-new' | 'keep-old';

interface ExtensionChangeDialogProps {
  oldName: string;
  oldExt: string;
  newExt: string;
  onChoose: (choice: ExtensionChangeChoice) => void;
}

/**
 * Finder's extension-change guard for inline renames: asks whether the typed
 * extension should really replace the old one. "Don't use .xxx" keeps the
 * original extension on the new base name; Escape behaves the same way.
 */
export const ExtensionChangeDialog = ({
  oldName,
  oldExt,
  newExt,
  onChoose,
}: ExtensionChangeDialogProps) => {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const extLabel = (ext: string) => (ext ? `.${ext}` : t('dialogs.extensionChange.noExtension'));
  const newLabel = extLabel(newExt);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-labelledby="extension-change-title"
        aria-modal="true"
        tabIndex={-1}
        className="w-[420px] max-w-[90vw] rounded-[2px] border border-xp-border bg-xp-surface p-6 outline-none"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onChoose('keep-old');
        }}
      >
        <div className="mb-4 flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-6 w-6 flex-shrink-0 text-xp-yellow" />
          <div>
            <h3 id="extension-change-title" className="text-base font-semibold text-xp-text">
              {t('dialogs.extensionChange.title')}
            </h3>
            <p className="mt-1 text-sm text-xp-text-muted">
              {t('dialogs.extensionChange.message', {
                old: extLabel(oldExt),
                new: newLabel,
              })}
            </p>
          </div>
        </div>

        <div className="mb-3 flex items-center gap-2 rounded-[2px] border border-xp-border bg-xp-surface-light px-3 py-2.5">
          <span className="truncate text-sm font-medium text-xp-text">{oldName}</span>
        </div>

        <p className="mb-5 text-xs text-xp-text-muted">{t('dialogs.extensionChange.hint')}</p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-[2px] border border-xp-border px-4 py-2 text-sm text-xp-text hover:bg-xp-surface-light"
            onClick={() => onChoose('keep-old')}
          >
            {t('dialogs.extensionChange.keepOld', { new: newLabel })}
          </button>
          <button
            type="button"
            className="rounded-[2px] border border-xp-blue bg-xp-blue px-4 py-2 text-sm font-medium text-xp-on-accent hover:bg-xp-blue/80"
            autoFocus
            onClick={() => onChoose('use-new')}
          >
            {t('dialogs.extensionChange.useNew', { new: newLabel })}
          </button>
        </div>
      </div>
    </div>
  );
};
