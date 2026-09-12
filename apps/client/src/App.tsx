import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'wouter';
import { queryClient } from './lib/queryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import ExplorerUnified from '@/pages/wisp';
import NotFound from '@/pages/not-found';
import { TauriAPI } from '@/lib/tauri-api';
import { extensionHost } from '@/lib/extension-host';
import { useToast } from '@/hooks/use-toast';
import XtensionInstallDialog from '@/components/dialogs/XtensionInstallDialog';
import UpdateBanner from '@/components/UpdateBanner';

// Keep the explorer mounted beneath settings, including legacy /settings links.
const Settings = React.lazy(() => import('@/pages/settings'));

export const AppWorkspace = () => {
  const [location, setLocation] = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(location === '/settings');
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const openSettings = (event: Event) => {
      // Capture before inert blurs the workspace or the menu unmounts.
      const trigger = (event as CustomEvent<{ returnFocus?: HTMLElement }>).detail?.returnFocus;
      const active = document.activeElement;
      if (!active?.closest('[role="dialog"]')) {
        returnFocusRef.current = trigger ?? (active instanceof HTMLElement ? active : null);
      }
      setSettingsOpen(true);
    };
    window.addEventListener('wisp-open-settings', openSettings);
    return () => window.removeEventListener('wisp-open-settings', openSettings);
  }, []);

  useEffect(() => {
    if (location === '/settings') setSettingsOpen(true);
  }, [location]);

  const closeSettings = () => {
    setSettingsOpen(false);
    const previous = returnFocusRef.current;
    returnFocusRef.current = null;
    requestAnimationFrame(() => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    });
    if (location === '/settings') setLocation(`/${window.location.search}`, { replace: true });
  };

  const explorerVisible = ['/', '/explorer', '/settings'].includes(location);

  return (
    <>
      <div inert={settingsOpen ? true : undefined} aria-hidden={settingsOpen ? true : undefined}>
        {explorerVisible ? <ExplorerUnified /> : <NotFound />}
      </div>
      {settingsOpen && (
        <React.Suspense fallback={null}>
          <Settings onClose={closeSettings} />
        </React.Suspense>
      )}
    </>
  );
};

const XtensionFileHandler = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [pendingXtension, setPendingXtension] = useState<{
    path: string;
    manifest: {
      id: string;
      name: string;
      display_name?: string;
      description?: string;
      version: string;
      author: string;
      permissions?: string[];
    } | null;
  } | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    TauriAPI.listenToEvent<string>('xtension-file-opened', async (xtensionPath) => {
      try {
        const manifest = await TauriAPI.inspectXtensionFile(xtensionPath);
        setPendingXtension({ path: xtensionPath, manifest });
      } catch (err) {
        toast({
          title: t('toast.invalidExtension'),
          description: String(err),
          variant: 'destructive',
        });
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(console.error);
    return () => {
      unlisten?.();
    };
  }, [t, toast]);

  const handleInstall = useCallback(async () => {
    if (!pendingXtension) return;
    try {
      const pkg = await TauriAPI.installXtensionFile(pendingXtension.path);
      await extensionHost.loadExtension(pkg);
      await extensionHost.activateExtension(pkg.manifest.id);
      toast({
        title: t('toast.extensionInstalled'),
        description: t('toast.extensionInstalledDesc', {
          name: pkg.manifest.display_name || pkg.manifest.name,
          version: pkg.manifest.version,
        }),
      });
    } catch (err) {
      toast({
        title: t('toast.installFailed'),
        description: String(err),
        variant: 'destructive',
      });
    } finally {
      setPendingXtension(null);
    }
  }, [pendingXtension, t, toast]);

  if (!pendingXtension) return null;

  return (
    <XtensionInstallDialog
      isOpen={!!pendingXtension}
      onClose={() => setPendingXtension(null)}
      manifest={pendingXtension.manifest}
      onInstall={handleInstall}
    />
  );
};

const App = () => {
  useEffect(() => {
    // Signal to the Rust backend that the frontend is ready to receive events.
    // The backend defers CLI-triggered events (xtension-file-opened, folder-opened)
    // until this signal arrives, avoiding race conditions with sleep-based timing.
    import('@tauri-apps/api/event')
      .then(({ emit }) => emit('frontend-ready'))
      .catch(() => {
        // Not running in Tauri (e.g. web mode) -- ignore silently
      });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <UpdateBanner />
      <ErrorBoundary>
        <AppWorkspace />
      </ErrorBoundary>
      <XtensionFileHandler />
    </QueryClientProvider>
  );
};

export default App;
