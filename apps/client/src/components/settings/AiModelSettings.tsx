/**
 * AI 设置页 —— 照 ZCode 的模型管理方式：
 * 服务列表（状态点）+「添加供应商」→ 内联表单
 * （API 地址 / API 格式 / API Key / 逐个添加模型）。
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, Eye, EyeOff, KeyRound, Pencil, Plus, Sparkles, Trash2, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogTitle } from '@/components/ui/dialog';
import { SettingsSection, SettingRow, SelectField, Toggle } from './shared';
import {
  piConfigState,
  piConfigWriteModels,
  piConfigRemoveAuthKey,
  type ModelsJson,
  type PiConfigStateDto,
} from '@/lib/pi-engine/pi-config';
import { invalidatePiConfig } from '@/lib/pi-engine/providers';
import { isTauri } from '@/lib/transport';
import { TauriAPI, type Mem0ConfigState, type Mem0HitDto } from '@/lib/tauri-api';
import { invalidateMem0State } from '@/lib/pi-engine/mem0';
import { toast } from '@/hooks/use-toast';

/** 思考程度：auto=跟模型默认；off=关闭；low/medium/high=开启并给档位。 */
export type ThinkingPref = 'auto' | 'off' | 'low' | 'medium' | 'high';

interface ModelRow {
  id: string;
  enabled: boolean;
  contextWindow: number;
  maxTokens: number;
  thinking: ThinkingPref;
}

interface ServiceDraft {
  baseUrl: string;
  protocol: string;
  apiKey: string;
  models: ModelRow[];
  /** editing existing provider: id locked */
  editId?: string;
}

/** ZCode 式「添加模型」弹窗的状态。 */
interface ModelDialogState {
  index: number | null; // null = 新增
  id: string;
  contextWindow: string;
  maxTokens: string;
  thinking: ThinkingPref;
}

/** Fallback so the memory card renders before/without backend state. */
const MEM0_DEFAULT: Mem0ConfigState = {
  enabled: false,
  has_key: false,
  user_id: 'wisp',
  auto_capture: true,
};

const emptyDraft = (): ServiceDraft => ({
  baseUrl: '',
  protocol: 'openai-completions',
  apiKey: '',
  models: [],
});

/** provider display name from its baseUrl host (ZCode shows no name field). */
const hostOf = (baseUrl: string): string => {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'provider';
  }
};

