/**
 * AI 设置页 —— 照 ZCode 的模型管理方式：
 * 服务列表（状态点）+「添加供应商」→ 内联表单
 * （API 地址 / API 格式 / API Key / 逐个添加模型）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Brain,
  CircleHelp,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogTitle } from '@/components/ui/dialog';
import {
  SettingsSection,
  SettingRow,
  SettingInput,
  SettingsStatus,
  SelectField,
  Toggle,
} from './shared';
import {
  piConfigState,
  piConfigWriteModels,
  piConfigRemoveAuthKey,
  type ModelsJson,
  type PiConfigStateDto,
  type PiModelDef,
} from '@/lib/pi-engine/pi-config';
import { invalidatePiConfig } from '@/lib/pi-engine/providers';
import { isTauri } from '@/lib/transport';
import { TauriAPI, type Mem0ConfigState, type Mem0HitDto } from '@/lib/tauri-api';
import { invalidateMem0State } from '@/lib/pi-engine/mem0';
import { toast } from '@/hooks/use-toast';
import type { SettingsEditorProps } from './draft-state';

/** 思考程度：auto=跟模型默认；off=关闭；low/medium/high=开启并给档位。 */
export type ThinkingPref = 'auto' | 'off' | 'low' | 'medium' | 'high';

interface ModelRow {
  id: string;
  enabled: boolean;
  contextWindow: number;
  maxTokens: number;
  thinking: ThinkingPref;
  original?: PiModelDef;
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

const ApiModelSettings = ({ onDraftChange }: SettingsEditorProps = {}) => {
  const { t } = useTranslation();
  const [state, setState] = useState<PiConfigStateDto | null>(null);
  const [draft, setDraft] = useState<ServiceDraft | null>(null);
  const [modelDialog, setModelDialog] = useState<ModelDialogState | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [mem0, setMem0] = useState<Mem0ConfigState | null>(null);
  const [mem0Hits, setMem0Hits] = useState<Mem0HitDto[] | null>(null);
  const [mem0Key, setMem0Key] = useState('');
  const [showMem0Key, setShowMem0Key] = useState(false);
  const [memoryHelpOpen, setMemoryHelpOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [error, setError] = useState('');
  const [memoryError, setMemoryError] = useState('');
  const [memoryLoadFailed, setMemoryLoadFailed] = useState(false);
  const [modelError, setModelError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [clearMemory, setClearMemory] = useState(false);
  const initialDraft = useRef('');
  const savedUserId = useRef('wisp');
  const draftDirty = draft !== null && JSON.stringify(draft) !== initialDraft.current;
  useEffect(() => {
    onDraftChange?.({
      dirty:
        draftDirty ||
        modelDialog !== null ||
        !!mem0Key ||
        (!!mem0 && mem0.user_id !== savedUserId.current),
      busy: saving || memoryBusy,
    });
  }, [draftDirty, modelDialog, mem0Key, mem0, saving, memoryBusy, onDraftChange]);
  const openDraft = (next: ServiceDraft) => {
    initialDraft.current = JSON.stringify(next);
    setDraft(next);
    setShowKey(false);
    setError('');
    setModelError('');
  };

  const reload = useCallback(async () => {
    if (!isTauri()) return;
    try {
      invalidatePiConfig();
      setState(await piConfigState());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
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
      savedUserId.current = state.user_id;
      setMemoryLoadFailed(false);
      if (state.enabled) {
        try {
          setMem0Hits(await TauriAPI.mem0List(50));
        } catch {
          setMemoryError(t('settings.aiCfg.memoryListFailed'));
        }
      } else setMem0Hits(null);
    } catch {
      setMemoryLoadFailed(true);
    }
  }, [t]);

  useEffect(() => {
    reloadMem0();
  }, [reloadMem0]);

  const saveMem0 = async (opts: {
    enabled?: boolean;
    userId?: string;
    autoCapture?: boolean;
    apiKey?: string;
  }) => {
    if (memoryBusy) return;
    setMemoryBusy(true);
    setMemoryError('');
    try {
      const result = await TauriAPI.mem0SaveConfig(opts);
      setMem0(result);
      savedUserId.current = result.user_id;
      if (opts.apiKey) setMem0Key('');
      invalidateMem0State();
      if (result.enabled) {
        try {
          setMem0Hits(await TauriAPI.mem0List(50));
        } catch {
          setMemoryError(t('settings.aiCfg.memoryListFailed'));
        }
      }
    } catch {
      setMemoryError(t('settings.aiCfg.memorySaveFailed'));
    } finally {
      setMemoryBusy(false);
    }
  };

  const m0 = mem0 ?? MEM0_DEFAULT;

  const services = state
    ? Object.entries(state.models_json.providers).filter(([, cfg]) => (cfg.models?.length ?? 0) > 0)
    : [];

  const removeService = async () => {
    if (!removing || saving) return;
    setSaving(true);
    setError('');
    try {
      const fresh = await piConfigState();
      const next: ModelsJson = { providers: { ...fresh.models_json.providers } };
      delete next.providers[removing];
      await piConfigWriteModels(next);
      await piConfigRemoveAuthKey(removing);
      invalidatePiConfig();
      setState({ ...fresh, models_json: next });
      setRemoving(null);
    } catch {
      setError(t('settings.aiCfg.deleteFailed'));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!draft || saving) return;
    try {
      if (!['http:', 'https:'].includes(new URL(draft.baseUrl.trim()).protocol)) throw new Error();
    } catch {
      setError(t('settings.aiCfg.invalidUrl'));
      return;
    }
    if (!draft.models.some((model) => model.enabled && model.id.trim())) {
      setError(t('settings.aiCfg.needEnabledModel'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const fresh = await piConfigState();
      const next: ModelsJson = { providers: { ...fresh.models_json.providers } };
      const baseId = hostOf(draft.baseUrl);
      let id = draft.editId ?? baseId;
      let suffix = 2;
      while (!draft.editId && Object.hasOwn(next.providers, id)) id = `${baseId}-${suffix++}`;
      const previous = draft.editId ? next.providers[id] : undefined;
      next.providers[id] = {
        ...previous,
        baseUrl: draft.baseUrl.trim(),
        api: draft.protocol,
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
        models: draft.models
          .filter((model) => model.enabled)
          .map((model) => {
            const result: PiModelDef = {
              ...model.original,
              id: model.id,
              name: model.original?.name ?? model.id,
            };
            delete result.contextWindow;
            delete result.maxTokens;
            delete result.thinkingLevel;
            if (model.contextWindow > 0) result.contextWindow = model.contextWindow;
            if (model.maxTokens > 0) result.maxTokens = model.maxTokens;
            if (model.thinking === 'off') result.reasoning = false;
            else if (model.thinking !== 'auto') {
              result.reasoning = true;
              result.thinkingLevel = model.thinking;
            }
            return result;
          }),
      };
      await piConfigWriteModels(next);
      invalidatePiConfig();
      setState({ ...fresh, models_json: next });
      setDraft(null);
      toast({ title: t('settings.aiCfg.savedToast', { name: hostOf(draft.baseUrl) }) });
    } catch {
      setError(t('settings.aiCfg.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="ai-model-settings">
      <SettingsSection title={t('settings.aiCfg.serviceTitle')}>
        {loadFailed && (
          <div>
            <SettingsStatus error>{t('settings.aiCfg.loadFailed')}</SettingsStatus>
            <div className="wisp-settings-actions">
              <Button variant="secondary" onClick={reload}>
                {t('settings.retry')}
              </Button>
            </div>
          </div>
        )}
        {!isTauri() && <SettingsStatus>{t('settings.aiCfg.desktopOnly')}</SettingsStatus>}
        {services.map(([id, cfg]) => {
          const hasKey =
            Boolean(cfg.apiKey) || state?.auth_status.some((s) => s.provider === id && s.has_key);
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
                    <span className="ml-2">
                      {t(hasKey ? 'settings.aiCfg.keyReady' : 'settings.aiCfg.keyMissing')}
                    </span>
                  </div>
                </div>
              </div>
              <div className="wisp-settings-inline-actions">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={t('settings.aiCfg.editNamed', { name: cfg.name ?? id })}
                  disabled={saving || draft !== null}
                  onClick={() =>
                    openDraft({
                      baseUrl: cfg.baseUrl ?? '',
                      protocol: cfg.api ?? 'openai-completions',
                      apiKey: '',
                      models: (cfg.models ?? []).map((m) => ({
                        id: m.id,
                        enabled: true,
                        original: m,
                        contextWindow: m.contextWindow ?? 0,
                        maxTokens: m.maxTokens ?? 0,
                        thinking:
                          ((m as { thinkingLevel?: string }).thinkingLevel as
                            | ThinkingPref
                            | undefined) ?? (m.reasoning === false ? 'off' : 'auto'),
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
                  aria-label={t('settings.aiCfg.deleteNamed', { name: cfg.name ?? id })}
                  disabled={saving || draft !== null}
                  onClick={() => {
                    setError('');
                    setRemoving(id);
                  }}
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
          >
            <Button
              type="button"
              size="sm"
              onClick={() => {
                openDraft(emptyDraft());
                setShowKey(false);
              }}
              disabled={!isTauri() || saving || loadFailed}
              data-testid="pi-add-provider"
            >
              {t('settings.aiCfg.add')}
            </Button>
          </SettingRow>
        )}
      </SettingsSection>

      {modelDialog && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setModelDialog(null);
          }}
          maxWidth={420}
        >
          <div className="wisp-settings-dialog">
            <header className="wisp-settings-dialog-header">
              <DialogTitle>
                {modelDialog.index === null
                  ? t('settings.aiCfg.addModel')
                  : t('settings.aiCfg.editModel')}
              </DialogTitle>
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
                      onChange={(v) =>
                        setModelDialog({ ...modelDialog, thinking: v as ThinkingPref })
                      }
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
            <p className="wisp-settings-status">{t('settings.aiCfg.limitsHint')}</p>
            {modelError && <SettingsStatus error>{modelError}</SettingsStatus>}
            <footer className="wisp-settings-dialog-footer">
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setModelDialog(null)}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!modelDialog.id.trim()}
                  onClick={() => {
                    setModelError('');
                    const limits = [modelDialog.contextWindow, modelDialog.maxTokens];
                    if (
                      limits.some(
                        (value) =>
                          value.trim() &&
                          (!Number.isSafeInteger(Number(value)) || Number(value) <= 0),
                      ) ||
                      (Number(modelDialog.contextWindow) > 0 &&
                        Number(modelDialog.maxTokens) > Number(modelDialog.contextWindow))
                    ) {
                      setModelError(t('settings.aiCfg.invalidLimits'));
                      return;
                    }
                    if (
                      draft?.models.some(
                        (model, index) =>
                          index !== modelDialog.index && model.id === modelDialog.id.trim(),
                      )
                    ) {
                      setModelError(t('settings.aiCfg.duplicateModel'));
                      return;
                    }
                    const row: ModelRow = {
                      original:
                        modelDialog.index !== null
                          ? draft?.models[modelDialog.index]?.original
                          : undefined,
                      id: modelDialog.id.trim(),
                      enabled:
                        modelDialog.index === null
                          ? true
                          : (draft?.models[modelDialog.index]?.enabled ?? true),
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
        <SettingsSection
          title={draft.editId ? t('settings.aiCfg.edit') : t('settings.aiCfg.addProvider')}
        >
          <fieldset disabled={saving} className="wisp-settings-form" data-testid="pi-service-form">
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
                    { value: 'openai-completions', label: t('settings.aiCfg.openaiCompatible') },
                    { value: 'anthropic-messages', label: t('settings.aiCfg.anthropicCompatible') },
                  ]}
                />
              </div>
            </label>

            <label className="text-xs text-xp-text-secondary">
              {t('settings.aiCfg.keyLabel')}
              <div className="relative mt-1">
                <Input
                  type={showKey ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  value={draft.apiKey}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                  placeholder={t(
                    draft.editId
                      ? 'settings.aiCfg.keepKeyPlaceholder'
                      : 'settings.aiCfg.keyPlaceholder',
                  )}
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
                  onClick={() => {
                    setModelError('');
                    setModelDialog({
                      index: null,
                      id: '',
                      contextWindow: '',
                      maxTokens: '',
                      thinking: 'auto',
                    });
                  }}
                  data-testid="pi-add-model"
                >
                  <Plus size={11} className="mr-1" />
                  {t('settings.aiCfg.addModel')}
                </Button>
              </div>
              {draft.models.length === 0 ? (
                <div className="rounded-md border border-dashed border-xp-border px-3 py-2.5 text-xs text-xp-text-muted">
                  {t('settings.aiCfg.noModelsYet')}
                </div>
              ) : (
                <div className="space-y-1">
                  {draft.models.map((m, i) => (
                    <div
                      key={m.id}
                      className="flex items-center gap-2 rounded-md border border-xp-border px-2.5 py-1.5"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-xp-text">
                        {m.id || '…'}
                      </span>
                      <span className="shrink-0 rounded bg-xp-surface-light px-1.5 py-0.5 text-xs text-xp-text-muted">
                        {m.contextWindow >= 1000
                          ? `${Math.round(m.contextWindow / 1000)}K`
                          : t('settings.aiCfg.auto')}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={t('settings.aiCfg.editNamed', { name: m.id })}
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
                        label={t('settings.aiCfg.useModel', { name: m.id })}
                        checked={m.enabled}
                        onChange={(v) =>
                          setDraft({
                            ...draft,
                            models: draft.models.map((x, j) =>
                              j === i ? { ...x, enabled: v } : x,
                            ),
                          })
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={t('settings.aiCfg.deleteNamed', { name: m.id })}
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

            {error && <SettingsStatus error>{error}</SettingsStatus>}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={saving}
                onClick={() => {
                  setDraft(null);
                  setError('');
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={
                  saving ||
                  !draft.baseUrl.trim() ||
                  !draft.models.some((m) => m.enabled && m.id.trim())
                }
                onClick={save}
                data-testid="pi-service-save"
              >
                {t(saving ? 'settings.saving' : 'common.save')}
              </Button>
            </div>
          </fieldset>
        </SettingsSection>
      )}

      <SettingsSection
        title={
          <span className="inline-flex items-center gap-2">
            {t('settings.aiCfg.mem0Title')}
            <button
              type="button"
              aria-label={t('settings.aiCfg.mem0Help')}
              aria-expanded={memoryHelpOpen}
              onClick={() => setMemoryHelpOpen((open) => !open)}
              className="inline-flex items-center text-xp-text-secondary hover:text-xp-blue"
            >
              <CircleHelp size={14} aria-hidden="true" />
            </button>
          </span>
        }
        description={memoryHelpOpen ? t('settings.aiCfg.mem0Desc') : undefined}
      >
        {memoryLoadFailed && (
          <div>
            <SettingsStatus error>{t('settings.aiCfg.memoryLoadFailed')}</SettingsStatus>
            <div className="wisp-settings-actions">
              <Button variant="secondary" onClick={reloadMem0}>
                {t('settings.retry')}
              </Button>
            </div>
          </div>
        )}
        <SettingRow icon={Brain} label={t('settings.aiCfg.mem0Auto')}>
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
            disabled={memoryBusy || memoryLoadFailed || !isTauri()}
            checked={m0.enabled}
            onChange={(v) => saveMem0({ enabled: v })}
          />
        </SettingRow>

        {m0.enabled && (
          <>
            <SettingRow icon={KeyRound} label={t('settings.aiCfg.mem0KeyLabel')}>
              <div className="flex max-w-full items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <SettingInput
                    type={showMem0Key ? 'text' : 'password'}
                    value={mem0Key}
                    onChange={(e) => setMem0Key(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={memoryBusy}
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
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={memoryBusy || !mem0Key.trim()}
                  onClick={() => void saveMem0({ apiKey: mem0Key.trim() })}
                >
                  {t(memoryBusy ? 'settings.saving' : 'common.save')}
                </Button>
              </div>
            </SettingRow>

            <SettingRow icon={UserRound} label={t('settings.aiCfg.mem0UserId')}>
              <SettingInput
                disabled={memoryBusy}
                value={m0.user_id}
                onChange={(e) => setMem0((m) => (m ? { ...m, user_id: e.target.value } : m))}
                onBlur={() => {
                  const v = m0.user_id.trim();
                  if (v && v !== savedUserId.current) void saveMem0({ userId: v });
                }}
                className="w-52 font-mono text-xs"
              />
            </SettingRow>

            <SettingRow icon={Sparkles} label={t('settings.aiCfg.mem0AutoCapture')}>
              <Toggle
                id="mem0-capture"
                disabled={memoryBusy}
                checked={m0.auto_capture}
                onChange={(v) => saveMem0({ autoCapture: v })}
              />
            </SettingRow>

            {mem0Hits !== null && (
              <div className="px-3 py-2">
                {mem0Hits.length === 0 ? (
                  <div className="rounded-md border border-dashed border-xp-border px-3 py-2.5 text-xs text-xp-text-muted">
                    {t('settings.aiCfg.mem0CloudEmpty')}
                  </div>
                ) : (
                  <>
                    <div className="mb-1 text-xs font-medium text-xp-text-secondary">
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
                              <div className="truncate text-xs text-xp-text-muted">
                                {m.categories.join(' · ')}
                              </div>
                            )}
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={t('settings.aiCfg.deleteNamed', { name: m.memory })}
                            className="shrink-0"
                            disabled={memoryBusy}
                            onClick={async () => {
                              setMemoryBusy(true);
                              setMemoryError('');
                              try {
                                await TauriAPI.mem0Delete(m.id);
                                await reloadMem0();
                              } catch {
                                setMemoryError(t('settings.aiCfg.memoryDeleteFailed'));
                              } finally {
                                setMemoryBusy(false);
                              }
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
                        disabled={memoryBusy}
                        onClick={() => {
                          setMemoryError('');
                          setClearMemory(true);
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
          </>
        )}
        {memoryError && <SettingsStatus error>{memoryError}</SettingsStatus>}
      </SettingsSection>
      {removing && (
        <Dialog
          open
          preventClose={saving}
          onOpenChange={(open) => {
            if (!open) setRemoving(null);
          }}
          maxWidth={420}
        >
          <div className="wisp-settings-confirm">
            <DialogTitle>{t('settings.aiCfg.deleteTitle', { name: removing })}</DialogTitle>
            <p>{t('settings.aiCfg.deleteDescription')}</p>
            {error && <SettingsStatus error>{error}</SettingsStatus>}
            <div className="wisp-settings-actions">
              <Button
                variant="secondary"
                disabled={saving}
                data-autofocus
                onClick={() => setRemoving(null)}
              >
                {t('common.cancel')}
              </Button>
              <Button disabled={saving} onClick={removeService}>
                {t(saving ? 'settings.saving' : 'settings.aiCfg.deleteProvider')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
      {clearMemory && (
        <Dialog
          open
          preventClose={memoryBusy}
          onOpenChange={(open) => {
            if (!open) setClearMemory(false);
          }}
          maxWidth={420}
        >
          <div className="wisp-settings-confirm">
            <DialogTitle>{t('settings.aiCfg.clearMemoryTitle')}</DialogTitle>
            <p>{t('settings.aiCfg.clearMemoryDescription')}</p>
            {memoryError && <SettingsStatus error>{memoryError}</SettingsStatus>}
            <div className="wisp-settings-actions">
              <Button
                variant="secondary"
                disabled={memoryBusy}
                data-autofocus
                onClick={() => setClearMemory(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                disabled={memoryBusy}
                onClick={async () => {
                  setMemoryBusy(true);
                  setMemoryError('');
                  try {
                    await TauriAPI.mem0DeleteAll();
                    await reloadMem0();
                    setClearMemory(false);
                  } catch {
                    setMemoryError(t('settings.aiCfg.memoryDeleteFailed'));
                  } finally {
                    setMemoryBusy(false);
                  }
                }}
              >
                {t(memoryBusy ? 'settings.saving' : 'settings.aiCfg.mem0Clear')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};

export default ApiModelSettings;
