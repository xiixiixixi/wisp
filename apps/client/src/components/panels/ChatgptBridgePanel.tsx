import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CircleAlert,
  Circle,
  CircleCheck,
  CircleHelp,
  ExternalLink,
  FolderPlus,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  StopCircle,
  Trash2,
} from 'lucide-react';
import { TauriAPI, type ChatgptBridgeState } from '@/lib/tauri-api';
import { useToast } from '@/hooks/use-toast';
import { isTauri } from '@/lib/transport';
import { Button } from '@/components/ui/button';
import { PanelConfirmation, PanelMessage } from './PanelFeedback';

interface ChatgptBridgePanelProps {
  currentPath?: string;
}

const PLATFORM_TUNNELS_URL = 'https://platform.openai.com/settings/organization/tunnels';
const PLATFORM_API_KEYS_URL = 'https://platform.openai.com/settings/organization/api-keys';
const CHATGPT_CONNECTORS_URL = 'https://chatgpt.com/#settings/Connectors';
const BREW_INSTALL_CMD = 'brew install openai/tools/tunnel-client';

const stateDotClass = (state: string): string => {
  switch (state) {
    case 'running':
      return 'bg-xp-green';
    case 'starting':
      return 'bg-amber-500';
    case 'error':
      return 'bg-xp-red';
    default:
      return 'bg-xp-text-muted';
  }
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="wisp-panel-section !px-4">
    <h3 className="wisp-panel-section-title mb-2">{title}</h3>
    {children}
  </section>
);

