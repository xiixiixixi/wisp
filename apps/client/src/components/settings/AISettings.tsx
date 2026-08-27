import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  Shield,
  Key,
  Cpu,
  Eye,
  EyeOff,
  SlidersHorizontal,
  Brain,
  RotateCcw,
  Cloud,
  Settings2,
  Globe,
  Workflow,
  Zap,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from '@/components/ui/select';
import { type SafeAgentSettings } from '@/lib/agent-service';
import { Toggle, SettingRow, SectionTitle, Divider, type AppSettings } from './shared';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import ExternalAgentsCard, { type ExternalAgentStatus } from './ExternalAgentsCard';
import { TauriAPI } from '@/lib/tauri-api';
import { isTauri } from '@/lib/transport';

/** One-tap presets for common OpenAI-compatible services (base URLs follow
 *  the same convention as ZCode's provider configuration). */
const OPENAI_COMPATIBLE_PRESETS = [
  {
    id: 'minimax',
    label: 'MiniMax',
    endpoint: 'https://api.minimaxi.com/v1',
    model: 'MiniMax-Text-01',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.6',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    endpoint: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2-0711-preview',
  },
];

interface AISettingsProps {
  agentSettings: SafeAgentSettings;
  updateAgentSetting: <K extends keyof SafeAgentSettings>(
    key: K,
    value: SafeAgentSettings[K],
  ) => void;
  setAgentSettings: (s: SafeAgentSettings) => void;
  apiKeyInput: string;
  setApiKeyInput: (v: string) => void;
  openaiKeyInput: string;
  setOpenaiKeyInput: (v: string) => void;
  settings: AppSettings;
  updateSetting: (key: string, value: string | boolean | number) => void;
}

