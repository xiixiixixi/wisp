import i18n from '@/i18n';
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { TauriAPI } from '@/lib/tauri-api';
import { extensionHost } from '@/lib/extension-host';
import { useToast } from '@/hooks/use-toast';
import {
  requiresConsentDialog,
  requestPermissionConsent,
  requestBulkPermissionConsent,
  type ExtensionPermissionRequestDetail,
} from '@/components/dialogs/ExtensionPermissionDialog';
import {
  Search,
  ExternalLink,
  RefreshCw,
  Package,
  Loader2,
  AlertCircle,
  Inbox,
  FolderOpen,
  Download as _Download,
  Trash2 as _Trash2,
} from 'lucide-react';
import ExtensionDetailDialog from './ExtensionDetailDialog';
import { BUILTIN_CATEGORIES } from '@/data/builtin-extensions';
import { EXTENSION_PACKS as _EXTENSION_PACKS, type ExtensionPack } from '@/data/extension-packs';
import ExtensionCard from './marketplace/ExtensionCard';
import MarketplaceFilters from './marketplace/MarketplaceFilters';
import MarketplacePagination from './marketplace/MarketplacePagination';

import { MARKETPLACE_API_URL } from '@/lib/constants';

const getMarketplaceApi = (): string => MARKETPLACE_API_URL;

/** Fetch marketplace API via Rust proxy to avoid CORS. Falls back to direct fetch. */
const marketplaceFetch = async (url: string): Promise<unknown> => {
  try {
    const text = await invoke<string>('marketplace_proxy', { url });
    return JSON.parse(text);
  } catch {
    // Fallback to direct fetch (works if CORS is configured)
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
};

export interface MarketplaceExtension {
  id: string;
  name: string;
  displayName: string;
  slug: string;
  description: string;
  version: string;
  checksum: string;
  icon: string | null;
  downloadCount: number;
  averageRating: number;
  reviewCount: number;
  author: {
    username: string;
    name: string | null;
  };
  categories: Array<{ name: string; slug: string }>;
  downloadUrl: string;
  permissions?: string[];
  isInstalled?: boolean;
}

interface MarketplaceCategory {
  id: string;
  name: string;
  slug: string;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type SortOption = 'popular' | 'recent' | 'rating';

interface ExtensionsContentProps {
  isLoading: boolean;
  error: string | null;
  extensions: MarketplaceExtension[];
  installedExtensions: string[];
  devExtensions: Set<string>;
  installingId: string | null;
  debouncedSearch: string;
  selectedCategory: string;
  handleInstall: (ext: MarketplaceExtension) => void;
  handleUninstall: (extension: MarketplaceExtension) => void;
  loadExtensions: (page: number) => void;
  setSearchTerm: (term: string) => void;
  setSelectedCategory: (cat: string) => void;
  setSelectedExtension: (ext: MarketplaceExtension) => void;
  setShowDetail: (show: boolean) => void;
}

const ExtensionsContent = ({
  isLoading,
  error,
  extensions,
  installedExtensions,
  devExtensions,
  installingId,
  debouncedSearch,
  selectedCategory,
  handleInstall,
  handleUninstall,
  loadExtensions,
  setSearchTerm,
  setSelectedCategory,
  setSelectedExtension,
  setShowDetail,
}: ExtensionsContentProps) => {
  if (isLoading) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-2">
        <Loader2 className="h-6 w-6 animate-spin text-xp-blue" />
        <span className="text-xs text-xp-text-muted">Loading extensions...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-2 px-4">
        <AlertCircle className="h-6 w-6 text-xp-red" />
        <span className="text-center text-xs text-xp-text-muted">Failed to load extensions</span>
        <span className="break-all text-center text-xs text-xp-red">{error}</span>
        <button
          onClick={() => loadExtensions(1)}
          className="mt-1 rounded border border-xp-border bg-xp-surface px-3 py-1 text-xs text-xp-text transition-colors hover:bg-xp-surface-light"
        >
          Retry
        </button>
      </div>
    );
  }

  if (extensions.length === 0) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-2">
        <Inbox className="h-6 w-6 text-xp-text-muted" />
        <span className="text-xs text-xp-text-muted">No extensions found</span>
        {(debouncedSearch || selectedCategory) && (
          <button
            onClick={() => {
              setSearchTerm('');
              setSelectedCategory('');
            }}
            className="text-xs text-xp-blue hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      {extensions.map((extension) => (
        <ExtensionCard
          key={extension.id}
          extension={extension}
          isInstalled={
            installedExtensions.includes(extension.id) ||
            installedExtensions.includes(extension.slug)
          }
          isDev={devExtensions.has(extension.id) || devExtensions.has(extension.slug)}
          isInstalling={installingId === extension.id}
          onInstall={handleInstall}
          onUninstall={handleUninstall}
          onSelect={(ext) => {
            setSelectedExtension(ext);
            setShowDetail(true);
          }}
        />
      ))}
    </div>
  );
};

