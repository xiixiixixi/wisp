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
  'file:read': i18n.t('dialogs.permissions.permDesc.file_read'),
  'file:write': i18n.t('dialogs.permissions.permDesc.file_write'),
  'ui:panels': i18n.t('dialogs.permissions.permDesc.ui_panels'),
  'ui:notifications': i18n.t('dialogs.permissions.permDesc.ui_notifications'),
  'native:invoke': i18n.t('dialogs.permissions.permDesc.native_invoke'),
  'network:fetch': i18n.t('dialogs.permissions.permDesc.fetch'),
};

const XtensionInstallDialog = ({
  isOpen,
  onClose,
  manifest,
  onInstall,
}: XtensionInstallDialogProps) => {
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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative w-[420px] max-w-[90vw] overflow-hidden rounded-lg border border-xp-border bg-xp-bg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-xp-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="bg-xp-blue/20 border-xp-blue/30 flex h-10 w-10 items-center justify-center rounded-lg border">
              <Package className="h-5 w-5 text-xp-blue" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-xp-text">Install Extension</h2>
              <p className="text-xs text-xp-text-muted">.xtension package</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 px-5 py-4">
          {/* Extension info */}
          <div className="space-y-1">
            <h3 className="text-base font-medium text-xp-text">{displayName}</h3>
            <p className="text-xs text-xp-text-muted">
              v{manifest.version} by {manifest.author}
            </p>
            {manifest.description && (
              <p className="mt-2 text-sm text-xp-text-secondary">{manifest.description}</p>
            )}
          </div>

          {/* Permissions */}
          {permissions.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-xp-text-muted">
                <Shield className="h-3.5 w-3.5" />
                Requested Permissions
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
        <div className="bg-xp-surface/50 flex items-center justify-end gap-2 border-t border-xp-border px-5 py-3">
          <button
            onClick={onClose}
            disabled={installing}
            className="rounded-md border border-xp-border bg-xp-surface px-4 py-2 text-sm text-xp-text transition-colors hover:bg-xp-surface-light disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleInstall}
            disabled={installing}
            className="hover:bg-xp-blue/80 flex items-center gap-2 rounded-md bg-xp-blue px-4 py-2 text-sm text-white transition-colors disabled:opacity-50"
          >
            {installing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Installing...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Install Extension
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default XtensionInstallDialog;
