import React from 'react';
import { Download, Star, Loader2, Trash2 } from 'lucide-react';
import { renderIcon } from '@/lib/utils';
import type { MarketplaceExtension } from '../MarketplacePanel';

interface ExtensionCardProps {
  extension: MarketplaceExtension;
  isInstalled: boolean;
  isDev?: boolean;
  isInstalling: boolean;
  onInstall: (extension: MarketplaceExtension) => void;
  onUninstall: (extension: MarketplaceExtension) => void;
  onSelect: (extension: MarketplaceExtension) => void;
}

const renderStars = (rating: number) => {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    stars.push(
      <Star
        key={i}
        className={`h-3 w-3 ${
          i <= Math.round(rating) ? 'fill-xp-yellow text-xp-yellow' : 'text-xp-text-muted'
        }`}
      />,
    );
  }
  return stars;
};

const ExtensionCard = React.memo(
  ({
    extension,
    isInstalled,
    isDev,
    isInstalling,
    onInstall,
    onUninstall,
    onSelect,
  }: ExtensionCardProps) => {
    return (
      <div
        className="border-xp-border/50 cursor-pointer border-b px-3 py-2.5 transition-colors hover:bg-xp-surface-light/50"
        onClick={() => onSelect(extension)}
      >
        <div className="flex min-w-0 items-start gap-2">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-xp-border bg-xp-surface text-xp-blue">
            {extension.icon ? (
              extension.icon.trim().startsWith('<') ? (
                <span
                  className="flex items-center justify-center [&>svg]:h-4 [&>svg]:w-4"
                  dangerouslySetInnerHTML={{ __html: extension.icon }}
                />
              ) : (
                renderIcon(extension.icon, 16)
              )
            ) : (
              <span className="text-sm font-semibold">
                {extension.displayName.charAt(0).toUpperCase()}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h4 className="truncate text-sm font-medium text-xp-text">{extension.displayName}</h4>
              <div className="flex-shrink-0">
                {isDev ? (
                  <span className="rounded border border-xp-green/30 bg-xp-green/10 px-2 py-0.5 text-[10px] font-medium text-xp-green">
                    Dev Mode
                  </span>
                ) : isInstalled ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onUninstall(extension);
                    }}
                    disabled={isInstalling}
                    className="flex items-center rounded p-1 text-xp-text-muted transition-colors hover:bg-xp-red/10 hover:text-xp-red disabled:opacity-50"
                    title="Uninstall"
                  >
                    {isInstalling ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onInstall(extension);
                    }}
                    disabled={isInstalling}
                    className="flex items-center gap-1 rounded bg-xp-blue px-2 py-0.5 text-[11px] text-white transition-colors hover:bg-xp-blue/80 disabled:opacity-50"
                  >
                    {isInstalling ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Installing
                      </>
                    ) : (
                      'Install'
                    )}
                  </button>
                )}
              </div>
            </div>

            <p className="truncate text-[11px] text-xp-text-muted">
              {extension.author.name || extension.author.username} &middot; v{extension.version}
            </p>

            <p className="mt-1 line-clamp-2 text-xs text-xp-text-muted">{extension.description}</p>

            <div className="mt-1.5 flex items-center gap-3">
              <span className="flex items-center gap-0.5 text-[11px] text-xp-text-muted">
                <Download className="h-3 w-3 flex-shrink-0" />
                {extension.downloadCount.toLocaleString()}
              </span>
              <span className="flex items-center gap-0.5 text-[11px] text-xp-text-muted">
                {renderStars(extension.averageRating)}
                <span className="ml-0.5">{extension.averageRating.toFixed(1)}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

export default ExtensionCard;