const MarketplacePanel = () => {
  const { t } = useTranslation();
  const { toast } = useToast();

  // Data state
  const [extensions, setExtensions] = useState<MarketplaceExtension[]>([]);
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [installedExtensions, setInstalledExtensions] = useState<string[]>([]);
  const [devExtensions, setDevExtensions] = useState<Set<string>>(new Set());
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('popular');
  const [installingId, setInstallingId] = useState<string | null>(null);
  // TODO: re-enable packs view when extension packs are ready
  // const [view, setView] = useState<'extensions' | 'packs'>('packs');
  const view = 'extensions' as const;
  const [_installingPackId, setInstallingPackId] = useState<string | null>(null);

  // Detail dialog
  const [selectedExtension, setSelectedExtension] = useState<MarketplaceExtension | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Load installed extensions and categories on mount
  useEffect(() => {
    loadInstalledExtensions();
    loadCategories();
    loadExtensions(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload extensions when filters change
  useEffect(() => {
    loadExtensions(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, selectedCategory, sortBy]);

  const loadCategories = async () => {
    try {
      const data = (await marketplaceFetch(`${getMarketplaceApi()}/categories`)) as {
        categories?: MarketplaceCategory[];
      };
      if (data.categories) setCategories(data.categories);
    } catch {
      // Remote marketplace not available
    }
    setCategories(BUILTIN_CATEGORIES);
  };

  const loadInstalledExtensions = async () => {
    try {
      const installed = await TauriAPI.getInstalledExtensions();
      setInstalledExtensions(installed.map((ext) => ext.manifest.id));
      setDevExtensions(
        new Set(
          installed
            .filter((ext) => (ext as { is_dev?: boolean }).is_dev)
            .map((ext) => ext.manifest.id),
        ),
      );
    } catch (err) {
      console.error('Failed to load installed extensions:', err);
    }
  };

  const loadExtensions = useCallback(
    async (page: number) => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (selectedCategory) params.set('category', selectedCategory);
        params.set('sort', sortBy);
        params.set('page', String(page));
        params.set('limit', '20');

        const data = (await marketplaceFetch(
          `${getMarketplaceApi()}/extensions?${params.toString()}`,
        )) as { extensions?: MarketplaceExtension[]; pagination?: PaginationInfo };
        // Themes are built into Wisp (Ink/Slate/Paper) — hide marketplace theme extensions.
        const nonTheme = (data.extensions || []).filter(
          (ext) => !ext.categories?.some((c) => c.slug === 'theme'),
        );
        setExtensions(nonTheme);
        setPagination(
          data.pagination || {
            page,
            limit: 20,
            total: data.extensions?.length || 0,
            totalPages: 1,
          },
        );
      } catch {
        setError(i18n.t('marketplace.unavailable'));
        setExtensions([]);
      } finally {
        setIsLoading(false);
      }
    },
    [debouncedSearch, selectedCategory, sortBy],
  );

  const handleInstall = async (extension: MarketplaceExtension) => {
    const perms = extension.permissions ?? [];

    if (requiresConsentDialog(perms)) {
      const granted = await requestPermissionConsent({
        extensionId: extension.id,
        extensionName: extension.name,
        displayName: extension.displayName,
        version: extension.version,
        author: extension.author.name ?? extension.author.username,
        permissions: perms,
      });

      if (!granted) {
        toast({
          title: t('permissions.cancelledTitle'),
          description: t('permissions.cancelledDesc'),
          variant: 'destructive',
        });
        return;
      }
    }

    setInstallingId(extension.id);
    try {
      const downloadUrl = `${getMarketplaceApi()}/extensions/${extension.id}/download`;
      const pkg = await TauriAPI.downloadAndInstallExtension(
        downloadUrl,
        extension.id,
        extension.checksum,
      );
      await extensionHost.loadExtension(pkg);
      await extensionHost.activateExtension(pkg.manifest.id);
      // Track by manifest ID (matches slug and what loadInstalledExtensions uses)
      setInstalledExtensions((prev) => [...prev, pkg.manifest.id]);
      toast({
        title: t('toast.installed'),
        description: t('toast.extensionInstalledDesc', {
          name: extension.displayName,
          version: '',
        }),
      });
    } catch (err) {
      console.error('[Marketplace] Install failed:', extension.id, err);
      toast({
        title: t('toast.installFailed'),
        description: String(err),
        variant: 'destructive',
      });
    } finally {
      setInstallingId(null);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      loadExtensions(newPage);
    }
  };

  const handleInstallFromFile = async () => {
    try {
      const files = await TauriAPI.showOpenDialog({
        multiple: false,
        filters: [{ name: 'Wisp Extension', extensions: ['xtension'] }],
      });
      if (!files || files.length === 0) return;

      const xtensionPath = files[0];
      setInstallingId('__file__');
      const pkg = await TauriAPI.installXtensionFile(xtensionPath);
      await extensionHost.loadExtension(pkg);
      await extensionHost.activateExtension(pkg.manifest.id);
      setInstalledExtensions((prev) => [...prev, pkg.manifest.id]);
      toast({
        title: t('toast.installed'),
        description: t('toast.extensionInstalledDesc', {
          name: pkg.manifest.display_name || pkg.manifest.name,
          version: pkg.manifest.version,
        }),
      });
      loadExtensions(pagination.page);
    } catch (err) {
      toast({
        title: t('toast.installFailed'),
        description: String(err),
        variant: 'destructive',
      });
    } finally {
      setInstallingId(null);
    }
  };

  const handleUninstall = async (extension: MarketplaceExtension) => {
    setInstallingId(extension.id);
    try {
      // Use slug (matches manifest ID on disk) rather than marketplace CUID
      await extensionHost.uninstallExtension(extension.slug || extension.id);
      setInstalledExtensions((prev) =>
        prev.filter((id) => id !== extension.id && id !== extension.slug),
      );
      toast({
        title: t('toast.uninstalled'),
        description: t('toast.extensionUninstalledDesc', { name: extension.displayName }),
      });
    } catch (err) {
      toast({
        title: t('toast.uninstallFailed'),
        description: String(err),
        variant: 'destructive',
      });
    } finally {
      setInstallingId(null);
    }
  };

  const requestBulkConsent = async (toInstall: string[]): Promise<boolean> => {
    // Build per-extension detail objects for extensions that need consent
    const extDetails: ExtensionPermissionRequestDetail[] = toInstall
      .map((extId) => {
        const known = extensions.find((e) => e.id === extId || e.slug === extId);
        const perms = known?.permissions ?? [];
        return {
          extensionId: extId,
          extensionName: known?.name ?? extId,
          displayName: known?.displayName ?? known?.name ?? extId,
          version: known?.version ?? '1.0.0',
          author: known?.author.name ?? known?.author.username ?? 'Unknown',
          permissions: perms,
        };
      })
      .filter((detail) => requiresConsentDialog(detail.permissions));

    if (extDetails.length === 0) return true;

    return requestBulkPermissionConsent(extDetails);
  };

  // TODO: re-enable when packs view is ready
  const _handleInstallPack = async (pack: ExtensionPack) => {
    const toInstall = pack.extensions.filter((id) => !installedExtensions.includes(id));

    const granted = await requestBulkConsent(toInstall);

    if (!granted) {
      toast({
        title: t('permissions.cancelledTitle'),
        description: t('permissions.cancelledDesc'),
        variant: 'destructive',
      });
      return;
    }

    setInstallingPackId(pack.id);
    let installed = 0;
    const failedIds: string[] = [];

    for (const extId of pack.extensions) {
      if (installedExtensions.includes(extId)) continue;

      try {
        const downloadUrl = `${getMarketplaceApi()}/extensions/${extId}/download`;
        const pkg = await TauriAPI.downloadAndInstallExtension(downloadUrl, extId, '');
        await extensionHost.loadExtension(pkg);
        await extensionHost.activateExtension(pkg.manifest.id);
        setInstalledExtensions((prev) => [...prev, extId]);
        installed++;
      } catch (err) {
        console.error(`Failed to install ${extId}:`, err);
        failedIds.push(extId);
      }
    }

    setInstallingPackId(null);

    if (installed > 0) {
      toast({
        title: t('toast.packInstalled', { name: pack.name }),
        description: t('toast.packInstalledDesc', {
          count: installed,
          failed: failedIds.length > 0 ? ` (${failedIds.join(', ')})` : '',
        }),
      });
    } else if (failedIds.length > 0) {
      toast({
        title: t('toast.installFailed'),
        description: t('toast.couldNotInstall', { names: failedIds.join(', ') }),
        variant: 'destructive',
      });
    }
  };

  const _handleUninstallPack = async (pack: ExtensionPack) => {
    setInstallingPackId(pack.id);
    let removed = 0;
    const failedIds: string[] = [];

    for (const extId of pack.extensions) {
      if (!installedExtensions.includes(extId)) continue;

      try {
        await extensionHost.uninstallExtension(extId);
        setInstalledExtensions((prev) => prev.filter((id) => id !== extId));
        removed++;
      } catch (err) {
        console.error(`Failed to uninstall ${extId}:`, err);
        failedIds.push(extId);
      }
    }

    setInstallingPackId(null);

    if (removed > 0) {
      toast({
        title: t('toast.packUninstalled', { name: pack.name }),
        description: t('toast.packUninstalledDesc', {
          count: removed,
          failed: failedIds.length > 0 ? ` (${failedIds.join(', ')})` : '',
        }),
      });
    } else if (failedIds.length > 0) {
      toast({
        title: t('toast.uninstallFailed'),
        description: t('toast.couldNotRemove', { names: failedIds.join(', ') }),
        variant: 'destructive',
      });
    }
  };

  const _getPackStatus = (pack: ExtensionPack) => {
    const total = pack.extensions.length;
    const installedCount = pack.extensions.filter((id) => installedExtensions.includes(id)).length;
    return { total, installedCount, isFullyInstalled: installedCount === total };
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-xp-bg text-xp-text">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-xp-border px-3 py-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Package className="h-4 w-4 text-xp-blue" />
          Extension Marketplace
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={handleInstallFromFile}
            disabled={!!installingId}
            className="rounded p-1.5 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
            title="Install from .xtension file"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => loadExtensions(pagination.page)}
            disabled={isLoading}
            className="rounded p-1.5 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
            title="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => TauriAPI.openUrl('https://xplorer.space')}
            className="rounded p-1.5 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
            title={i18n.t('marketplace.openWebsite')}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="border-b border-xp-border px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-xp-text-muted" />
          <input
            type="text"
            placeholder={i18n.t('marketplace.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-md border border-xp-border bg-xp-surface py-1.5 pl-9 pr-3 text-sm text-xp-text transition-colors placeholder:text-xp-text-muted focus:border-xp-blue focus:outline-none"
          />
        </div>
      </div>

      {/* TODO: re-enable packs view when extension packs are ready
      <div className="border-xp-border flex border-b">
        <button
          onClick={() => setView('packs')}
          className={`flex-1 py-1.5 text-center text-xs font-medium transition-colors ${
            view === 'packs'
              ? 'text-xp-blue border-xp-blue border-b-2'
              : 'text-xp-text-muted hover:text-xp-text'
          }`}
        >
          Extension Packs
        </button>
        <button
          onClick={() => setView('extensions')}
          className={`flex-1 py-1.5 text-center text-xs font-medium transition-colors ${
            view === 'extensions'
              ? 'text-xp-blue border-xp-blue border-b-2'
              : 'text-xp-text-muted hover:text-xp-text'
          }`}
        >
          All Extensions
        </button>
      </div>
      */}

      {/* Category filters + Sort */}
      <MarketplaceFilters
        categories={categories}
        selectedCategory={selectedCategory}
        setSelectedCategory={setSelectedCategory}
        sortBy={sortBy}
        setSortBy={setSortBy}
        pagination={pagination}
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* TODO: re-enable packs view when extension packs are ready
        {view === 'packs' ? (
          <div className="space-y-3 p-3">
            {EXTENSION_PACKS.map((pack) => {
              const { total, installedCount, isFullyInstalled } = getPackStatus(pack);
              const isInstalling = installingPackId === pack.id;
              return (
                <div
                  key={pack.id}
                  className="border-xp-border hover:bg-xp-surface-light/50 rounded-lg border p-3 transition-colors"
                  style={{ background: 'rgba(var(--xp-surface-rgb, 30,30,46), 0.5)' }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                      style={{ background: 'rgba(var(--xp-blue-rgb, 122,162,247), 0.15)' }}
                    >
                      <svg
                        className="text-xp-blue h-5 w-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d={pack.iconPath} />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="truncate text-sm font-medium">{pack.name}</h4>
                        {pack.recommended && (
                          <span className="bg-xp-blue/20 text-xp-blue rounded px-1.5 py-0.5 text-[10px] font-medium">
                            Recommended
                          </span>
                        )}
                      </div>
                      <p className="text-xp-text-muted mt-0.5 text-xs">{pack.description}</p>
                      <p className="text-xp-text-muted mt-1 text-[11px]">
                        {installedCount}/{total} extensions installed
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1.5">
                      {isFullyInstalled ? (
                        <button
                          onClick={() => handleUninstallPack(pack)}
                          disabled={isInstalling || !!installingPackId}
                          className="bg-xp-red/20 text-xp-red hover:bg-xp-red/30 flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors"
                        >
                          {isInstalling ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Removing...
                            </>
                          ) : (
                            <>
                              <Trash2 className="h-3.5 w-3.5" />
                              Uninstall
                            </>
                          )}
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => handleInstallPack(pack)}
                            disabled={isInstalling || !!installingPackId}
                            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                              isInstalling
                                ? 'bg-xp-blue/20 text-xp-blue cursor-wait'
                                : 'bg-xp-blue hover:bg-xp-blue/80 text-white'
                            }`}
                          >
                            {isInstalling ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Installing...
                              </>
                            ) : (
                              <>
                                <Download className="h-3.5 w-3.5" />
                                {installedCount > 0 ? i18n.t('marketplace.installRest') : i18n.t('marketplace.installPack')}
                              </>
                            )}
                          </button>
                          {installedCount > 0 && (
                            <button
                              onClick={() => handleUninstallPack(pack)}
                              disabled={isInstalling || !!installingPackId}
                              className="text-xp-text-muted hover:text-xp-red hover:bg-xp-red/10 flex items-center rounded p-1.5 text-xs transition-colors"
                              title={i18n.t('marketplace.uninstallPack')}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : ( */}
        <ExtensionsContent
          isLoading={isLoading}
          error={error}
          extensions={extensions}
          installedExtensions={installedExtensions}
          devExtensions={devExtensions}
          installingId={installingId}
          debouncedSearch={debouncedSearch}
          selectedCategory={selectedCategory}
          handleInstall={handleInstall}
          handleUninstall={handleUninstall}
          loadExtensions={loadExtensions}
          setSearchTerm={setSearchTerm}
          setSelectedCategory={setSelectedCategory}
          setSelectedExtension={setSelectedExtension}
          setShowDetail={setShowDetail}
        />
      </div>

      {/* Pagination (extensions view only) */}
      {view === 'extensions' && (
        <MarketplacePagination
          pagination={pagination}
          isLoading={isLoading}
          onPageChange={handlePageChange}
        />
      )}

      {/* Footer */}
      <div className="border-t border-xp-border px-3 py-1.5">
        <button
          onClick={() => TauriAPI.openUrl('https://xplorer.space/publish')}
          className="hover:text-xp-blue/80 w-full text-center text-xs text-xp-blue transition-colors"
        >
          Publish Your Extension
        </button>
      </div>

      {/* Extension Detail Dialog */}
      <ExtensionDetailDialog
        isOpen={showDetail}
        onClose={() => setShowDetail(false)}
        extension={selectedExtension}
        isInstalled={selectedExtension ? installedExtensions.includes(selectedExtension.id) : false}
        isInstalling={selectedExtension ? installingId === selectedExtension.id : false}
        onInstall={handleInstall}
      />
    </div>
  );
};

export default MarketplacePanel;
