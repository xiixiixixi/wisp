import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  Circle,
  CircleCheck,
  CircleHelp,
  Copy,
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
const CHATGPT_PLUGINS_URL = 'https://chatgpt.com/plugins';

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
  'w-full min-h-9 rounded-[8px] border border-xp-border bg-xp-surface-light px-2.5 py-2 text-xs text-xp-text placeholder:text-xp-text-muted focus:border-xp-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-xp-blue/30';

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
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const applyState = useCallback((next: ChatgptBridgeState) => {
    setState(next);
    setTunnelId(next.config.tunnelId);
    setRoots(next.config.allowedRoots);
    setEnabled(next.config.enabled);
  }, []);

  const initializeState = useCallback(
    (next: ChatgptBridgeState) => {
      applyState(next);
      if (next.config.allowedRoots.length === 0) setStep(1);
      else if (next.config.tunnelId && next.hasApiKey) setStep(3);
      else setStep(2);
    },
    [applyState],
  );

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    const load = async (initialize = false) => {
      try {
        const next = await TauriAPI.chatgptBridgeGetState();
        if (initialize) {
          initializeState(next);
        } else setState(next);
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
  }, [initializeState]);

  const status = state?.status;
  const detected = state?.detectedClientPath;
  const configuredClientPath = state?.config.tunnelClientPath?.trim();
  const clientPath = detected;
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

  const save = async (nextEnabled: boolean): Promise<boolean> => {
    if (!state) return false;
    setFormError(null);
    if (
      nextEnabled &&
      (!tunnelId.trim() || (!hasApiKey && !apiKeyInput.trim()) || roots.length === 0 || !clientPath)
    ) {
      let reason = 'chatgptBridge.keyRequired';
      if (!clientPath) reason = 'chatgptBridge.clientMissing';
      else if (roots.length === 0) reason = 'chatgptBridge.folderRequired';
      else if (!tunnelId.trim()) reason = 'chatgptBridge.tunnelRequired';
      setFormError(t(reason));
      setEnabled(state.config.enabled);
      return false;
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
      return true;
    } catch (err) {
      setFormError(String(err));
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
      return false;
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

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: t('chatgptBridge.toastCopied') });
    } catch (error) {
      setFormError(t('panelActions.copyFailed', { error: String(error) }));
    }
  };

  const useBundledComponent = async () => {
    if (!state) return;
    setBusy(true);
    setFormError(null);
    try {
      const next = await TauriAPI.chatgptBridgeSaveConfig({
        ...state.config,
        enabled: false,
        tunnelClientPath: null,
        tunnelId: tunnelId.trim(),
        allowedRoots: roots,
      });
      applyState(next);
      if (!next.detectedClientPath) setFormError(t('chatgptBridge.clientMissing'));
    } catch (error) {
      setFormError(String(error));
    } finally {
      setBusy(false);
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
                      initializeState(next);
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

  if (!state) {
    return (
      <div className="flex h-full flex-col">
        <BridgeOverview />
        <div
          role="status"
          className="flex items-center gap-2 px-4 py-4 text-xs text-xp-text-secondary"
        >
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          {t('common.loading')}
        </div>
      </div>
    );
  }

  const connectionState =
    status?.state === 'running' && status.ready !== true
      ? 'starting'
      : (status?.state ?? 'stopped');
  const stateLabel = t(`chatgptBridge.state.${connectionState}`);
  const hasDraftChanges = Boolean(
    state &&
    (tunnelId.trim() !== state.config.tunnelId ||
      apiKeyInput.trim() ||
      roots.length !== state.config.allowedRoots.length ||
      roots.some((root, index) => root !== state.config.allowedRoots[index])),
  );
  const canConnect = Boolean(
    state && clientPath && roots.length > 0 && tunnelId.trim() && (hasApiKey || apiKeyInput.trim()),
  );
  const selectStep = (next: 1 | 2 | 3) => {
    setStep(next);
    setFormError(null);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <BridgeOverview statusLabel={stateLabel} statusState={connectionState} />

      <nav
        aria-label={t('chatgptBridge.setupSteps')}
        className="border-b border-xp-border px-4 py-3"
      >
        <ol className="grid grid-cols-3 gap-1">
          {([1, 2, 3] as const).map((number) => (
            <li key={number}>
              <button
                type="button"
                aria-current={step === number ? 'step' : undefined}
                disabled={busy || !state}
                onClick={() => selectStep(number)}
                className={`flex min-h-9 w-full items-center justify-center gap-1.5 rounded-md px-1 text-xs transition-colors disabled:opacity-50 ${
                  step === number
                    ? 'bg-xp-surface-light font-semibold text-xp-text'
                    : 'text-xp-text-secondary hover:text-xp-blue'
                }`}
              >
                <span aria-hidden="true" className="shrink-0 tabular-nums">
                  {number}
                </span>
                <span className="min-w-0">{t(`chatgptBridge.setupStep${number}`)}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex flex-col pb-4">
        <p
          className="mx-4 mt-3 flex items-start gap-1.5 text-xs text-xp-text-secondary"
          title={clientPath || undefined}
        >
          {clientPath ? (
            <CircleCheck size={14} className="mt-0.5 shrink-0 text-xp-green" aria-hidden="true" />
          ) : (
            <CircleAlert size={14} className="mt-0.5 shrink-0 text-xp-red" aria-hidden="true" />
          )}
          {t(clientPath ? 'chatgptBridge.clientReady' : 'chatgptBridge.clientMissing')}
        </p>
        {!clientPath && configuredClientPath && (
          <div className="mx-4 mt-2">
            <Button variant="outline" onClick={useBundledComponent} disabled={busy}>
              <RefreshCw size={14} aria-hidden="true" />
              {t('chatgptBridge.useBundledComponent')}
            </Button>
          </div>
        )}
        {formError && (
          <div className="px-4">
            <PanelMessage error>{formError}</PanelMessage>
          </div>
        )}
        {status?.lastError && (
          <div className="mx-4 mt-3 text-xs leading-relaxed text-xp-red">{status.lastError}</div>
        )}
        {state?.config.enabled && hasDraftChanges && (
          <div className="mx-4 mt-3">
            <PanelMessage>{t('chatgptBridge.unsavedChanges')}</PanelMessage>
            <Button onClick={() => save(roots.length > 0)} disabled={busy} className="mt-2">
              {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {t(roots.length > 0 ? 'chatgptBridge.applyChanges' : 'chatgptBridge.stopSharing')}
            </Button>
          </div>
        )}

        {enabled && (
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
        )}

        {step === 2 && (
          <Section title={t('chatgptBridge.accountTitle')}>
            <p className="mb-2 text-xs leading-relaxed text-xp-text-secondary">
              {t('chatgptBridge.accountNote')}
            </p>
            <label
              className="mb-1.5 block text-xs font-medium text-xp-text"
              htmlFor="bridge-tunnel-id"
            >
              {t('chatgptBridge.step2Title')}
            </label>
            <input
              id="bridge-tunnel-id"
              className={inputClass}
              aria-label={t('chatgptBridge.step2Title')}
              value={tunnelId}
              onChange={(e) => setTunnelId(e.target.value)}
              placeholder="tunnel_0123456789abcdef…"
              spellCheck={false}
              disabled={busy}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openLink(PLATFORM_TUNNELS_URL)}
              className="mt-1 !px-0"
            >
              {t('chatgptBridge.createTunnel')} <ExternalLink size={12} aria-hidden="true" />
            </Button>
            <label
              className="mb-1.5 mt-4 block text-xs font-medium text-xp-text"
              htmlFor="bridge-api-key"
            >
              {t('chatgptBridge.step3Title')}
            </label>
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <KeyRound
                  size={12}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xp-text-muted"
                />
                <input
                  id="bridge-api-key"
                  type="password"
                  aria-label={t('chatgptBridge.step3Title')}
                  className={`${inputClass} pl-7`}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={
                    hasApiKey
                      ? t('chatgptBridge.apiKeyStored')
                      : t('chatgptBridge.apiKeyPlaceholder')
                  }
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy}
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openLink(PLATFORM_API_KEYS_URL)}
              className="mt-1 !px-0"
            >
              {t('chatgptBridge.createKey')} <ExternalLink size={12} aria-hidden="true" />
            </Button>
            <p className="mt-2 text-xs leading-relaxed text-xp-text-secondary">
              {t('chatgptBridge.apiKeyNote')}
            </p>
            <details className="mt-3 text-xs text-xp-text-secondary">
              <summary className="cursor-pointer py-1">
                {t('chatgptBridge.keyPermissionsTitle')}
              </summary>
              <p className="mt-1 leading-relaxed">{t('chatgptBridge.keyPermissions')}</p>
            </details>
            <div className="mt-5 flex items-center justify-between gap-2">
              <Button variant="ghost" onClick={() => selectStep(1)} disabled={busy}>
                <ArrowLeft size={14} aria-hidden="true" />
                {t('chatgptBridge.back')}
              </Button>
              <Button
                onClick={async () => {
                  if (await save(true)) selectStep(3);
                }}
                disabled={busy || !canConnect}
              >
                {busy ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                ) : (
                  <ArrowRight size={14} aria-hidden="true" />
                )}
                {t('chatgptBridge.connect')}
              </Button>
            </div>
          </Section>
        )}

        {step === 1 && (
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
                      title={t('chatgptBridge.removeRoot')}
                      disabled={busy}
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={addRoot} disabled={busy}>
                <FolderPlus size={14} aria-hidden="true" /> {t('chatgptBridge.addRoot')}
              </Button>
              {currentPath && !currentPath.includes('://') && !roots.includes(currentPath) && (
                <Button
                  variant="ghost"
                  onClick={addCurrentFolder}
                  disabled={busy}
                  title={currentPath}
                >
                  <Plus size={14} aria-hidden="true" />
                  <span className="truncate">{t('chatgptBridge.addCurrentRoot')}</span>
                </Button>
              )}
            </div>
            <div className="mt-5 flex justify-end">
              <Button onClick={() => selectStep(2)} disabled={busy || roots.length === 0 || !state}>
                {t('chatgptBridge.next')} <ArrowRight size={14} aria-hidden="true" />
              </Button>
            </div>
          </Section>
        )}

        {step === 3 && (
          <Section title={t('chatgptBridge.step5Title')}>
            <p className="text-xs leading-relaxed text-xp-text-secondary">
              {t('chatgptBridge.step5Desc')}
            </p>
            <div role="group" aria-label={t('chatgptBridge.pluginFormTitle')} className="mt-3">
              <h4 className="text-xs font-medium text-xp-text">
                {t('chatgptBridge.pluginFormTitle')}
              </h4>
              <dl className="mt-1 divide-y divide-xp-border text-xs leading-relaxed">
                {[
                  ['pluginAppTypeLabel', 'pluginAppTypeValue'],
                  ['pluginConnectionTypeLabel', 'pluginConnectionTypeValue'],
                  ['pluginAuthenticationLabel', 'pluginAuthenticationValue'],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] gap-3 py-2"
                  >
                    <dt className="break-words text-xp-text-secondary">
                      {t(`chatgptBridge.${label}`)}
                    </dt>
                    <dd className="min-w-0 break-words font-medium text-xp-text">
                      {t(`chatgptBridge.${value}`)}
                    </dd>
                  </div>
                ))}
                {state?.config.tunnelId && (
                  <div className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] items-center gap-3 py-2">
                    <dt className="break-words text-xp-text-secondary">
                      {t('chatgptBridge.pluginTunnelIdLabel')}
                    </dt>
                    <dd className="flex min-w-0 items-center gap-1">
                      <code className="min-w-0 flex-1 break-all text-xs text-xp-text">
                        {state.config.tunnelId}
                      </code>
                      <Button
                        variant="ghost"
                        className="shrink-0"
                        onClick={() => copyText(state.config.tunnelId)}
                        aria-label={t('chatgptBridge.copyTunnelId')}
                        title={t('chatgptBridge.copyTunnelId')}
                      >
                        <Copy size={14} aria-hidden="true" />
                      </Button>
                    </dd>
                  </div>
                )}
              </dl>
              <p className="mt-2 text-xs leading-relaxed text-xp-text-secondary">
                {t('chatgptBridge.pluginAuthNote')}
              </p>
            </div>
            <Button
              onClick={() => openLink(CHATGPT_PLUGINS_URL)}
              className="mt-3 !h-auto min-h-8 max-w-full !whitespace-normal py-1.5 text-left"
            >
              <ExternalLink size={14} aria-hidden="true" />
              {t('chatgptBridge.step5Link')}
            </Button>
            <p className="mt-2 text-xs leading-relaxed text-xp-text-secondary">
              {t('chatgptBridge.pluginEntryMissing')}
            </p>
            <p className="mt-3 text-xs leading-relaxed text-xp-text-secondary">
              {t('chatgptBridge.connectionCheckNote')}
            </p>
            <Button
              variant="outline"
              onClick={() => copyText(t('chatgptBridge.testPrompt'))}
              disabled={connectionState !== 'running' || hasDraftChanges}
              className="mt-2 !h-auto min-h-8 max-w-full !whitespace-normal py-1.5"
            >
              <Copy size={14} aria-hidden="true" />
              {t('chatgptBridge.copyTestPrompt')}
            </Button>
            {!enabled && (
              <Button
                onClick={() => save(true)}
                disabled={busy || !canConnect}
                className="ml-2 mt-3"
              >
                {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                {t('chatgptBridge.connect')}
              </Button>
            )}
            <div className="mt-4">
              <Button variant="ghost" onClick={() => selectStep(2)} disabled={busy}>
                <ArrowLeft size={14} aria-hidden="true" />
                {t('chatgptBridge.back')}
              </Button>
            </div>
          </Section>
        )}

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
