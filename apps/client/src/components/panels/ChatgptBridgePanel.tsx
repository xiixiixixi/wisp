import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  CircleAlert,
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

const Section = ({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
}) => (
  <section className="rounded-[10px] border border-xp-border bg-xp-surface px-3 py-2.5">
    <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-xp-text">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-xp-blue/15 text-[10px] font-semibold text-xp-blue">
        {step}
      </span>
      {title}
    </h3>
    {children}
  </section>
);

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

  const applyState = useCallback((next: ChatgptBridgeState) => {
    setState(next);
    setTunnelId(next.config.tunnelId);
    setRoots(next.config.allowedRoots);
    setEnabled(next.config.enabled);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const load = async () => {
      try {
        applyState(await TauriAPI.chatgptBridgeGetState());
        setLoadError(null);
      } catch (err) {
        // Web demo / shim: surface once instead of an empty panel.
        setLoadError((err as Error).message);
      }
    };
    load();
    if (isTauri()) {
      TauriAPI.listenToChatgptBridgeStatus(() => {
        // Status events only change status fields; refresh the snapshot.
        load();
      })
        .then((un) => {
          unlisten = un;
        })
        .catch(() => undefined);
    }
    return () => unlisten?.();
  }, [applyState]);

  const status = state?.status;
  const detected = state?.detectedClientPath;
  const hasApiKey = state?.hasApiKey ?? false;

  const addRoot = async () => {
    try {
      const result = await TauriAPI.showOpenDialog({ directory: true, multiple: false });
      const dir = result?.[0];
      if (dir && !roots.includes(dir)) setRoots((prev) => [...prev, dir]);
    } catch {
      /* user cancelled */
    }
  };

  const addCurrentFolder = () => {
    if (currentPath && !roots.includes(currentPath)) {
      setRoots((prev) => [...prev, currentPath]);
    }
  };

  const save = async (nextEnabled: boolean) => {
    if (!state) return;
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
        applyState(await TauriAPI.chatgptBridgeGetState());
      } catch {
        /* keep local state */
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
    } catch {
      /* already stopped */
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
    } catch {
      /* clipboard denied */
    }
  };

  if (loadError && !state) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <CircleAlert size={20} className="text-xp-text-muted" />
        <p className="text-xs text-xp-text-muted">{t('chatgptBridge.loadError')}</p>
      </div>
    );
  }

  const stateLabel = t(`chatgptBridge.state.${status?.state ?? 'stopped'}`);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex items-center gap-2.5 px-3 pb-2 pt-3">
        <span className="bg-xp-blue/12 flex h-7 w-7 items-center justify-center rounded-[8px] text-xp-blue">
          <Bot size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold leading-tight text-xp-text">
            {t('chatgptBridge.title')}
          </h2>
          <p className="truncate text-[11px] leading-tight text-xp-text-muted">
            {t('chatgptBridge.subtitle')}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-xp-border bg-xp-surface px-2 py-1 text-[11px] text-xp-text-secondary">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status?.state === 'starting' ? 'animate-pulse' : ''
            }${stateDotClass(status?.state ?? 'stopped')}`}
            aria-hidden="true"
          />
          {stateLabel}
        </span>
      </header>

      <div className="flex flex-col gap-2 px-3 pb-4">
        {status?.lastError && (
          <div className="rounded-[10px] border border-xp-red/30 bg-[var(--xp-wash-red)] px-3 py-2 text-[11px] leading-relaxed text-xp-red">
            {status.lastError}
          </div>
        )}

        {/* master switch + runtime controls */}
        <section className="rounded-[10px] border border-xp-border bg-xp-surface px-3 py-2.5">
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
              aria-checked={enabled}
              disabled={busy}
              onClick={() => {
                const next = !enabled;
                setEnabled(next);
                save(next);
              }}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                enabled ? 'bg-xp-blue' : 'bg-xp-border'
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${
                  enabled ? 'left-[18px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
          {enabled && (
            <div className="mt-2 flex items-center gap-2 border-t border-xp-border pt-2">
              <button
                type="button"
                onClick={restart}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-[8px] border border-xp-border px-2.5 py-1.5 text-[11px] text-xp-text transition-colors hover:bg-xp-surface-light disabled:opacity-50"
              >
                <RefreshCw size={12} /> {t('chatgptBridge.restart')}
              </button>
              <button
                type="button"
                onClick={stop}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-[8px] border border-xp-border px-2.5 py-1.5 text-[11px] text-xp-text transition-colors hover:bg-xp-surface-light disabled:opacity-50"
              >
                <StopCircle size={12} /> {t('chatgptBridge.stop')}
              </button>
              {status?.healthUrl && (
                <button
                  type="button"
                  onClick={() => openLink(`${status.healthUrl}/ui`)}
                  className="ml-auto flex items-center gap-1 text-[11px] text-xp-blue hover:underline"
                >
                  {t('chatgptBridge.openAdminUi')} <ExternalLink size={11} />
                </button>
              )}
            </div>
          )}
        </section>

        <Section step={1} title={t('chatgptBridge.step1Title')}>
          <p className="mb-2 text-[11px] leading-relaxed text-xp-text-muted">
            {t('chatgptBridge.step1Desc')}
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-[8px] bg-xp-surface-light px-2.5 py-1.5 font-mono text-[11px] text-xp-text">
              {BREW_INSTALL_CMD}
            </code>
            <button
              type="button"
              onClick={copyBrew}
              className="shrink-0 rounded-[8px] border border-xp-border px-2.5 py-1.5 text-[11px] text-xp-text transition-colors hover:bg-xp-surface-light"
            >
              {t('chatgptBridge.copy')}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-xp-text-muted">
            {detected
              ? t('chatgptBridge.clientDetected', { path: detected })
              : t('chatgptBridge.clientMissing')}
          </p>
        </Section>

        <Section step={2} title={t('chatgptBridge.step2Title')}>
          <p className="mb-2 text-[11px] leading-relaxed text-xp-text-muted">
            {t('chatgptBridge.step2Desc')}{' '}
            <button
              type="button"
              onClick={() => openLink(PLATFORM_TUNNELS_URL)}
              className="text-xp-blue hover:underline"
            >
              platform.openai.com → Tunnels
            </button>
          </p>
          <input
            className={inputClass}
            value={tunnelId}
            onChange={(e) => setTunnelId(e.target.value)}
            placeholder="tunnel_0123456789abcdef…"
            spellCheck={false}
          />
        </Section>

        <Section step={3} title={t('chatgptBridge.step3Title')}>
          <p className="mb-2 text-[11px] leading-relaxed text-xp-text-muted">
            {t('chatgptBridge.step3Desc')}{' '}
            <button
              type="button"
              onClick={() => openLink(PLATFORM_API_KEYS_URL)}
              className="text-xp-blue hover:underline"
            >
              Runtime API keys
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
                onClick={async () => {
                  try {
                    await TauriAPI.chatgptBridgeDeleteApiKey();
                    applyState(await TauriAPI.chatgptBridgeGetState());
                  } catch {
                    /* keychain unavailable */
                  }
                }}
                title={t('chatgptBridge.apiKeyDelete')}
                className="shrink-0 rounded-[8px] border border-xp-border p-1.5 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-red"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
          <p className="mt-2 text-[11px] text-xp-text-muted">{t('chatgptBridge.apiKeyNote')}</p>
        </Section>

        <Section step={4} title={t('chatgptBridge.step4Title')}>
          <p className="mb-2 text-[11px] leading-relaxed text-xp-text-muted">
            {t('chatgptBridge.step4Desc')}
          </p>
          {roots.length > 0 && (
            <ul className="mb-2 flex flex-col gap-1" data-testid="bridge-roots">
              {roots.map((root) => (
                <li
                  key={root}
                  className="flex items-center gap-2 rounded-[8px] bg-xp-surface-light px-2.5 py-1.5"
                >
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-[11px] text-xp-text"
                    title={root}
                  >
                    {root}
                  </span>
                  <button
                    type="button"
                    onClick={() => setRoots((prev) => prev.filter((r) => r !== root))}
                    className="shrink-0 text-xp-text-muted transition-colors hover:text-xp-red"
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
              className="flex items-center gap-1.5 rounded-[8px] border border-xp-border px-2.5 py-1.5 text-[11px] text-xp-text transition-colors hover:bg-xp-surface-light"
            >
              <FolderPlus size={12} /> {t('chatgptBridge.addRoot')}
            </button>
            {currentPath && !roots.includes(currentPath) && (
              <button
                type="button"
                onClick={addCurrentFolder}
                className="flex min-w-0 items-center gap-1.5 rounded-[8px] border border-xp-border px-2.5 py-1.5 text-[11px] text-xp-text transition-colors hover:bg-xp-surface-light"
                title={currentPath}
              >
                <Plus size={12} />
                <span className="truncate">{t('chatgptBridge.addCurrentRoot')}</span>
              </button>
            )}
          </div>
        </Section>

        <Section step={5} title={t('chatgptBridge.step5Title')}>
          <p className="text-[11px] leading-relaxed text-xp-text-muted">
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
          className="flex items-center justify-center gap-2 rounded-[10px] bg-xp-blue px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 size={13} className="animate-spin" />}
          {t('chatgptBridge.save')}
        </button>

        <p className="rounded-[10px] bg-[var(--xp-wash-yellow)] px-3 py-2 text-[11px] leading-relaxed text-xp-text-secondary">
          {t('chatgptBridge.privacyNote')}
        </p>
      </div>
    </div>
  );
};

export default ChatgptBridgePanel;
