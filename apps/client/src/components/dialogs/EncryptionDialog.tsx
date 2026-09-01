import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/hooks/use-toast';
import { TauriAPI } from '@/lib/tauri-api';
import { Eye, EyeOff, Lock, Unlock, AlertTriangle } from 'lucide-react';

export type EncryptionMode = 'encrypt' | 'decrypt';

interface EncryptionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
  filePath: string;
  mode: EncryptionMode;
}

const EncryptionDialog = ({
  isOpen,
  onClose,
  onComplete,
  filePath,
  mode,
}: EncryptionDialogProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const isEncrypt = mode === 'encrypt';

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setConfirmPassword('');
      setShowPassword(false);
      setShowConfirmPassword(false);
      setError(null);
      setProcessing(false);
    }
  }, [isOpen]);

  const validate = (): string | null => {
    if (!password) {
      return t('dialogs.encryption.errorPasswordRequired');
    }
    if (password.length < 4) {
      return t('dialogs.encryption.errorPasswordTooShort');
    }
    if (isEncrypt && password !== confirmPassword) {
      return t('dialogs.encryption.errorPasswordMismatch');
    }
    return null;
  };

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      let resultPath: string;
      if (isEncrypt) {
        resultPath = await TauriAPI.encryptFile(filePath, password);
      } else {
        resultPath = await TauriAPI.decryptFile(filePath, password);
      }

      const resultName = resultPath.split(/[/\\]/).pop() || resultPath;
      toast({
        title: isEncrypt
          ? t('dialogs.encryption.toastEncryptedTitle')
          : t('dialogs.encryption.toastDecryptedTitle'),
        description: t('dialogs.encryption.toastSuccessDesc', { name: resultName }),
      });

      onComplete?.();
      onClose();
    } catch (err) {
      const message = (err as Error).message || String(err);
      setError(message);
      toast({
        title: isEncrypt
          ? t('dialogs.encryption.toastEncryptFailedTitle')
          : t('dialogs.encryption.toastDecryptFailedTitle'),
        description: message,
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleClose = () => {
    if (processing) return;
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !processing) {
      handleSubmit();
    }
    if (e.key === 'Escape') {
      handleClose();
    }
  };

  if (!isOpen) return null;

  let buttonLabel: string;
  if (processing) {
    buttonLabel = isEncrypt
      ? t('dialogs.encryption.encrypting')
      : t('dialogs.encryption.decrypting');
  } else {
    buttonLabel = isEncrypt ? t('dialogs.encryption.encrypt') : t('dialogs.encryption.decrypt');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div
        className="w-[480px] max-w-[90vw] overflow-hidden rounded-[2px] bg-xp-surface shadow-2xl"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-xp-border p-6">
          <div className="flex items-center space-x-3">
            {isEncrypt ? (
              <Lock size={20} className="text-xp-blue" />
            ) : (
              <Unlock size={20} className="text-xp-green" />
            )}
            <h2 className="text-xl font-semibold text-xp-text">
              {isEncrypt
                ? t('dialogs.encryption.titleEncrypt')
                : t('dialogs.encryption.titleDecrypt')}
            </h2>
          </div>
          <button
            onClick={handleClose}
            disabled={processing}
            className="rounded-[2px] p-2 transition-colors hover:bg-xp-surface-light disabled:opacity-50"
            aria-label={t('dialogs.encryption.closeAriaLabel')}
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="space-y-5 p-6">
          {/* File info */}
          <div className="rounded-[2px] bg-xp-bg p-4">
            <div className="mb-1 text-sm text-xp-text-muted">
              {t('dialogs.encryption.fileLabel')}
            </div>
            <div className="truncate text-sm font-medium text-xp-text" title={filePath}>
              {fileName}
            </div>
          </div>

          {/* Description */}
          <p className="text-sm text-xp-text-muted">
            {isEncrypt ? t('dialogs.encryption.descEncrypt') : t('dialogs.encryption.descDecrypt')}
          </p>

          {/* Password field */}
          <div>
            <label className="mb-2 block text-sm font-medium text-xp-text">
              {t('dialogs.encryption.passwordLabel')}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                className="w-full rounded-[2px] border border-xp-border bg-xp-bg px-3 py-2 pr-10 text-xp-text focus:border-xp-blue"
                placeholder={t('dialogs.encryption.passwordPlaceholder')}
                autoFocus
                disabled={processing}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-xp-text-muted transition-colors hover:text-xp-text"
                aria-label={
                  showPassword
                    ? t('dialogs.encryption.hidePassword')
                    : t('dialogs.encryption.showPassword')
                }
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Confirm password field (encrypt mode only) */}
          {isEncrypt && (
            <div>
              <label className="mb-2 block text-sm font-medium text-xp-text">
                {t('dialogs.encryption.confirmPasswordLabel')}
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setError(null);
                  }}
                  className="w-full rounded-[2px] border border-xp-border bg-xp-bg px-3 py-2 pr-10 text-xp-text focus:border-xp-blue"
                  placeholder={t('dialogs.encryption.confirmPasswordPlaceholder')}
                  disabled={processing}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-xp-text-muted transition-colors hover:text-xp-text"
                  aria-label={
                    showConfirmPassword
                      ? t('dialogs.encryption.hideConfirmPassword')
                      : t('dialogs.encryption.showConfirmPassword')
                  }
                  tabIndex={-1}
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="flex items-start space-x-2 rounded-[2px] border border-xp-red/30 bg-xp-red/10 p-3">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-xp-red" />
              <span className="text-sm text-xp-red">{error}</span>
            </div>
          )}

          {/* Processing indicator */}
          {processing && (
            <div className="flex items-center justify-center py-2">
              <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-xp-text-muted" />
              <span className="ml-3 text-sm text-xp-text-muted">
                {isEncrypt
                  ? t('dialogs.encryption.encrypting')
                  : t('dialogs.encryption.decrypting')}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end space-x-3 border-t border-xp-border bg-xp-bg p-6">
          <button
            onClick={handleClose}
            disabled={processing}
            className="rounded-[2px] px-4 py-2 text-xp-text transition-colors hover:bg-xp-surface-light disabled:opacity-50"
            aria-label={t('common.cancel')}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={processing || !password}
            className="flex items-center space-x-2 rounded-[2px] bg-xp-blue px-4 py-2 text-xp-on-accent transition-colors hover:bg-xp-blue-dark disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={
              isEncrypt
                ? t('dialogs.encryption.encryptFileAriaLabel')
                : t('dialogs.encryption.decryptFileAriaLabel')
            }
          >
            {processing && (
              <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
            )}
            <span>{buttonLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default EncryptionDialog;
