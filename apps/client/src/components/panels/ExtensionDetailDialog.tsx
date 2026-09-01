import { MARKETPLACE_API_URL } from '@/lib/constants';
import { TauriAPI } from '@/lib/tauri-api';
import React from 'react';
import { X, Download, Star, ExternalLink, Shield, Loader2, User, Tag } from 'lucide-react';
import type { MarketplaceExtension } from './MarketplacePanel';

interface ExtensionDetailDialogProps {
  isOpen: boolean;
  onClose: () => void;
  extension: MarketplaceExtension | null;
  isInstalled: boolean;
  isInstalling: boolean;
  onInstall: (extension: MarketplaceExtension) => void;
}

const ExtensionDetailDialog = ({
  isOpen,
  onClose,
  extension,
  isInstalled,
  isInstalling,
  onInstall,
}: ExtensionDetailDialogProps) => {
  if (!isOpen || !extension) return null;

  const renderStars = (rating: number) => {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <Star
          key={i}
          className={`h-4 w-4 ${
            i <= Math.round(rating) ? 'fill-xp-yellow text-xp-yellow' : 'text-xp-text-muted'
          }`}
        />,
      );
    }
    return stars;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[80vh] w-[480px] max-w-[90vw] flex-col rounded-lg border border-xp-border bg-xp-surface">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-xp-border p-5">
          <div className="flex min-w-0 items-start gap-3">
            {/* Icon */}
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg border border-xp-border bg-xp-bg text-lg">
              {extension.icon ? (
                extension.icon.trim().startsWith('<') ? (
                  <span
                    className="flex h-8 w-8 items-center justify-center [&>svg]:h-8 [&>svg]:w-8"
                    dangerouslySetInnerHTML={{ __html: extension.icon }}
                  />
                ) : (
                  <span className="text-xl">{extension.icon}</span>
                )
              ) : (
                <span className="text-xl font-medium text-xp-blue">
                  {extension.displayName.charAt(0).toUpperCase()}
                </span>
              )}
            </div>

            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-xp-text">
                {extension.displayName}
              </h2>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="flex items-center gap-1 text-xs text-xp-text-muted">
                  <User className="h-3 w-3" />
                  {extension.author.name || extension.author.username}
                </span>
                <span className="text-xs text-xp-text-muted">&middot;</span>
                <span className="text-xs text-xp-text-muted">v{extension.version}</span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="flex-shrink-0 rounded p-1 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Stats row */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              {renderStars(extension.averageRating)}
              <span className="ml-1 text-sm text-xp-text">
                {extension.averageRating.toFixed(1)}
              </span>
              <span className="text-xs text-xp-text-muted">
                ({extension.reviewCount} review{extension.reviewCount !== 1 ? 's' : ''})
              </span>
            </div>
            <span className="flex items-center gap-1 text-sm text-xp-text-muted">
              <Download className="h-4 w-4" />
              {extension.downloadCount.toLocaleString()} downloads
            </span>
          </div>

          {/* Description */}
          <div>
            <h3 className="mb-1.5 text-sm font-medium text-xp-text">Description</h3>
            <p className="text-sm leading-relaxed text-xp-text-muted">{extension.description}</p>
          </div>

          {/* Categories */}
          {extension.categories && extension.categories.length > 0 && (
            <div>
              <h3 className="mb-1.5 flex items-center gap-1 text-sm font-medium text-xp-text">
                <Tag className="h-3.5 w-3.5" />
                Categories
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {extension.categories.map((cat) => (
                  <span
                    key={cat.slug}
                    className="rounded border border-xp-blue/20 bg-xp-blue/10 px-2 py-0.5 text-xs text-xp-blue"
                  >
                    {cat.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Permissions */}
          {extension.permissions && extension.permissions.length > 0 && (
            <div>
              <h3 className="mb-1.5 flex items-center gap-1 text-sm font-medium text-xp-text">
                <Shield className="h-3.5 w-3.5" />
                Permissions
              </h3>
              <div className="space-y-1">
                {extension.permissions.map((perm) => (
                  <div
                    key={perm}
                    className="flex items-center gap-2 rounded border border-xp-border bg-xp-bg px-2.5 py-1.5 text-xs text-xp-text-muted"
                  >
                    <Shield className="h-3 w-3 flex-shrink-0 text-xp-yellow" />
                    {perm}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-xp-border p-4">
          <button
            onClick={() => {
              const baseUrl = MARKETPLACE_API_URL.replace(/\/api$/, '');
              TauriAPI.openUrl(`${baseUrl}/extensions/${extension.slug || extension.id}`);
            }}
            className="flex items-center gap-1.5 rounded border border-xp-border px-3 py-1.5 text-sm text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View on Web
          </button>

          {isInstalled ? (
            <span className="rounded-md border border-xp-green/30 bg-xp-green/20 px-4 py-1.5 text-sm text-xp-green">
              Installed
            </span>
          ) : (
            <button
              onClick={() => onInstall(extension)}
              disabled={isInstalling}
              className="flex items-center gap-1.5 rounded-md bg-xp-blue px-4 py-1.5 text-sm text-white transition-colors hover:bg-xp-blue/80 disabled:opacity-50"
            >
              {isInstalling ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Installing...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Install
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExtensionDetailDialog;
