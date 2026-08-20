import React from 'react';
import i18n from '@/i18n';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ShieldCheck, ShieldAlert, ShieldQuestion, Puzzle, User, Package } from 'lucide-react';
import type { ExtensionManifestInfo } from '@/lib/tauri-api';
import { sortPermissions, countByRisk, type RiskLevel } from '@/lib/extension-permissions';

interface PermissionReviewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  manifest: ExtensionManifestInfo | null;
  verified?: boolean;
  onApprove: () => void;
  installing?: boolean;
}

const RISK_COLORS: Record<RiskLevel, { bg: string; text: string; border: string }> = {
  danger: { bg: 'bg-xp-red/10', text: 'text-xp-red', border: 'border-xp-red/30' },
  warning: { bg: 'bg-xp-orange/10', text: 'text-xp-orange', border: 'border-xp-orange/30' },
  safe: { bg: 'bg-xp-green/10', text: 'text-xp-green', border: 'border-xp-green/30' },
};

const PermissionReviewDialog = ({
  isOpen,
  onClose,
  manifest,
  verified,
  onApprove,
  installing = false,
}: PermissionReviewDialogProps) => {
  if (!manifest) return null;

  const permissions = manifest.permissions ?? [];
  const sorted = sortPermissions(permissions);
  const counts = countByRisk(permissions);
  const hasDanger = counts.danger > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg border-xp-border bg-xp-bg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xp-text">
            <Puzzle className="h-5 w-5 text-xp-blue" />
            Review Extension
          </DialogTitle>
        </DialogHeader>

        {/* Extension Info */}
        <div className="flex items-start gap-3 rounded-lg border border-xp-border bg-xp-surface p-3">
          <div className="bg-xp-blue/20 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
            <Package className="h-5 w-5 text-xp-blue" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-xp-text">
              {manifest.display_name || manifest.name}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-xp-text-muted">
              <span>v{manifest.version}</span>
              <span className="opacity-40">|</span>
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {manifest.author}
              </span>
            </div>
            {manifest.description && (
              <p className="mt-1.5 line-clamp-2 text-xs text-xp-text-muted">
                {manifest.description}
              </p>
            )}
          </div>
        </div>

        {/* Signature Status */}
        <div
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${
            verified
              ? 'bg-xp-green/10 border-xp-green/30 border text-xp-green'
              : 'bg-xp-orange/10 border-xp-orange/30 border text-xp-orange'
          }`}
        >
          {verified ? (
            <>
              <ShieldCheck className="h-4 w-4" />
              Verified — Signature matches
            </>
          ) : (
            <>
              <ShieldQuestion className="h-4 w-4" />
              Unsigned — This extension has not been verified
            </>
          )}
        </div>

        {/* Permissions */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-xp-text">
              Permissions ({permissions.length})
            </h4>
            {hasDanger && (
              <span className="flex items-center gap-1 text-xs text-xp-red">
                <ShieldAlert className="h-3 w-3" />
                {counts.danger} dangerous
              </span>
            )}
          </div>

          {permissions.length === 0 ? (
            <div className="rounded-lg border border-xp-border bg-xp-surface p-3 text-center text-xs text-xp-text-muted">
              This extension requests no special permissions.
            </div>
          ) : (
            <ScrollArea className="max-h-52">
              <div className="space-y-1.5">
                {sorted.map((perm) => {
                  const colors = RISK_COLORS[perm.risk];
                  const Icon = perm.icon;
                  return (
                    <div
                      key={perm.id}
                      className={`flex items-start gap-2.5 rounded-lg border p-2 ${colors.bg} ${colors.border}`}
                    >
                      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${colors.text}`} />
                      <div className="min-w-0">
                        <div className={`text-xs font-medium ${colors.text}`}>{perm.label}</div>
                        <div className="text-xs text-xp-text-muted">{perm.description}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Summary + Buttons */}
        <div className="flex items-center justify-between border-t border-xp-border pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="border-xp-border text-xp-text hover:bg-xp-surface-light"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onApprove}
            disabled={installing}
            className={`gap-1.5 ${
              hasDanger
                ? 'hover:bg-xp-orange/90 bg-xp-orange text-white'
                : 'hover:bg-xp-blue/90 bg-xp-blue text-white'
            }`}
          >
            {installing ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            {installing
              ? i18n.t('dialogs.permissionReview.installing')
              : i18n.t('dialogs.permissionReview.installActivate')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PermissionReviewDialog;
