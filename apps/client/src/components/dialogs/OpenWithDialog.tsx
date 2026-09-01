import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FileCode, Monitor, ExternalLink, X } from 'lucide-react';
import {
  type OpenHandler,
  getFileExtension,
  isCodeFile,
  setOpenPreference,
} from '@/hooks/use-open-with-prefs';

interface OpenWithDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  onChoose: (handler: OpenHandler) => void;
}

interface HandlerOption {
  id: OpenHandler;
  labelKey: string;
  descriptionKey: string;
  Icon: React.ElementType;
}

const HANDLER_OPTIONS: HandlerOption[] = [
  {
    id: 'wisp-editor',
    labelKey: 'openWith.wispEditor',
    descriptionKey: 'openWith.wispEditorDesc',
    Icon: FileCode,
  },
  {
    id: 'vscode',
    labelKey: 'openWith.vscode',
    descriptionKey: 'openWith.vscodeDesc',
    Icon: ExternalLink,
  },
  {
    id: 'system',
    labelKey: 'openWith.systemDefault',
    descriptionKey: 'openWith.systemDefaultDesc',
    Icon: Monitor,
  },
];

const OpenWithDialog = ({ isOpen, onClose, filePath, onChoose }: OpenWithDialogProps) => {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<OpenHandler>('wisp-editor');
  const [rememberChoice, setRememberChoice] = useState(false);

  const ext = getFileExtension(filePath);
  const fileName = filePath.split(/[/\\]/).pop() ?? '';
  const isCode = isCodeFile(filePath);

  const handleOpen = useCallback(() => {
    if (rememberChoice && ext) {
      setOpenPreference(ext, selected);
    }
    onChoose(selected);
    onClose();
  }, [rememberChoice, ext, selected, onChoose, onClose]);

  const handleClose = useCallback(() => {
    setSelected('wisp-editor');
    setRememberChoice(false);
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      } else if (e.key === 'Enter') {
        handleOpen();
      }
    },
    [handleClose, handleOpen],
  );

  if (!isOpen) return null;

  // For non-code files, fall through — this dialog is code-file specific.
  // The caller should not open this for non-code files, but guard just in case.
  const options = isCode ? HANDLER_OPTIONS : HANDLER_OPTIONS.filter((o) => o.id !== 'wisp-editor');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('openWith.title')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onKeyDown={handleKeyDown}
    >
      <div className="w-[420px] max-w-[90vw] overflow-hidden rounded-xl border border-xp-border bg-xp-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-xp-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-xp-text">{t('openWith.title')}</h2>
            <p className="mt-0.5 max-w-[300px] truncate text-xs text-xp-text-secondary">
              {fileName}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="rounded-md p-1.5 text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text"
            aria-label={t('openWith.cancel')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Options */}
        <div className="space-y-1.5 p-4">
          {options.map(({ id, labelKey, descriptionKey, Icon }) => {
            const isSelected = selected === id;
            return (
              <button
                key={id}
                onClick={() => setSelected(id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-all ${
                  isSelected
                    ? 'bg-xp-accent/15 ring-1 ring-xp-accent/40'
                    : 'hover:bg-xp-surface-light'
                }`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    isSelected
                      ? 'bg-xp-accent/20 text-xp-accent'
                      : 'bg-xp-bg text-xp-text-secondary'
                  }`}
                >
                  <Icon size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-sm font-medium ${isSelected ? 'text-xp-accent' : 'text-xp-text'}`}
                  >
                    {t(labelKey)}
                  </div>
                  <div className="text-xs text-xp-text-secondary">{t(descriptionKey)}</div>
                </div>
                <div
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                    isSelected ? 'border-xp-accent bg-xp-accent' : 'border-xp-border'
                  }`}
                >
                  {isSelected && <div className="h-1.5 w-1.5 rounded-sm bg-xp-popover" />}
                </div>
              </button>
            );
          })}
        </div>

        {/* Remember checkbox */}
        {ext && (
          <div className="border-t border-xp-border px-5 py-3">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={rememberChoice}
                onChange={(e) => setRememberChoice(e.target.checked)}
                className="h-4 w-4 rounded border-xp-border bg-xp-bg text-xp-accent focus:ring-2 focus:ring-xp-accent"
              />
              <span className="text-sm text-xp-text">{t('openWith.alwaysUse', { ext })}</span>
            </label>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-xp-border px-5 py-3">
          <button
            onClick={handleClose}
            className="rounded-md px-4 py-2 text-sm text-xp-text transition-colors hover:bg-xp-surface-light"
          >
            {t('openWith.cancel')}
          </button>
          <button
            onClick={handleOpen}
            className="rounded-md bg-xp-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-xp-accent-hover"
          >
            {t('openWith.open')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OpenWithDialog;