const BridgeOverview = ({
  statusLabel,
  statusState,
}: {
  statusLabel?: string;
  statusState?: string;
}) => {
  const { t } = useTranslation();
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = React.useId();

  return (
    <section className="border-b border-xp-border px-4 pb-4 pt-4">
      <div className="flex items-center justify-between gap-2">
        {statusLabel ? (
          <span
            aria-live="polite"
            className="flex items-center gap-2 text-xs text-xp-text-secondary"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${stateDotClass(statusState ?? 'stopped')} ${
                statusState === 'starting' ? 'animate-pulse' : ''
              }`}
              aria-hidden="true"
            />
            {statusLabel}
          </span>
        ) : (
          <span className="text-xs font-medium text-xp-text">
            {t('chatgptBridge.overviewTitle')}
          </span>
        )}
        <button
          type="button"
          onClick={() => setHelpOpen((open) => !open)}
          aria-expanded={helpOpen}
          aria-controls={helpId}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-xp-text-secondary hover:text-xp-blue"
        >
          <CircleHelp size={14} aria-hidden="true" />
          {t('chatgptBridge.helpButton')}
        </button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-xp-text-secondary">
        {t('chatgptBridge.overviewDesc')}
      </p>
      <div
        id={helpId}
        hidden={!helpOpen}
        className="mt-3 border-t border-xp-border pt-3 text-xs leading-relaxed text-xp-text-secondary"
      >
        <p className="font-medium text-xp-text">{t('chatgptBridge.helpTitle')}</p>
        <p className="mt-1">{t('chatgptBridge.helpSetup')}</p>
        <p className="mt-2">{t('chatgptBridge.helpScope')}</p>
        <p className="mt-2">{t('chatgptBridge.helpPrivacy')}</p>
      </div>
    </section>
  );
};

const inputClass =
  'w-full rounded-[8px] border border-xp-border bg-xp-surface-light px-2.5 py-1.5 text-xs text-xp-text placeholder:text-xp-text-muted/60 focus:border-xp-blue focus:outline-none';

/**
 * ChatGPT 桥接面板 — configures the read-only Secure MCP Tunnel bridge
 * (tunnel-client + `wisp --chatgpt-bridge-mcp`). Entry point lives on the
 * rail next to the hidden-files toggle.
 */
const ChatgptBridgePanel = ({ currentPath }: ChatgptBridgePanelProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [state, setState] = useState<ChatgptBridgeState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tunnelId, setTunnelId] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [roots, setRoots] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteKeyOpen, setDeleteKeyOpen] = useState(false);

  const applyState = useCallback((next: ChatgptBridgeState) => {
    setState(next);
    setTunnelId(next.config.tunnelId);
    setRoots(next.config.allowedRoots);
    setEnabled(next.config.enabled);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    const load = async (initialize = false) => {
      try {
        const next = await TauriAPI.chatgptBridgeGetState();
        if (initialize) applyState(next);
        else setState(next);
        setLoadError(null);
      } catch (err) {
        setLoadError(String(err));
      }
    };
    void load(true);
    TauriAPI.listenToChatgptBridgeStatus(() => {
      // Status events only change status fields; refresh the snapshot.
      load();
    })
      .then((un) => {
        unlisten = un;
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }, [applyState]);

  const status = state?.status;
  const detected = state?.detectedClientPath;
  const configuredClientPath = state?.config.tunnelClientPath?.trim();
  const clientPath = configuredClientPath || detected;
  const hasApiKey = state?.hasApiKey ?? false;

  const addRoot = async () => {
    try {
      const result = await TauriAPI.showOpenDialog({ directory: true, multiple: false });
      const dir = result?.[0];
      if (dir && !roots.includes(dir)) setRoots((prev) => [...prev, dir]);
    } catch (error) {
      setFormError(String(error));
    }
  };

  const addCurrentFolder = () => {
    if (currentPath && !currentPath.includes('://') && !roots.includes(currentPath)) {
      setRoots((prev) => [...prev, currentPath]);
    }
  };

  const save = async (nextEnabled: boolean) => {
    if (!state) return;
    setFormError(null);
    if (
      nextEnabled &&
      (!tunnelId.trim() || (!hasApiKey && !apiKeyInput.trim()) || roots.length === 0 || !clientPath)
    ) {
      setFormError(t('panelActions.bridgeIncomplete'));
      setEnabled(state.config.enabled);
      return;
    }
    setBusy(true);
    try {
      if (apiKeyInput.trim()) {
        await TauriAPI.chatgptBridgeSetApiKey(apiKeyInput.trim());
        setApiKeyInput('');
      }
      applyState(
        await TauriAPI.chatgptBridgeSaveConfig({
          ...state.config,
          enabled: nextEnabled,
          tunnelId: tunnelId.trim(),
          allowedRoots: roots,
        }),
      );
      setLoadError(null);
      toast({
        title: nextEnabled ? t('chatgptBridge.toastSavedOn') : t('chatgptBridge.toastSavedOff'),
      });
    } catch (err) {
      toast({
        title: t('chatgptBridge.toastSaveError'),
        description: (err as Error).message,
        variant: 'destructive',
      });
      // Refresh so the panel shows the real (possibly error) state.
      try {
        const next = await TauriAPI.chatgptBridgeGetState();
        setState(next);
        setEnabled(next.config.enabled);
      } catch {
        /* keep local edits available for retry */
      }
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    setBusy(true);
    try {
      await TauriAPI.chatgptBridgeRestart();
    } catch (err) {
      toast({
        title: t('chatgptBridge.toastRestartError'),
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await TauriAPI.chatgptBridgeStop();
    } catch (error) {
      setFormError(t('panelActions.stopFailed', { error: String(error) }));
    } finally {
      setBusy(false);
    }
  };

  const openLink = async (url: string) => {
    try {
      await TauriAPI.openUrl(url);
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  };

  const copyBrew = async () => {
    try {
      await navigator.clipboard.writeText(BREW_INSTALL_CMD);
      toast({ title: t('chatgptBridge.toastCopied') });
    } catch (error) {
      setFormError(t('panelActions.copyFailed', { error: String(error) }));
    }
  };

  const desktopRuntime = isTauri();

  if (!desktopRuntime || (loadError && !state)) {
    return (
      <div className="flex h-full flex-col overflow-y-auto">
        <BridgeOverview />
        <section className="px-4 py-4">
          <div className="flex items-start gap-2.5">
            <CircleAlert
              size={16}
              className="mt-0.5 shrink-0 text-xp-text-secondary"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <h3 className="text-xs font-medium text-xp-text">
                {desktopRuntime
                  ? t('panelActions.connectionLoadFailed')
                  : t('chatgptBridge.desktopOnlyTitle')}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-xp-text-secondary">
                {desktopRuntime ? t('chatgptBridge.loadError') : t('chatgptBridge.desktopOnlyDesc')}
              </p>
            </div>
          </div>
          {desktopRuntime && (
            <div className="mt-3">
              <PanelMessage error>{loadError}</PanelMessage>
              <Button
                variant="outline"
                onClick={() =>
                  void TauriAPI.chatgptBridgeGetState()
                    .then((next) => {
                      applyState(next);
                      setLoadError(null);
                    })
                    .catch((error) => setLoadError(String(error)))
                }
              >
                {t('common.error.tryAgain')}
              </Button>
            </div>
          )}
        </section>
      </div>
    );
  }

  const stateLabel = t(`chatgptBridge.state.${status?.state ?? 'stopped'}`);
  let clientStatusText = t('chatgptBridge.clientMissing');
  if (detected) clientStatusText = t('chatgptBridge.clientDetected', { path: detected });
  if (configuredClientPath) {
    clientStatusText = t('chatgptBridge.clientConfigured', { path: configuredClientPath });
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <BridgeOverview statusLabel={stateLabel} statusState={status?.state} />

      <div className="flex flex-col pb-4">
        {formError && (
          <div className="px-4">
            <PanelMessage error>{formError}</PanelMessage>
          </div>
        )}
        {status?.lastError && (
          <div className="mx-4 mt-3 text-xs leading-relaxed text-xp-red">{status.lastError}</div>
        )}

        {/* Persistent connection setting + controls for the current session. */}
        <section className="wisp-panel-section !px-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-xp-text">
                {t('chatgptBridge.enabledTitle')}
              </p>
              <p className="text-[11px] leading-snug text-xp-text-muted">
                {t('chatgptBridge.enabledDesc')}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-label={t('chatgptBridge.enabledTitle')}
              aria-checked={enabled}
              disabled={busy || !state}
              onClick={() => {
                const next = !enabled;
                setEnabled(next);
                save(next);
              }}
              className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-1 text-xs text-xp-text-secondary transition-colors hover:text-xp-blue disabled:opacity-50"
            >
              {enabled ? (
                <CircleCheck size={14} className="text-xp-blue" aria-hidden="true" />
              ) : (
                <Circle size={14} aria-hidden="true" />
              )}
              <span>
                {t(enabled ? 'chatgptBridge.enabledStateOn' : 'chatgptBridge.enabledStateOff')}
              </span>
            </button>
          </div>
          {enabled && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={restart}
                disabled={busy}
                className="flex items-center gap-1.5 text-xs text-xp-text-secondary transition-colors hover:text-xp-blue disabled:opacity-50"
              >
                <RefreshCw size={12} /> {t('chatgptBridge.restart')}
              </button>
              <button
                type="button"
                onClick={stop}
                disabled={busy}
                title={t('chatgptBridge.stopHint')}
                className="flex items-center gap-1.5 text-xs text-xp-text-secondary transition-colors hover:text-xp-blue disabled:opacity-50"
              >
                <StopCircle size={12} /> {t('chatgptBridge.stop')}
              </button>
              {status?.healthUrl && (
                <button
                  type="button"
                  onClick={() => openLink(`${status.healthUrl}/ui`)}
                  className="flex items-center gap-1 text-xs text-xp-blue hover:underline"
                >
                  {t('chatgptBridge.openAdminUi')} <ExternalLink size={11} />
                </button>
              )}
            </div>
          )}
        </section>

        <Section title={t('chatgptBridge.step1Title')}>
          <p className="mb-2 text-xs leading-relaxed text-xp-text-secondary">
            {t('chatgptBridge.step1Desc')}
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-xp-border px-2 py-1.5 font-mono text-[11px] text-xp-text">
              {BREW_INSTALL_CMD}
            </code>
            <button
              type="button"
              onClick={copyBrew}
              className="shrink-0 text-xs text-xp-blue hover:underline"
            >
              {t('chatgptBridge.copy')}
            </button>
          </div>
          <p className="mt-2 break-all text-xs text-xp-text-secondary">{clientStatusText}</p>
        </Section>

        <Section title={t('chatgptBridge.step2Title')}>
          <p className="mb-2 text-xs leading-relaxed text-xp-text-secondary">
            {t('chatgptBridge.step2Desc')}{' '}
            <button
              type="button"
              onClick={() => openLink(PLATFORM_TUNNELS_URL)}
              className="text-xp-blue hover:underline"
            >
              {t('panelActions.openTunnelSettings')}
            </button>
          </p>
          <input
            className={inputClass}
            aria-label={t('chatgptBridge.step2Title')}
            value={tunnelId}
            onChange={(e) => setTunnelId(e.target.value)}
            placeholder="tunnel_0123456789abcdef…"
            spellCheck={false}
          />
        </Section>

        <Section title={t('chatgptBridge.step3Title')}>
          <p className="mb-2 text-xs leading-relaxed text-xp-text-secondary">
            {t('chatgptBridge.step3Desc')}{' '}
            <button
              type="button"
              onClick={() => openLink(PLATFORM_API_KEYS_URL)}
              className="text-xp-blue hover:underline"
            >
              {t('panelActions.openKeySettings')}
            </button>
          </p>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <KeyRound
                size={12}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xp-text-muted"
              />
              <input
                type="password"
                aria-label={t('chatgptBridge.step3Title')}
                className={`${inputClass} pl-7`}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={
                  hasApiKey ? t('chatgptBridge.apiKeyStored') : t('chatgptBridge.apiKeyPlaceholder')
                }
                spellCheck={false}
              />
            </div>
            {hasApiKey && !apiKeyInput && (
              <button
                type="button"
                onClick={() => setDeleteKeyOpen(true)}
                aria-label={t('chatgptBridge.apiKeyDelete')}
                title={t('chatgptBridge.apiKeyDelete')}
                className="shrink-0 p-1.5 text-xp-text-secondary transition-colors hover:text-xp-red"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-xp-text-secondary">
            {t('chatgptBridge.apiKeyNote')}
          </p>
        </Section>

        <Section title={t('chatgptBridge.step4Title')}>
          <p className="mb-2 text-xs leading-relaxed text-xp-text-secondary">
            {t('chatgptBridge.step4Desc')}
          </p>
          {roots.length > 0 && (
            <ul className="mb-2 flex flex-col gap-1" data-testid="bridge-roots">
              {roots.map((root) => (
                <li key={root} className="flex items-center gap-2 py-1.5">
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-xs text-xp-text"
                    title={root}
                  >
                    {root}
                  </span>
                  <button
                    type="button"
                    onClick={() => setRoots((prev) => prev.filter((r) => r !== root))}
                    className="shrink-0 p-1 text-xp-text-secondary transition-colors hover:text-xp-red"
                    aria-label={t('chatgptBridge.removeRoot')}
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={addRoot}
              className="flex items-center gap-1.5 text-xs text-xp-blue hover:underline"
            >
              <FolderPlus size={12} /> {t('chatgptBridge.addRoot')}
            </button>
            {currentPath && !currentPath.includes('://') && !roots.includes(currentPath) && (
              <button
                type="button"
                onClick={addCurrentFolder}
                className="flex min-w-0 items-center gap-1.5 text-xs text-xp-blue hover:underline"
                title={currentPath}
              >
                <Plus size={12} />
                <span className="truncate">{t('chatgptBridge.addCurrentRoot')}</span>
              </button>
            )}
          </div>
        </Section>

        <Section title={t('chatgptBridge.step5Title')}>
          <p className="text-xs leading-relaxed text-xp-text-secondary">
            {t('chatgptBridge.step5Desc')}{' '}
            <button
              type="button"
              onClick={() => openLink(CHATGPT_CONNECTORS_URL)}
              className="text-xp-blue hover:underline"
            >
              {t('chatgptBridge.step5Link')}
            </button>
          </p>
        </Section>

        <button
          type="button"
          onClick={() => save(enabled)}
          disabled={busy || !state}
          className="mx-4 mt-4 flex items-center justify-center gap-2 rounded-[8px] bg-xp-blue px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 size={13} className="animate-spin" />}
          {t('chatgptBridge.save')}
        </button>

        <PanelConfirmation
          open={deleteKeyOpen}
          title={t('chatgptBridge.apiKeyDelete')}
          description={t('panelActions.deleteKeyDescription')}
          confirmLabel={t('chatgptBridge.apiKeyDelete')}
          busy={busy}
          onCancel={() => setDeleteKeyOpen(false)}
          onConfirm={() => {
            setBusy(true);
            void TauriAPI.chatgptBridgeDeleteApiKey()
              .then(() => TauriAPI.chatgptBridgeGetState())
              .then(setState)
              .catch((error) => setFormError(String(error)))
              .finally(() => {
                setBusy(false);
                setDeleteKeyOpen(false);
              });
          }}
        />
        <p className="mx-4 mt-4 text-xs leading-relaxed text-xp-text-secondary">
          {t('chatgptBridge.privacyNote')}
        </p>
      </div>
    </div>
  );
};

export default ChatgptBridgePanel;