const ApiModelSettings = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<PiConfigStateDto | null>(null);
  const [draft, setDraft] = useState<ServiceDraft | null>(null);
  const [modelDialog, setModelDialog] = useState<ModelDialogState | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [mem0, setMem0] = useState<Mem0ConfigState | null>(null);
  const [mem0Hits, setMem0Hits] = useState<Mem0HitDto[] | null>(null);
  const [mem0Key, setMem0Key] = useState('');
  const [showMem0Key, setShowMem0Key] = useState(false);

  const reload = useCallback(async () => {
    if (!isTauri()) return;
    try {
      invalidatePiConfig();
      setState(await piConfigState());
    } catch {
      setState(null);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const reloadMem0 = useCallback(async () => {
    if (!isTauri()) return;
    invalidateMem0State();
    try {
      const state = await TauriAPI.mem0ConfigState();
      setMem0(state);
      setMem0Hits(state.enabled ? await TauriAPI.mem0List(50) : null);
    } catch {
      setMem0(MEM0_DEFAULT);
      setMem0Hits(null);
    }
  }, []);

  useEffect(() => {
    reloadMem0();
  }, [reloadMem0]);

  const saveMem0 = useCallback(
    async (opts: { enabled?: boolean; userId?: string; autoCapture?: boolean; apiKey?: string }) => {
      try {
        const state = await TauriAPI.mem0SaveConfig(opts);
        setMem0(state);
        setMem0Key('');
        invalidateMem0State();
        if (state.enabled) setMem0Hits(await TauriAPI.mem0List(50));
      } catch (e) {
        toast({ title: String(e instanceof Error ? e.message : e) });
      }
    },
    [],
  );

  const m0 = mem0 ?? MEM0_DEFAULT;

  const services = state
    ? Object.entries(state.models_json.providers).filter(([, cfg]) => (cfg.models?.length ?? 0) > 0)
    : [];

  const removeService = async (id: string) => {
    const next: ModelsJson = { providers: { ...(state?.models_json.providers ?? {}) } };
    delete next.providers[id];
    await piConfigWriteModels(next);
    await piConfigRemoveAuthKey(id);
    await reload();
  };

  const save = async () => {
    if (!draft) return;
    const fresh = await piConfigState();
    const next: ModelsJson = { providers: { ...fresh.models_json.providers } };
    const id = draft.editId ?? hostOf(draft.baseUrl);
    next.providers[id] = {
      baseUrl: draft.baseUrl.trim(),
      api: draft.protocol,
      ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      models: draft.models
        .filter((m) => m.enabled)
        .map((m) => ({
          id: m.id,
          name: m.id,
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 8192,
        })),
    };
    await piConfigWriteModels(next);
    setDraft(null);
    reload();
    toast({ title: t('settings.aiCfg.savedToast', { name: hostOf(draft.baseUrl) }) });
  };

  return (
    <div className="space-y-3" data-testid="ai-model-settings">
      <SettingsSection title={t('settings.aiCfg.serviceTitle')}>
        {services.map(([id, cfg]) => {
          const hasKey = Boolean(cfg.apiKey) || state?.auth_status.some((s) => s.provider === id && s.has_key);
          return (
            <div
              key={id}
              className="wisp-setting-row group flex min-h-11 items-center justify-between gap-x-4 rounded-lg px-3 py-2.5"
              data-testid={`pi-service-${id}`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${hasKey ? 'bg-xp-green' : 'bg-xp-yellow'}`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <div className="text-[13px] leading-4 text-xp-text">{cfg.name ?? id}</div>
                  <div className="truncate text-xs text-xp-text-secondary">
                    {(cfg.models ?? []).map((m) => m.id).join(' · ')}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={t('settings.aiCfg.edit')}
                  onClick={() =>
                    setDraft({
                      baseUrl: cfg.baseUrl ?? '',
                      protocol: cfg.api ?? 'openai-completions',
                      apiKey: cfg.apiKey ?? '',
                      models: (cfg.models ?? []).map((m) => ({
                        id: m.id,
                        enabled: true,
                        contextWindow: m.contextWindow ?? 0,
                        maxTokens: m.maxTokens ?? 0,
                        thinking: (m as { thinkingLevel?: string }).thinkingLevel as
                          | ThinkingPref
                          | undefined ?? (m.reasoning === false ? 'off' : 'auto'),
                      })),
                      editId: id,
                    })
                  }
                >
                  {t('settings.aiCfg.edit')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={t('settings.aiCfg.deleteProvider')}
                  onClick={() => removeService(id)}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          );
        })}

        {!draft && (
          <SettingRow
            icon={(props: { size?: number; className?: string }) => (
              <Plus {...props} strokeWidth={2.4} />
            )}
            label={t('settings.aiCfg.addProvider')}
            description={t('settings.aiCfg.serviceAddDesc')}
          >
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setDraft(emptyDraft());
                setShowKey(false);
              }}
              data-testid="pi-add-provider"
            >
              {t('settings.aiCfg.add')}
            </Button>
          </SettingRow>
        )}
      </SettingsSection>

      {modelDialog && (
        <Dialog open onOpenChange={(open) => { if (!open) setModelDialog(null); }} maxWidth={420}>
          <div className="wisp-settings-dialog">
            <header className="wisp-settings-dialog-header">
              <DialogTitle>{modelDialog.index === null ? t('settings.aiCfg.addModel') : t('settings.aiCfg.editModel')}</DialogTitle>
              <button
                type="button"
                className="wisp-control-icon wisp-settings-close"
                aria-label={t('common.cancel')}
                onClick={() => setModelDialog(null)}
              >
                <X size={15} />
              </button>
            </header>
            <div className="wisp-settings-dialog-body">
              <div className="flex flex-col gap-3 px-1 py-1">
                <label className="text-xs text-xp-text-secondary">
                  {t('settings.aiCfg.fldModelId')}
                  <Input
                    autoFocus
                    value={modelDialog.id}
                    onChange={(e) => setModelDialog({ ...modelDialog, id: e.target.value })}
                    placeholder="deepseek-chat"
                    className="mt-1 font-mono text-xs"
                  />
                </label>
                <label className="text-xs text-xp-text-secondary">
                  {t('settings.aiCfg.fldThinking')}
                  <div className="mt-1">
                    <SelectField
                      value={modelDialog.thinking}
                      onChange={(v) => setModelDialog({ ...modelDialog, thinking: v as ThinkingPref })}
                      label={t('settings.aiCfg.fldThinking')}
                      options={[
                        { value: 'auto', label: t('settings.aiCfg.thinkAuto') },
                        { value: 'off', label: t('settings.aiCfg.thinkOff') },
                        { value: 'low', label: t('settings.aiCfg.thinkLow') },
                        { value: 'medium', label: t('settings.aiCfg.thinkMedium') },
                        { value: 'high', label: t('settings.aiCfg.thinkHigh') },
                      ]}
                    />
                  </div>
                </label>
                <div className="flex items-center gap-3">
                  <label className="min-w-0 flex-1 text-xs text-xp-text-secondary">
                    {t('settings.aiCfg.fldCtx')}
                    <Input
                      type="number"
                      value={modelDialog.contextWindow}
                      onChange={(e) =>
                        setModelDialog({ ...modelDialog, contextWindow: e.target.value })
                      }
                      placeholder={t('settings.aiCfg.auto')}
                      className="mt-1 font-mono text-xs"
                    />
                  </label>
                  <label className="min-w-0 flex-1 text-xs text-xp-text-secondary">
                    {t('settings.aiCfg.fldMaxTokens')}
                    <Input
                      type="number"
                      value={modelDialog.maxTokens}
                      onChange={(e) =>
                        setModelDialog({ ...modelDialog, maxTokens: e.target.value })
                      }
                      placeholder={t('settings.aiCfg.auto')}
                      className="mt-1 font-mono text-xs"
                    />
                  </label>
                </div>
              </div>
            </div>
            <footer className="wisp-settings-dialog-footer">
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => setModelDialog(null)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!modelDialog.id.trim()}
                  onClick={() => {
                    const row: ModelRow = {
                      id: modelDialog.id.trim(),
                      enabled: true,
                      contextWindow: Number(modelDialog.contextWindow) || 0,
                      maxTokens: Number(modelDialog.maxTokens) || 0,
                      thinking: modelDialog.thinking,
                    };
                    if (!draft) return;
                    const models =
                      modelDialog.index === null
                        ? [...draft.models, row]
                        : draft.models.map((x, j) => (j === modelDialog.index ? row : x));
                    setDraft({ ...draft, models });
                    setModelDialog(null);
                  }}
                  data-testid="pi-model-dialog-save"
                >
                  {modelDialog.index === null ? t('settings.aiCfg.add') : t('common.save')}
                </Button>
              </div>
            </footer>
          </div>
        </Dialog>
      )}

      {draft && (
        <SettingsSection title={draft.editId ? t('settings.aiCfg.edit') : t('settings.aiCfg.addProvider')}>
          <div className="wisp-setting-row flex flex-col gap-3 rounded-lg px-3 py-3" data-testid="pi-service-form">
            <label className="text-xs text-xp-text-secondary">
              {t('settings.aiCfg.fldBaseUrl')}
              <Input
                autoFocus
                value={draft.baseUrl}
                onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                placeholder="https://api.example.com/v1"
                className="mt-1 font-mono text-xs"
              />
            </label>

            <label className="text-xs text-xp-text-secondary">
              {t('settings.aiCfg.fldProtocol')}
              <div className="mt-1">
                <SelectField
                  value={draft.protocol}
                  onChange={(v) => setDraft({ ...draft, protocol: v })}
                  label={t('settings.aiCfg.fldProtocol')}
                  options={[
                    { value: 'openai-completions', label: 'OpenAI 兼容' },
                    { value: 'anthropic-messages', label: 'Anthropic 兼容' },
                  ]}
                />
              </div>
            </label>

            <label className="text-xs text-xp-text-secondary">
              API Key
              <div className="relative mt-1">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={draft.apiKey}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                  placeholder={t('settings.aiCfg.keyPlaceholder')}
                  className="pr-8 font-mono text-xs"
                />
                <button
                  type="button"
                  aria-label={t('settings.aiCfg.toggleKey')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xp-text-muted hover:text-xp-text"
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </label>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs text-xp-text-secondary">
                  {t('settings.aiCfg.fldModels')}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setModelDialog({ index: null, id: '', contextWindow: '', maxTokens: '', thinking: 'auto' })}
                  data-testid="pi-add-model"
                >
                  <Plus size={11} className="mr-1" />
                  {t('settings.aiCfg.addModel')}
                </Button>
              </div>
              {draft.models.length === 0 ? (
                <div className="rounded-md border border-dashed border-xp-border px-3 py-2.5 text-[11px] text-xp-text-muted">
                  {t('settings.aiCfg.noModelsYet')}
                </div>
              ) : (
                <div className="space-y-1">
                  {draft.models.map((m, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-md border border-xp-border px-2.5 py-1.5"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-xp-text">
                        {m.id || '…'}
                      </span>
                      <span className="shrink-0 rounded bg-xp-surface-light px-1.5 py-0.5 text-[10px] text-xp-text-muted">
                        {m.contextWindow >= 1000
                          ? `${Math.round(m.contextWindow / 1000)}K`
                          : t('settings.aiCfg.auto')}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={t('settings.aiCfg.edit')}
                        data-testid={`pi-edit-model-${i}`}
                        onClick={() =>
                          setModelDialog({
                            index: i,
                            id: m.id,
                            contextWindow: m.contextWindow ? String(m.contextWindow) : '',
                            maxTokens: m.maxTokens ? String(m.maxTokens) : '',
                            thinking: m.thinking,
                          })
                        }
                      >
                        <Pencil size={12} />
                      </Button>
                      <Toggle
                        id={`model-toggle-${i}`}
                        checked={m.enabled}
                        onChange={(v) =>
                          setDraft({
                            ...draft,
                            models: draft.models.map((x, j) => (j === i ? { ...x, enabled: v } : x)),
                          })
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={t('settings.aiCfg.deleteModel')}
                        onClick={() =>
                          setDraft({ ...draft, models: draft.models.filter((_, j) => j !== i) })
                        }
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => setDraft(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!draft.baseUrl.trim() || draft.models.filter((m) => m.id.trim()).length === 0}
                onClick={save}
                data-testid="pi-service-save"
              >
                {draft.editId ? t('common.save') : t('settings.aiCfg.add')}
              </Button>
            </div>
          </div>
        </SettingsSection>
      )}

      <SettingsSection title={t('settings.aiCfg.mem0Title')}>
        <SettingRow
          icon={Brain}
          label={t('settings.aiCfg.mem0Auto')}
          description={t('settings.aiCfg.mem0MasterDesc')}
        >
          {m0.enabled && (
            <>
              <span className="mr-1.5 text-xs text-xp-text-secondary">
                {m0.has_key
                  ? t('settings.aiCfg.mem0Count', { count: mem0Hits?.length ?? 0 })
                  : t('settings.aiCfg.mem0StatusNoKey')}
              </span>
              <span
                className={`mr-2 h-2 w-2 shrink-0 rounded-full ${m0.has_key ? 'bg-xp-green' : 'bg-xp-yellow'}`}
                aria-hidden="true"
              />
            </>
          )}
          <Toggle
            id="mem0-enabled"
            checked={m0.enabled}
            onChange={(v) => saveMem0({ enabled: v })}
          />
        </SettingRow>

        {m0.enabled && (
          <>
            <SettingRow
              icon={KeyRound}
              label={t('settings.aiCfg.mem0KeyLabel')}
              description={
                <span>
                  {t('settings.aiCfg.mem0KeyDesc')}{' '}
                  <a
                    href="https://api.mem0.ai"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-xp-accent hover:underline"
                  >
                    api.mem0.ai
                  </a>
                </span>
              }
            >
              <div className="relative w-52">
                <Input
                  type={showMem0Key ? 'text' : 'password'}
                  value={mem0Key}
                  onChange={(e) => setMem0Key(e.target.value)}
                  onBlur={() => {
                    const v = mem0Key.trim();
                    if (v) void saveMem0({ apiKey: v });
                  }}
                  placeholder={m0.has_key ? '••••••••' : 'm0-...'}
                  className="pr-8 font-mono text-xs"
                  data-testid="mem0-key-input"
                />
                <button
                  type="button"
                  aria-label={t('settings.aiCfg.toggleKey')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xp-text-muted hover:text-xp-text"
                  onClick={() => setShowMem0Key((v) => !v)}
                >
                  {showMem0Key ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </SettingRow>

            <SettingRow
              icon={UserRound}
              label={t('settings.aiCfg.mem0UserId')}
              description={t('settings.aiCfg.userRowDesc')}
            >
              <Input
                value={m0.user_id}
                onChange={(e) => setMem0((m) => (m ? { ...m, user_id: e.target.value } : m))}
                onBlur={() => {
                  const v = m0.user_id.trim();
                  if (v && v !== 'wisp') void saveMem0({ userId: v });
                }}
                className="w-52 font-mono text-xs"
              />
            </SettingRow>

            <SettingRow
              icon={Sparkles}
              label={t('settings.aiCfg.mem0AutoCapture')}
              description={t('settings.aiCfg.learnRowDesc')}
            >
              <Toggle
                id="mem0-capture"
                checked={m0.auto_capture}
                onChange={(v) => saveMem0({ autoCapture: v })}
              />
            </SettingRow>

            {mem0Hits !== null && (
              <div className="px-3 py-2">
                {mem0Hits.length === 0 ? (
                  <div className="rounded-md border border-dashed border-xp-border px-3 py-2.5 text-[11px] text-xp-text-muted">
                    {t('settings.aiCfg.mem0CloudEmpty')}
                  </div>
                ) : (
                  <>
                    <div className="mb-1 text-[11px] font-medium text-xp-text-secondary">
                      {t('settings.aiCfg.mem0CloudTitle')}
                    </div>
                    <div className="space-y-0.5">
                      {mem0Hits.map((m) => (
                        <div
                          key={m.id}
                          className="group flex min-h-9 items-center justify-between gap-x-3 rounded-md px-2 py-1"
                          data-testid={`mem0-hit-${m.id.slice(0, 8)}`}
                        >
                          <div className="min-w-0">
                            <div className="truncate text-xs text-xp-text">{m.memory}</div>
                            {m.categories.length > 0 && (
                              <div className="truncate text-[10px] text-xp-text-muted">
                                {m.categories.join(' · ')}
                              </div>
                            )}
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={t('common.delete')}
                            className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                            onClick={async () => {
                              await TauriAPI.mem0Delete(m.id);
                              await reloadMem0();
                            }}
                          >
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <div className="mt-1.5 flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-xp-red"
                        onClick={async () => {
                          await TauriAPI.mem0DeleteAll();
                          await reloadMem0();
                          toast({ title: t('settings.aiCfg.mem0ClearedToast') });
                        }}
                        data-testid="mem0-clear"
                      >
                        <Trash2 size={12} className="mr-1" />
                        {t('settings.aiCfg.mem0Clear')}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            <p className="px-3 pb-2 pt-1 text-[11px] leading-4 text-xp-text-muted">
              {t('settings.aiCfg.mem0Desc')}
            </p>
          </>
        )}
      </SettingsSection>
    </div>
  );
};

export default ApiModelSettings;