const AISettings = ({
  agentSettings,
  updateAgentSetting,
  setAgentSettings,
  apiKeyInput,
  setApiKeyInput,
  openaiKeyInput,
  setOpenaiKeyInput,
  settings,
  updateSetting,
}: AISettingsProps) => {
  const { t } = useTranslation();
  const [showApiKey, setShowApiKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);

  // ── 外部 Agent 检测（推荐车道，零配置）──────────────────────────
  const [builtInExpanded, setBuiltInExpanded] = useState(false);
  const [cliInstalled, setCliInstalled] = useState<Record<string, boolean>>({});
  const [copiedInstall, setCopiedInstall] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    TauriAPI.checkCliInstalled(['claude', 'gemini', 'opencode', 'codex'])
      .then(setCliInstalled)
      .catch(() => {
        /* detection unavailable — statuses stay unknown */
      });
  }, []);

  const externalAgents: ExternalAgentStatus[] = [
    {
      command: 'claude',
      label: 'Claude Code',
      installed: cliInstalled['claude'],
      installCmd: 'npm install -g @anthropic-ai/claude-code',
    },
    {
      command: 'gemini',
      label: 'Gemini CLI',
      installed: cliInstalled['gemini'],
      installCmd: 'npm install -g @google/gemini-cli',
    },
    {
      command: 'opencode',
      label: 'OpenCode',
      installed: cliInstalled['opencode'],
      installCmd: 'curl -fsSL https://opencode.ai/install | bash',
    },
    {
      command: 'codex',
      label: 'Codex CLI',
      installed: cliInstalled['codex'],
      installCmd: 'npm install -g @openai/codex',
    },
  ];

  const handleCopyInstall = (installCmd: string) => {
    navigator.clipboard.writeText(installCmd).catch(() => {});
    setCopiedInstall(installCmd);
    setTimeout(() => setCopiedInstall(null), 2000);
  };

  const isNonAnthropicModel =
    agentSettings.model.startsWith('gpt-') ||
    agentSettings.model.startsWith('o1') ||
    agentSettings.model.startsWith('o3') ||
    agentSettings.model.startsWith('o4') ||
    agentSettings.model.startsWith('chatgpt-') ||
    agentSettings.model.startsWith('gemini-') ||
    agentSettings.model.startsWith('deepseek-') ||
    agentSettings.model.startsWith('mistral-') ||
    agentSettings.model.startsWith('codestral');

  const resolveThirdPartyKeyInfo = (): { label: string; desc: string } => {
    if (agentSettings.model.startsWith('gemini-')) {
      return { label: t('settings.ai.googleApiKey'), desc: t('settings.ai.googleApiKeyDesc') };
    }
    if (agentSettings.model.startsWith('deepseek-')) {
      return { label: t('settings.ai.deepseekApiKey'), desc: t('settings.ai.deepseekApiKeyDesc') };
    }
    if (agentSettings.model.startsWith('mistral-') || agentSettings.model.startsWith('codestral')) {
      return { label: t('settings.ai.mistralApiKey'), desc: t('settings.ai.mistralApiKeyDesc') };
    }
    return { label: t('settings.ai.openaiApiKey'), desc: t('settings.ai.openaiApiKeyDesc') };
  };
  const { label: thirdPartyKeyLabel, desc: thirdPartyKeyDesc } = resolveThirdPartyKeyInfo();

  const searchModelPlaceholderMap: Record<string, string> = {
    claude: 'claude-haiku-4-5-20251001',
    openai: 'gpt-4o-mini',
    ollama: 'llama3',
    openrouter: 'anthropic/claude-sonnet-4',
  };
  const searchModelPlaceholder =
    searchModelPlaceholderMap[settings.aiSearchProvider] || t('settings.ai.searchModelPlaceholder');

  return (
    <div className="space-y-1">
      {/* ── 外部 Agent（推荐，零配置）────────────────────────────── */}
      <ExternalAgentsCard
        title={t('settings.ai.externalTitle')}
        description={t('settings.ai.externalDesc')}
        agents={externalAgents}
        copiedLabel={t('settings.ai.externalCopied')}
        copyLabel={t('agentManager.newAgent.copyInstall')}
        copiedCommand={copiedInstall}
        onCopy={handleCopyInstall}
      />

      {/* ── 内置 AI（可选，默认折叠）────────────────────────────── */}
      <button
        type="button"
        onClick={() => setBuiltInExpanded((v) => !v)}
        aria-expanded={builtInExpanded}
        data-testid="builtin-ai-toggle"
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text"
      >
        {builtInExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="font-medium">{t('settings.ai.builtInTitle')}</span>
        <span className="text-xs text-xp-text-muted">{t('settings.ai.builtInDesc')}</span>
      </button>

      {builtInExpanded && (
        <div className="space-y-1">
          <SectionTitle title={t('settings.ai.agent')} />
          <SettingRow
            icon={Bot}
            label={t('settings.ai.enableAgent')}
            description={t('settings.ai.enableAgentDesc')}
          >
            <Toggle
              id="agentEnabled"
              label={t('settings.ai.enableAgent')}
              checked={agentSettings.enabled}
              onChange={(v) => updateAgentSetting('enabled', v)}
            />
          </SettingRow>
          <SettingRow
            icon={Shield}
            label={t('settings.ai.autoApprove')}
            description={
              agentSettings.auto_approve
                ? t('settings.ai.autoApproveDescOn')
                : t('settings.ai.autoApproveDescOff')
            }
          >
            <Toggle
              id="autoApprove"
              label={t('settings.ai.autoApproveToggle')}
              checked={agentSettings.auto_approve}
              onChange={(v) => updateAgentSetting('auto_approve', v)}
            />
          </SettingRow>

          <Divider />
          <SectionTitle title={t('settings.ai.configuration')} />

          {/* AI Service Mode — the dead "Wisp 云（免费）" cloud option was
          removed; its backend only read an OPENROUTER_API_KEY env var that
          no UI could ever set. Legacy profiles migrate to custom on load. */}
          <SettingRow
            icon={Cloud}
            label={t('settings.ai.serviceMode')}
            description={t('settings.ai.serviceModeDesc')}
          >
            <Select value="custom" onValueChange={(v) => updateSetting('aiServiceMode', v)}>
              <SelectTrigger className="h-9 min-w-[180px]" aria-label="AI Service Mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">{t('settings.ai.customMode')}</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>

          {/* ── Custom Provider mode ── */}
          {settings.aiServiceMode === 'custom' && (
            <>
              {/* Custom provider picker */}
              <SettingRow
                icon={Settings2}
                label={t('settings.ai.customProvider')}
                description={t('settings.ai.customProviderDesc')}
              >
                <Select
                  value={settings.aiCustomProvider || 'ollama'}
                  onValueChange={(v) => updateSetting('aiCustomProvider', v)}
                >
                  <SelectTrigger className="h-9 min-w-[160px]" aria-label="Custom AI Provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ollama">{t('settings.ai.providerOllama')}</SelectItem>
                    <SelectItem value="claude">{t('settings.ai.providerClaude')}</SelectItem>
                    <SelectItem value="openai">{t('settings.ai.providerOpenAI')}</SelectItem>
                    <SelectItem value="openrouter">
                      {t('settings.ai.providerOpenRouter')}
                    </SelectItem>
                    <SelectItem value="openai-compatible">
                      {t('settings.ai.providerOpenaiCompatible')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>

              {/* Custom endpoint + protocol — only for the OpenAI-compatible provider */}
              {settings.aiCustomProvider === 'openai-compatible' && (
                <>
                  {/* One-tap presets for common OpenAI-compatible services */}
                  <div className="hover:bg-xp-surface-light/50 rounded-lg px-4 py-3 transition-colors">
                    <div className="mb-2 flex items-center gap-3">
                      <Zap size={18} className="shrink-0 text-xp-text-secondary" />
                      <div className="text-xs text-xp-text-secondary">
                        {t('settings.ai.presetsLabel')}
                      </div>
                    </div>
                    <div className="ml-[30px] flex flex-wrap gap-2">
                      {OPENAI_COMPATIBLE_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            updateSetting('aiCustomProtocol', 'openai');
                            updateSetting('aiCustomEndpoint', preset.endpoint);
                            updateSetting('aiCustomModel', preset.model);
                          }}
                          className="rounded-full border border-xp-border bg-xp-surface px-3 py-1 text-xs text-xp-text transition-colors hover:border-xp-accent"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="hover:bg-xp-surface-light/50 rounded-lg px-4 py-3 transition-colors">
                    <div className="mb-2 flex items-center gap-3">
                      <Workflow size={18} className="shrink-0 text-xp-text-secondary" />
                      <div>
                        <div className="text-sm font-medium text-xp-text">
                          {t('settings.ai.customProtocolLabel')}
                        </div>
                        <div className="mt-0.5 text-xs text-xp-text-secondary">
                          {t('settings.ai.customProtocolDesc')}
                        </div>
                      </div>
                    </div>
                    <div className="ml-[30px]">
                      <Select
                        value={settings.aiCustomProtocol || 'openai'}
                        onValueChange={(v) => updateSetting('aiCustomProtocol', v)}
                      >
                        <SelectTrigger className="h-9 w-full" aria-label="Custom endpoint protocol">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="openai">{t('settings.ai.protocolOpenai')}</SelectItem>
                          <SelectItem value="anthropic">
                            {t('settings.ai.protocolAnthropic')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="hover:bg-xp-surface-light/50 rounded-lg px-4 py-3 transition-colors">
                    <div className="mb-2 flex items-center gap-3">
                      <Globe size={18} className="shrink-0 text-xp-text-secondary" />
                      <div>
                        <div className="text-sm font-medium text-xp-text">
                          {t('settings.ai.customEndpointLabel')}
                        </div>
                        <div className="mt-0.5 text-xs text-xp-text-secondary">
                          {t('settings.ai.customEndpointDesc')}
                        </div>
                      </div>
                    </div>
                    <div className="ml-[30px]">
                      <input
                        type="text"
                        value={settings.aiCustomEndpoint || ''}
                        onChange={(e) => updateSetting('aiCustomEndpoint', e.target.value)}
                        placeholder={
                          settings.aiCustomProtocol === 'anthropic'
                            ? 'https://api.minimaxi.com/anthropic'
                            : 'https://api.minimaxi.com/v1'
                        }
                        className="h-9 w-full rounded-md border border-xp-border bg-xp-bg px-3 font-mono text-sm text-xp-text transition-colors hover:border-xp-text-secondary focus:border-xp-accent focus:outline-none focus:ring-1 focus:ring-xp-accent"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Custom model text input */}
              <div className="hover:bg-xp-surface-light/50 rounded-lg px-4 py-3 transition-colors">
                <div className="mb-2 flex items-center gap-3">
                  <Brain size={18} className="shrink-0 text-xp-text-secondary" />
                  <div>
                    <div className="text-sm font-medium text-xp-text">
                      {t('settings.ai.customModel')}
                    </div>
                    <div className="mt-0.5 text-xs text-xp-text-secondary">
                      {t('settings.ai.customModelDesc')}
                    </div>
                  </div>
                </div>
                <div className="ml-[30px]">
                  <input
                    type="text"
                    value={settings.aiCustomModel || ''}
                    onChange={(e) => updateSetting('aiCustomModel', e.target.value)}
                    placeholder={
                      (
                        {
                          openrouter: 'anthropic/claude-sonnet-4',
                          claude: 'claude-sonnet-4-6',
                          openai: 'gpt-4o',
                          ollama: 'llama3',
                          'openai-compatible': 'MiniMax-Text-01',
                        } as Record<string, string>
                      )[settings.aiCustomProvider] || 'llama3'
                    }
                    className="h-9 w-full rounded-md border border-xp-border bg-xp-bg px-3 font-mono text-sm text-xp-text transition-colors hover:border-xp-text-secondary focus:border-xp-accent focus:outline-none focus:ring-1 focus:ring-xp-accent"
                  />
                </div>
              </div>

              {/* Custom API key — not shown for Ollama */}
              {settings.aiCustomProvider !== 'ollama' && (
                <div className="hover:bg-xp-surface-light/50 rounded-lg px-4 py-3 transition-colors">
                  <div className="mb-2 flex items-center gap-3">
                    <Key size={18} className="shrink-0 text-xp-text-secondary" />
                    <div>
                      <div className="text-sm font-medium text-xp-text">
                        {t('settings.ai.customApiKey')}
                      </div>
                      <div className="mt-0.5 text-xs text-xp-text-secondary">
                        {t('settings.ai.customApiKeyDesc')}
                      </div>
                    </div>
                  </div>
                  <div className="relative ml-[30px]">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={settings.aiCustomApiKey || ''}
                      onChange={(e) => updateSetting('aiCustomApiKey', e.target.value)}
                      placeholder={
                        (
                          {
                            openrouter: 'sk-or-...',
                            claude: 'sk-ant-...',
                          } as Record<string, string>
                        )[settings.aiCustomProvider] || 'sk-...'
                      }
                      className="h-9 w-full rounded-md border border-xp-border bg-xp-bg px-3 pr-16 font-mono text-sm text-xp-text transition-colors hover:border-xp-text-secondary focus:border-xp-accent focus:outline-none focus:ring-1 focus:ring-xp-accent"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded px-2 py-1 text-xs text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text"
                    >
                      {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      {showApiKey ? t('settings.ai.hideKey') : t('settings.ai.showKey')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          <Divider />
          <SectionTitle title={t('settings.ai.agentAdvanced')} />

          {/* Anthropic API Key */}
          <div className="hover:bg-xp-surface-light/50 rounded-lg px-4 py-3 transition-colors">
            <div className="mb-2 flex items-center gap-3">
              <Key size={18} className="shrink-0 text-xp-text-secondary" />
              <div>
                <div className="text-sm font-medium text-xp-text">{t('settings.ai.apiKey')}</div>
                <div className="mt-0.5 text-xs text-xp-text-secondary">
                  {t('settings.ai.apiKeyDesc')}
                </div>
              </div>
            </div>
            <div className="relative ml-[30px]">
              <input
                id="apiKey"
                type={showApiKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={
                  agentSettings.has_api_key
                    ? `••••••••  (${t('settings.ai.keyIsSet')})`
                    : 'sk-ant-...'
                }
                className="h-9 w-full rounded-md border border-xp-border bg-xp-bg px-3 pr-16 font-mono text-sm text-xp-text transition-colors hover:border-xp-text-secondary focus:border-xp-accent focus:outline-none focus:ring-1 focus:ring-xp-accent"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded px-2 py-1 text-xs text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text"
              >
                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                {showApiKey ? t('settings.ai.hideKey') : t('settings.ai.showKey')}
              </button>
            </div>
          </div>

          <SettingRow
            icon={Cpu}
            label={t('settings.ai.model')}
            description={t('settings.ai.modelDesc')}
          >
            <Select
              value={agentSettings.model}
              onValueChange={(v) => updateAgentSetting('model', v)}
            >
              <SelectTrigger className="h-9 min-w-[180px]" aria-label="AI Model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{t('settings.ai.modelGroupAnthropic')}</SelectLabel>
                  <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6</SelectItem>
                  <SelectItem value="claude-opus-4-6">Claude Opus 4.6</SelectItem>
                  <SelectItem value="claude-haiku-4-5-20251001">Claude Haiku 4.5</SelectItem>
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>{t('settings.ai.modelGroupOpenAI')}</SelectLabel>
                  <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                  <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                  <SelectItem value="gpt-4.1">GPT-4.1</SelectItem>
                  <SelectItem value="gpt-4.1-mini">GPT-4.1 Mini</SelectItem>
                  <SelectItem value="gpt-4.1-nano">GPT-4.1 Nano</SelectItem>
                  <SelectItem value="o3-mini">o3-mini</SelectItem>
                  <SelectItem value="o4-mini">o4-mini</SelectItem>
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>{t('settings.ai.modelGroupGoogle')}</SelectLabel>
                  <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                  <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                  <SelectItem value="gemini-2.0-flash">Gemini 2.0 Flash</SelectItem>
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>{t('settings.ai.modelGroupDeepSeek')}</SelectLabel>
                  <SelectItem value="deepseek-chat">DeepSeek V3</SelectItem>
                  <SelectItem value="deepseek-reasoner">DeepSeek R1</SelectItem>
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>{t('settings.ai.modelGroupMetaOllama')}</SelectLabel>
                  <SelectItem value="llama3.3">Llama 3.3 70B</SelectItem>
                  <SelectItem value="llama3.1">Llama 3.1 8B</SelectItem>
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>{t('settings.ai.modelGroupMistral')}</SelectLabel>
                  <SelectItem value="mistral-large-latest">Mistral Large</SelectItem>
                  <SelectItem value="mistral-small-latest">Mistral Small</SelectItem>
                  <SelectItem value="codestral-latest">Codestral</SelectItem>
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>{t('settings.ai.modelGroupLocalOllama')}</SelectLabel>
                  <SelectItem value="ollama:custom">Custom Ollama Model</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </SettingRow>

          {/* Third-party API Key — shows when a non-Anthropic model is selected */}
          {isNonAnthropicModel && (
            <div className="hover:bg-xp-surface-light/50 rounded-lg px-4 py-3 transition-colors">
              <div className="mb-2 flex items-center gap-3">
                <Key size={18} className="shrink-0 text-xp-text-secondary" />
                <div>
                  <div className="text-sm font-medium text-xp-text">{thirdPartyKeyLabel}</div>
                  <div className="mt-0.5 text-xs text-xp-text-secondary">{thirdPartyKeyDesc}</div>
                </div>
              </div>
              <div className="relative ml-[30px]">
                <input
                  type={showOpenaiKey ? 'text' : 'password'}
                  value={openaiKeyInput}
                  onChange={(e) => setOpenaiKeyInput(e.target.value)}
                  placeholder={
                    agentSettings.has_openai_api_key
                      ? `••••••••  (${t('settings.ai.keyIsSet')})`
                      : 'sk-...'
                  }
                  className="h-9 w-full rounded-md border border-xp-border bg-xp-bg px-3 pr-16 font-mono text-sm text-xp-text transition-colors hover:border-xp-text-secondary focus:border-xp-accent focus:outline-none focus:ring-1 focus:ring-xp-accent"
                />
                <button
                  type="button"
                  onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                  className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded px-2 py-1 text-xs text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text"
                >
                  {showOpenaiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  {showOpenaiKey ? t('settings.ai.hideKey') : t('settings.ai.showKey')}
                </button>
              </div>
            </div>
          )}

          <Divider />
          <SectionTitle title={t('settings.ai.aiSearch')} />

          {/* AI Search Provider */}
          <SettingRow
            icon={Cpu}
            label={t('settings.ai.searchProvider')}
            description={t('settings.ai.searchProviderDesc')}
          >
            <Select
              value={settings.aiSearchProvider || 'auto'}
              onValueChange={(v) => updateSetting('aiSearchProvider', v)}
            >
              <SelectTrigger className="h-9 min-w-[160px]" aria-label="AI Search Provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t('settings.ai.providerAuto')}</SelectItem>
                <SelectItem value="ollama">{t('settings.ai.providerOllama')}</SelectItem>
                <SelectItem value="claude">{t('settings.ai.providerClaude')}</SelectItem>
                <SelectItem value="openai">{t('settings.ai.providerOpenAI')}</SelectItem>
                <SelectItem value="openrouter">{t('settings.ai.providerOpenRouter')}</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>

          {/* AI Search Model */}
          <div className="hover:bg-xp-surface-light/50 rounded-lg px-4 py-3 transition-colors">
            <div className="mb-2 flex items-center gap-3">
              <Brain size={18} className="shrink-0 text-xp-text-secondary" />
              <div>
                <div className="text-sm font-medium text-xp-text">
                  {t('settings.ai.searchModel')}
                </div>
                <div className="mt-0.5 text-xs text-xp-text-secondary">
                  {t('settings.ai.searchModelDesc')}
                </div>
              </div>
            </div>
            <div className="ml-[30px]">
              <input
                type="text"
                value={settings.aiSearchModel || ''}
                onChange={(e) => updateSetting('aiSearchModel', e.target.value)}
                placeholder={searchModelPlaceholder}
                className="h-9 w-full rounded-md border border-xp-border bg-xp-bg px-3 font-mono text-sm text-xp-text transition-colors hover:border-xp-text-secondary focus:border-xp-accent focus:outline-none focus:ring-1 focus:ring-xp-accent"
              />
            </div>
          </div>

          {/* AI Search API Key (for Claude/OpenAI) */}
          {settings.aiSearchProvider !== 'auto' && settings.aiSearchProvider !== 'ollama' && (
            <div className="hover:bg-xp-surface-light/50 rounded-lg px-4 py-3 transition-colors">
              <div className="mb-2 flex items-center gap-3">
                <Key size={18} className="shrink-0 text-xp-text-secondary" />
                <div>
                  <div className="text-sm font-medium text-xp-text">
                    {t('settings.ai.searchApiKey')}
                  </div>
                  <div className="mt-0.5 text-xs text-xp-text-secondary">
                    {t('settings.ai.searchApiKeyDesc')}
                  </div>
                </div>
              </div>
              <div className="ml-[30px]">
                <input
                  type="password"
                  value={settings.aiSearchApiKey || ''}
                  onChange={(e) => updateSetting('aiSearchApiKey', e.target.value)}
                  placeholder={
                    ({ claude: 'sk-ant-...', openrouter: 'sk-or-...' } as Record<string, string>)[
                      settings.aiSearchProvider
                    ] || 'sk-...'
                  }
                  className="h-9 w-full rounded-md border border-xp-border bg-xp-bg px-3 font-mono text-sm text-xp-text transition-colors hover:border-xp-text-secondary focus:border-xp-accent focus:outline-none focus:ring-1 focus:ring-xp-accent"
                />
              </div>
            </div>
          )}

          {/* Ollama URL */}
          <div className="hover:bg-xp-surface-light/50 rounded-lg px-4 py-3 transition-colors">
            <div className="mb-2 flex items-center gap-3">
              <Cpu size={18} className="shrink-0 text-xp-text-secondary" />
              <div>
                <div className="text-sm font-medium text-xp-text">
                  {t('settings.ai.ollamaEndpoint')}
                </div>
                <div className="mt-0.5 text-xs text-xp-text-secondary">
                  {t('settings.ai.ollamaEndpointDesc')}
                </div>
              </div>
            </div>
            <div className="ml-[30px]">
              <input
                type="text"
                defaultValue={
                  localStorage.getItem(STORAGE_KEYS.OLLAMA_URL) || 'http://localhost:11434'
                }
                onChange={(e) => localStorage.setItem(STORAGE_KEYS.OLLAMA_URL, e.target.value)}
                placeholder="http://localhost:11434"
                className="h-9 w-full rounded-md border border-xp-border bg-xp-bg px-3 font-mono text-sm text-xp-text transition-colors hover:border-xp-text-secondary focus:border-xp-accent focus:outline-none focus:ring-1 focus:ring-xp-accent"
              />
            </div>
          </div>

          <Divider />
          <SectionTitle title={t('settings.ai.agentSection')} />

          {/* Max Turns */}
          <div className="hover:bg-xp-surface-light/50 rounded-lg px-4 py-3 transition-colors">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <SlidersHorizontal size={18} className="shrink-0 text-xp-text-secondary" />
                <div>
                  <div className="text-sm font-medium text-xp-text">
                    {t('settings.ai.maxTurns')}
                  </div>
                  <div className="mt-0.5 text-xs text-xp-text-secondary">
                    {t('settings.ai.maxTurnsDesc')}
                  </div>
                </div>
              </div>
              <span className="text-sm font-medium tabular-nums text-xp-accent">
                {agentSettings.max_turns}
              </span>
            </div>
            <div className="ml-[30px] mt-2">
              <input
                id="maxTurns"
                type="range"
                min={5}
                max={50}
                value={agentSettings.max_turns}
                onChange={(e) => updateAgentSetting('max_turns', Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-xp-border accent-xp-accent [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-xp-accent [&::-webkit-slider-thumb]:shadow-md"
              />
              <div className="text-xp-text-secondary/60 mt-1 flex justify-between text-[10px]">
                <span>5</span>
                <span>50</span>
              </div>
            </div>
          </div>

          {/* Extended Thinking */}
          <SettingRow
            icon={Brain}
            label={t('settings.ai.extendedThinking')}
            description={t('settings.ai.extendedThinkingDesc')}
          >
            <Toggle
              id="thinkingEnabled"
              label={t('settings.ai.extendedThinking')}
              checked={agentSettings.thinking_enabled}
              onChange={(v) => updateAgentSetting('thinking_enabled', v)}
            />
          </SettingRow>

          {/* Thinking Budget — conditional */}
          {agentSettings.thinking_enabled && (
            <div className="hover:bg-xp-surface-light/50 rounded-lg px-4 py-3 transition-colors">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <SlidersHorizontal size={18} className="shrink-0 text-xp-text-secondary" />
                  <div>
                    <div className="text-sm font-medium text-xp-text">
                      {t('settings.ai.thinkingBudget')}
                    </div>
                    <div className="mt-0.5 text-xs text-xp-text-secondary">
                      {t('settings.ai.thinkingBudgetDesc')}
                    </div>
                  </div>
                </div>
                <span className="text-sm font-medium tabular-nums text-xp-accent">
                  {agentSettings.thinking_budget.toLocaleString()}
                </span>
              </div>
              <div className="ml-[30px] mt-2">
                <input
                  type="range"
                  min={5000}
                  max={50000}
                  step={5000}
                  value={agentSettings.thinking_budget}
                  onChange={(e) => updateAgentSetting('thinking_budget', Number(e.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-xp-border accent-xp-accent [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-xp-accent [&::-webkit-slider-thumb]:shadow-md"
                />
                <div className="text-xp-text-secondary/60 mt-1 flex justify-between text-[10px]">
                  <span>5K</span>
                  <span>50K</span>
                </div>
              </div>
            </div>
          )}

          <Divider />
          <div className="px-4 pt-2">
            <button
              onClick={() => {
                setAgentSettings({
                  enabled: true,
                  has_api_key: agentSettings.has_api_key,
                  has_openai_api_key: agentSettings.has_openai_api_key,
                  model: 'claude-sonnet-4-6',
                  max_turns: 25,
                  auto_approve: false,
                  thinking_enabled: false,
                  thinking_budget: 10000,
                });
              }}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text"
            >
              <RotateCcw size={14} />
              {t('settings.ai.resetAgent')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AISettings;
