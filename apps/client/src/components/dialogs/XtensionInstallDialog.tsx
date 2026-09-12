import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import React, { useState } from 'react';
import { Package, Shield, X, Download, Loader2 } from 'lucide-react';

interface XtensionInstallDialogProps {
  isOpen: boolean;
  onClose: () => void;
  manifest: {
    id: string;
    name: string;
    display_name?: string;
    description?: string;
    version: string;
    author: string;
    permissions?: string[];
  } | null;
  onInstall: () => Promise<void>;
}

const PERMISSION_LABELS: Record<string, string> = {
  get 'file:read'() {
    return i18n.t('dialogs.permissions.permDesc.file_read');
  },
  get 'file:write'() {
    return i18n.t('dialogs.permissions.permDesc.file_write');
  },
  get 'ui:panels'() {
    return i18n.t('dialogs.permissions.permDesc.ui_panels');
  },
  get 'ui:notifications'() {
    return i18n.t('dialogs.permissions.permDesc.ui_notifications');
  },
  get 'native:invoke'() {
    return i18n.t('dialogs.permissions.permDesc.native_invoke');
  },
  get 'network:fetch'() {
    return i18n.t('dialogs.permissions.permDesc.fetch');
  },
};

const XtensionInstallDialog = ({
  isOpen,
  onClose,
  manifest,
  onInstall,
}: XtensionInstallDialogProps) => {
  const { t: tUi } = useTranslation();
  const [installing, setInstalling] = useState(false);

  if (!isOpen || !manifest) return null;

  const displayName = manifest.display_name || manifest.name;
  const permissions = manifest.permissions || [];

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await onInstall();
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Dialog */}
      <div className="relative w-[420px] max-w-[90vw] overflow-hidden rounded-md border border-xp-border bg-xp-bg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-xp-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-xp-blue/30 bg-xp-blue/20">
              <Package className="h-5 w-5 text-xp-blue" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-xp-text">
                {tUi('dialogs.extensionInstall')}
              </h2>
              <p className="text-xs text-xp-text-muted">{tUi('interface.xtensionPackage')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 px-5 py-4">
          {/* Extension info */}
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-xp-text">{displayName}</h3>
            <p className="text-xs text-xp-text-muted">
              {tUi('messages.extensionAuthor', {
                version: manifest.version,
                author: manifest.author,
              })}
            </p>
            {manifest.description && (
              <p className="mt-2 text-sm text-xp-text-secondary">{manifest.description}</p>
            )}
          </div>

          {/* Permissions */}
          {permissions.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-xp-text-muted">
                <Shield className="h-3.5 w-3.5" />
                {tUi('interface.requestedPermissions')}
              </div>
              <div className="space-y-1.5 rounded-md border border-xp-border bg-xp-surface p-3">
                {permissions.map((perm) => (
                  <div key={perm} className="flex items-center gap-2 text-xs">
                    <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-xp-yellow" />
                    <span className="text-xp-text">{PERMISSION_LABELS[perm] || perm}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-xp-border bg-xp-surface/50 px-5 py-3">
          <button
            onClick={onClose}
            disabled={installing}
            className="rounded-md border border-xp-border bg-xp-surface px-4 py-2 text-sm text-xp-text transition-colors hover:bg-xp-surface-light disabled:opacity-50"
          >
            {tUi('conflict.cancel')}
          </button>
          <button
            onClick={handleInstall}
            disabled={installing}
            className="flex items-center gap-2 rounded-md bg-xp-blue px-4 py-2 text-sm text-xp-on-accent transition-colors hover:bg-xp-blue/80 disabled:opacity-50"
          >
            {installing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {tUi('agentManager.skillsBrowser.installing')}
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                {tUi('dialogs.extensionInstall')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default XtensionInstallDialog;
