import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  ExternalLink,
  Keyboard,
  Pencil,
  Plus,
  RotateCcw,
  Star,
  Trash2,
  X,
  AppWindow,
  MousePointer2,
  MousePointerClick,
  SlidersHorizontal,
  PanelsTopLeft,
  Files,
  LogOut,
  Minimize2,
  Palette,
  Text,
  CloudOff,
  Clipboard,
  Check,
  Zap,
  Cloud,
  FolderSync,
  FolderOpen,
  Camera,
  Terminal,
  UserRound,
  Sparkles,
} from 'lucide-react';
import type { ShelfSettings as NativeShelfSettings, ShelfRequest } from '@wisp/sdk';
import { useShelfState } from '@/hooks/use-shelf-state';
import { TauriAPI } from '@/lib/tauri-api';
import { isTauri } from '@/lib/transport';
import { Button } from '@/components/ui/button';
import { Dialog, DialogTitle } from '@/components/ui/dialog';
import {
  ShelfSettingsLayout,
  SHELF_SETTINGS_CATEGORIES,
  type ShelfSettingsCategory,
} from './ShelfSettingsLayout';
import {
  ShelfSettingsPrimarySection,
  ShelfSettingTool as Tool,
  ShelfSettingDisclosure as Disclosure,
  ShelfSettingRange as ShelfRange,
} from './ShelfSettingsControls';
import type { SettingsEditorProps } from './draft-state';
import {
  SettingInput,
  SettingRow,
  SettingsSection,
  SettingsStatus,
  SelectField,
  Toggle,
} from './shared';
import {
  ShelfActionEditor,
  ShelfCloudEditor,
  ShelfWatchEditor,
  ShelfPathInput,
} from './ShelfSettingsEditors';
import {
  SHELF_ACTION_KINDS,
  captureShelfShortcut,
  displayShelfShortcut,
  filterShelfShareHistory,
  isShelfShareExpired,
  moveShelfChoice,
  newShelfAction,
  newShelfCloud,
  newShelfWatchedFolder,
  shelfShareCanRevoke,
  validShelfWebURL,
  type ShelfActionPreset,
  type ShelfCloudAccount,
  type ShelfShortcut,
  type ShelfWatchedFolder,
} from './shelf-settings-helpers';

type EditorDraft =
  | { kind: 'action'; value: ShelfActionPreset }
  | { kind: 'watch'; value: ShelfWatchedFolder }
  | { kind: 'cloud'; value: ShelfCloudAccount };
type ShortcutCapture = { shortcut: ShelfShortcut; local: boolean };
const FIELD_ICONS: Partial<Record<keyof NativeShelfSettings, React.ElementType>> = {
  shakeEnabled: MousePointer2,
  shakeSensitivity: SlidersHorizontal,
  modifierEnabled: Keyboard,
  activationModifier: Keyboard,
  notchEnabled: PanelsTopLeft,
  defaultPosition: PanelsTopLeft,
  additionBehavior: Files,
  doubleClickBehavior: MousePointer2,
  edgeDoubleClick: MousePointerClick,
  closeAfterDrag: LogOut,
  copyOnDrag: Copy,
  autoPlace: PanelsTopLeft,
  retractAfterDrop: Minimize2,
  colorShelves: Palette,
  closeDetailsOutside: X,
  plainText: Text,
  ownSpace: AppWindow,
  focusOnShow: MousePointer2,
  intelligentShelfName: Sparkles,
  onlineDisabled: CloudOff,
  scriptCopyOutput: Clipboard,
  scriptCloseOnSuccess: Check,
  instantActionsEnabled: Zap,
  screenshotAdditionBehavior: Camera,
};

/** #33：观察状态 → 徽标文案与配色档。 */
const watchStatusBadge = (
  status: string,
  translate: (key: string) => string,
): { label: string; tone: 'ok' | 'muted' | 'error' } => {
  if (status === 'error') return { label: translate('error'), tone: 'error' };
  if (status === 'stopped') return { label: translate('stopped'), tone: 'muted' };
  return { label: translate('active'), tone: 'ok' };
};

const ShelfSettings = ({
  onDraftChange,
  active = true,
}: SettingsEditorProps & { active?: boolean }) => {
  const { t, i18n } = useTranslation();
  const { state, loading, error, request, refresh } = useShelfState();
  const settings = state?.settings;
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const [editor, setEditor] = useState<EditorDraft>();
  const [recording, setRecording] = useState<ShortcutCapture>();
  const [auxiliary, setAuxiliary] = useState<'shortcuts' | 'ignoredApps'>();
  const [screenshotTest, setScreenshotTest] = useState<'idle' | 'waiting' | 'success' | 'failed'>(
    'idle',
  );
  const [copiedCommand, setCopiedCommand] = useState(false);
  // #67：上传历史过滤 + 删除并撤销的两步确认与进行态。
  const [historyFilter, setHistoryFilter] = useState<'all' | 'valid' | 'expired'>('all');
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);
  const [revokingRecordId, setRevokingRecordId] = useState<string | null>(null);
  const recordingRef = useRef(false);
  const operationRef = useRef(false);
  const liveSettings = useRef(settings);
  liveSettings.current = settings;
  const screenshotBaseline = useRef<Map<string, number> | null>(null);

  useEffect(() => {
    onDraftChange?.({ dirty: Boolean(editor), busy });
  }, [editor, busy, onDraftChange]);
  // #67：删除并撤销跑在引擎侧；失败原因在这里浮出（成功则列表随状态事件自刷新）。
  useEffect(() => {
    let active = true;
    let release: (() => void) | undefined;
    void TauriAPI.listenToShelfCloudRevoke((result) => {
      if (!active) return;
      setRevokingRecordId((current) => (current === result.recordId ? null : current));
      setRevokeConfirmId((current) => (current === result.recordId ? null : current));
      if (!result.succeeded) setLocalError(result.message);
    }).then((stop) => {
      if (active) release = stop;
      else stop();
    });
    return () => {
      active = false;
      release?.();
    };
  }, []);
  useEffect(
    () => () => {
      onDraftChange?.({ dirty: false, busy: false });
      if (recordingRef.current) {
        void request({ action: 'shortcutCapture', active: false }).catch(() => undefined);
      }
    },
    [onDraftChange, request],
  );

  const run = async (operation: () => Promise<unknown>): Promise<boolean> => {
    if (operationRef.current) return false;
    operationRef.current = true;
    setBusy(true);
    setLocalError(undefined);
    try {
      await operation();
      return true;
    } catch (failure) {
      setLocalError(failure instanceof Error ? failure.message : String(failure));
      return false;
    } finally {
      operationRef.current = false;
      setBusy(false);
    }
  };
  const send = (value: ShelfRequest) => run(() => request(value));
  const patch = (value: Partial<NativeShelfSettings>) =>
    send({ action: 'settings', settings: value });
  const closeEditor = () => setEditor(undefined);
  const stopRecording = useCallback(async () => {
    recordingRef.current = false;
    setRecording(undefined);
    try {
      await request({ action: 'shortcutCapture', active: false });
    } catch (failure) {
      setLocalError(String(failure));
    }
  }, [request]);
  useEffect(() => {
    if (!active && recordingRef.current) void stopRecording();
    if (!active) setAuxiliary(undefined);
  }, [active, stopRecording]);
  useEffect(() => {
    if (!recording) return;
    const timeout = window.setTimeout(() => void stopRecording(), 30000);
    const blur = () => void stopRecording();
    window.addEventListener('blur', blur);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('blur', blur);
    };
  }, [recording, stopRecording]);
  const beginRecording = async (shortcut: ShelfShortcut, local: boolean) => {
    if (operationRef.current || recordingRef.current) return;
    recordingRef.current = true;
    if (await send({ action: 'shortcutCapture', active: true })) {
      if (recordingRef.current) setRecording({ shortcut, local });
    } else {
      recordingRef.current = false;
    }
  };
  const capture = async (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording || event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    if (
      event.code === 'Escape' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      await stopRecording();
      return;
    }
    const binding = captureShelfShortcut(event);
    if (!binding) return;
    if (!recording.local && binding.modifiers === 0) {
      setLocalError(t('shelf.preferences.errors.modifierRequired'));
      return;
    }
    const key = recording.local ? 'localShortcutBindings' : 'shortcutBindings';
    const bindings = liveSettings.current?.[key] ?? [];
    if (
      bindings.some(
        (other) =>
          other.id !== recording.shortcut.id &&
          other.enabled &&
          other.keyCode === binding.keyCode &&
          other.modifiers === binding.modifiers,
      )
    ) {
      setLocalError(t('shelf.preferences.errors.shortcutConflict'));
      return;
    }
    const updated = bindings.map((other) =>
      other.id === recording.shortcut.id ? { ...other, ...binding } : other,
    );
    await stopRecording();
    await patch({ [key]: updated });
  };
  const toggleShortcut = (shortcut: ShelfShortcut, local: boolean, enabled: boolean) => {
    if (!settings) return;
    const key = local ? 'localShortcutBindings' : 'shortcutBindings';
    const bindings = settings[key];
    if (
      enabled &&
      bindings.some(
        (other) =>
          other.id !== shortcut.id &&
          other.enabled &&
          other.keyCode === shortcut.keyCode &&
          other.modifiers === shortcut.modifiers,
      )
    ) {
      setLocalError(t('shelf.preferences.errors.shortcutConflict'));
      return;
    }
    void patch({
      [key]: bindings.map((other) => (other.id === shortcut.id ? { ...other, enabled } : other)),
    });
  };
  const addScripts = async () => {
    await run(async () => {
      const paths = await TauriAPI.showOpenDialog({ multiple: true });
      if (!paths?.length) return;
      await request({
        action: 'settings',
        settings: {
          scriptPaths: [...new Set([...(liveSettings.current?.scriptPaths ?? []), ...paths])],
        },
      });
    });
  };
  const saveAction = async (value: ShelfActionPreset) => {
    const actions = liveSettings.current?.customActions ?? [];
    const saved = await patch({
      customActions: actions.some((item) => item.id === value.id)
        ? actions.map((item) => (item.id === value.id ? value : item))
        : [...actions, value],
    });
    if (saved) closeEditor();
    return saved;
  };
  const saveWatch = async (value: ShelfWatchedFolder) => {
    const folders = liveSettings.current?.watchedFolders ?? [];
    if (
      folders.some(
        (item) =>
          item.id !== value.id && item.path.replace(/\/+$/, '') === value.path.replace(/\/+$/, ''),
      )
    ) {
      setLocalError(t('shelf.preferences.errors.duplicateFolder'));
      return false;
    }
    const saved = await patch({
      watchedFolders: folders.some((item) => item.id === value.id)
        ? folders.map((item) => (item.id === value.id ? value : item))
        : [...folders, value],
    });
    if (saved) closeEditor();
    return saved;
  };
  const saveCloud = async (value: ShelfCloudAccount, secret?: string) => {
    const saved = await run(async () => {
      const accounts = liveSettings.current?.cloudAccounts ?? [];
      const updated = accounts.some((item) => item.id === value.id)
        ? accounts.map((item) => (item.id === value.id ? value : item))
        : [...accounts, value];
      await request({ action: 'settings', settings: { cloudAccounts: updated } });
      if (secret) await request({ action: 'setCredential', accountId: value.id, secret });
    });
    if (saved) closeEditor();
    return saved;
  };
  const removeCloud = async (account: ShelfCloudAccount) => {
    await run(async () => {
      await request({ action: 'removeCloudAccount', accountId: account.id });
    });
  };
  // #34：「拍一张试试」——先记下当前各架条目数，60s 内任何架子多了条目即成功
  //（新截图会被观察管线收集进架并亮起）。
  const beginScreenshotTest = async () => {
    screenshotBaseline.current = new Map(
      (state?.shelves ?? []).map((shelf) => [shelf.id, shelf.items.length]),
    );
    if (await send({ action: 'screenshotTest' })) {
      setScreenshotTest('waiting');
    } else {
      screenshotBaseline.current = null;
    }
  };
  useEffect(() => {
    if (screenshotTest !== 'waiting') return;
    const baseline = screenshotBaseline.current;
    if (!baseline) return;
    const grew = (state?.shelves ?? []).some(
      (shelf) => (baseline.get(shelf.id) ?? 0) < shelf.items.length,
    );
    if (grew) {
      setScreenshotTest('success');
      screenshotBaseline.current = null;
    }
  }, [state, screenshotTest]);
  useEffect(() => {
    if (screenshotTest !== 'waiting') return;
    const timer = window.setTimeout(() => setScreenshotTest('failed'), 60000);
    return () => window.clearTimeout(timer);
  }, [screenshotTest]);
  const copyThumbnailCommand = async () => {
    await run(() =>
      navigator.clipboard.writeText(
        'defaults write com.apple.screencapture show-thumbnail -bool FALSE\nkillall SystemUIServer',
      ),
    );
    setCopiedCommand(true);
    window.setTimeout(() => setCopiedCommand(false), 1600);
  };
  const toggleFavorite = (id: string) => {
    if (!settings) return;
    const current = settings.favoriteActionIDs ?? [];
    let next = current;
    if (current.includes(id)) {
      next = current.filter((value) => value !== id);
    } else if (current.length < 5) {
      next = [...current, id];
    }
    if (next !== current) void patch({ favoriteActionIDs: next });
  };

  if (loading && !state) {
    // Render the real layout shell with placeholder rows so the sheet keeps its
    // exact geometry; the snapshot landing only swaps bars for controls.
    const skeletonPanel = (
      <div className="wisp-shelf-skeleton">
        <p className="sr-only">{t('shelf.preferences.loading')}</p>
        {Array.from({ length: 8 }, (_, row) => (
          <div className="wisp-skeleton-row" key={row} aria-hidden="true">
            <span className="wisp-skeleton wisp-skeleton-icon" />
            <span className="wisp-skeleton wisp-skeleton-label" />
            <span className="wisp-skeleton wisp-skeleton-control" />
          </div>
        ))}
      </div>
    );
    return (
      <ShelfSettingsLayout
        busy={false}
        onCategoryChange={() => undefined}
        panels={
          Object.fromEntries(
            SHELF_SETTINGS_CATEGORIES.map((item) => [item, skeletonPanel]),
          ) as Record<ShelfSettingsCategory, React.ReactNode>
        }
      />
    );
  }
  if (!state?.supported || !settings) {
    return (
      <div className="py-4">
        <SettingsStatus error={Boolean(error)}>
          {error || t('shelf.preferences.desktopRequired')}
        </SettingsStatus>
        <Button variant="secondary" size="sm" onClick={() => void refresh().catch(() => undefined)}>
          {t('common.refresh')}
        </Button>
      </div>
    );
  }

  const toggle = <K extends keyof NativeShelfSettings>(key: K) => (
    <SettingRow
      icon={FIELD_ICONS[key]}
      label={t(`shelf.preferences.fields.${key}`)}
      key={key}
      description={t(`shelf.preferences.descriptions.${key}`, { defaultValue: '' }) || undefined}
    >
      <Toggle
        id={`shelf-setting-${key}`}
        checked={Boolean(settings[key])}
        onChange={(value) => void patch({ [key]: value })}
      />
    </SettingRow>
  );
  const select = (
    key: keyof NativeShelfSettings,
    values: string[],
    description?: React.ReactNode,
  ) => (
    <SettingRow
      icon={FIELD_ICONS[key]}
      label={t(`shelf.preferences.fields.${key}`)}
      key={key}
      description={description}
    >
      <SelectField
        value={String(settings[key])}
        onChange={(value) => void patch({ [key]: value })}
        options={values.map((value) => ({
          value,
          label: t(`shelf.preferences.options.${key}.${value}`),
        }))}
      />
    </SettingRow>
  );
  const choices = [
    ...['airdrop', 'messages', 'mail', 'cloud'].map((id) => ({
      id,
      title: t(`shelf.preferences.sharing.${id}`),
    })),
    ...SHELF_ACTION_KINDS.map((kind) => ({
      id: `action:${kind}`,
      title: t(`shelf.preferences.actionKinds.${kind}`),
    })),
    ...['copyPaths', 'copyTextContents', 'removeImageMetadata', 'moveToTrash'].map((kind) => ({
      id: `utility:${kind}`,
      title: t(`shelf.preferences.utilities.${kind}`),
    })),
    ...settings.customActions.map((action) => ({ id: `preset:${action.id}`, title: action.name })),
    ...settings.scriptPaths.map((path) => ({
      id: `script:${path}`,
      title: path.split('/').at(-1) ?? path,
    })),
    ...settings.cloudAccounts.map((account) => ({
      id: `cloud:${account.id}`,
      title: `${t('shelf.preferences.uploadTo')} ${account.name}`,
    })),
  ];
  const displayShortcutRows = (bindings: ShelfShortcut[], local: boolean) =>
    bindings.map((shortcut) => (
      <SettingRow
        key={shortcut.id}
        label={t(`shelf.preferences.shortcuts.${local ? 'local' : 'global'}.${shortcut.id}`, {
          defaultValue: shortcut.title,
        })}
        icon={Keyboard}
      >
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="max-w-[170px] overflow-hidden text-ellipsis text-[11px]"
            disabled={Boolean(recording)}
            onClick={() => void beginRecording(shortcut, local)}
            aria-label={t('shelf.preferences.recordShortcut', { name: shortcut.title })}
          >
            <kbd>{displayShelfShortcut(shortcut, t)}</kbd>
          </Button>
          <Toggle
            id={`shelf-shortcut-${local ? 'local' : 'global'}-${shortcut.id}`}
            label={t(`shelf.preferences.shortcuts.${local ? 'local' : 'global'}.${shortcut.id}`, {
              defaultValue: shortcut.title,
            })}
            checked={shortcut.enabled}
            disabled={Boolean(recording)}
            onChange={(value) => toggleShortcut(shortcut, local, value)}
          />
        </div>
      </SettingRow>
    ));

  return (
    <>
      <ShelfSettingsLayout
        busy={busy || Boolean(recording)}
        onCategoryChange={() => {
          if (recordingRef.current) void stopRecording();
        }}
        headerExtra={
          <Button variant="secondary" size="sm" onClick={() => void send({ action: 'showGuide' })}>
            <Sparkles size={13} />
            {t('shelf.preferences.quickStart')}
          </Button>
        }
        status={
          localError || error ? (
            <SettingsStatus error>{localError || error}</SettingsStatus>
          ) : undefined
        }
        panels={{
          activation: (
            <>
              <ShelfSettingsPrimarySection>
                {toggle('shakeEnabled')}
                <SettingRow
                  icon={SlidersHorizontal}
                  label={t('shelf.preferences.fields.shakeSensitivity')}
                >
                  <ShelfRange
                    value={settings.shakeSensitivity}
                    disabled={!settings.shakeEnabled}
                    label={t('shelf.preferences.fields.shakeSensitivity')}
                    onCommit={(value) => void patch({ shakeSensitivity: value })}
                  />
                </SettingRow>
                {toggle('modifierEnabled')}
                {select('activationModifier', ['shift', 'option', 'control', 'command'])}
                {toggle('notchEnabled')}
                {select('defaultPosition', [
                  'topRight',
                  'topLeft',
                  'bottomRight',
                  'bottomLeft',
                  'center',
                  'cursor',
                ])}
                {select(
                  'additionBehavior',
                  ['new', 'current', 'visible'],
                  <span className="block whitespace-pre-line">
                    {t('shelf.preferences.descriptions.additionBehavior')}
                  </span>,
                )}
              </ShelfSettingsPrimarySection>
              <SettingRow icon={Keyboard} label={t('shelf.preferences.keyboard')}>
                <Button variant="secondary" size="sm" onClick={() => setAuxiliary('shortcuts')}>
                  {t('common.edit')}
                </Button>
              </SettingRow>
              <SettingRow icon={AppWindow} label={t('shelf.preferences.ignoredApps')}>
                <Button variant="secondary" size="sm" onClick={() => setAuxiliary('ignoredApps')}>
                  {t('common.edit')}
                </Button>
              </SettingRow>
            </>
          ),
          interaction: (
            <ShelfSettingsPrimarySection>
              {select('doubleClickBehavior', ['reveal', 'open', 'preview', 'none'])}
              {select('edgeDoubleClick', ['dock', 'hide', 'none'])}
              {select('closeAfterDrag', ['moved', 'always', 'never'])}
              {toggle('copyOnDrag')}
              {toggle('autoPlace')}
              {toggle('retractAfterDrop')}
              <Disclosure title={t('shelf.preferences.advanced')}>
                {(
                  [
                    'colorShelves',
                    'closeDetailsOutside',
                    'plainText',
                    'ownSpace',
                    'focusOnShow',
                    'intelligentShelfName',
                  ] as const
                ).map(toggle)}
              </Disclosure>
            </ShelfSettingsPrimarySection>
          ),
          general: (
            <>
              <SettingsSection title={t('shelf.preferences.online')}>
                {toggle('onlineDisabled')}
              </SettingsSection>
              <SettingsSection title={t('shelf.preferences.scripts')}>
                {settings.scriptPaths.length === 0 && (
                  <SettingsStatus>{t('shelf.preferences.noScripts')}</SettingsStatus>
                )}
                {settings.scriptPaths.map((path) => (
                  <SettingRow
                    key={path}
                    icon={Terminal}
                    label={<span className="break-all">{path.split('/').at(-1)}</span>}
                    description={
                      <span className="flex max-w-full flex-col gap-1">
                        <span className="break-all">{path}</span>
                        {/* #51：每条脚本一个描述，菜单 tooltip 用。 */}
                        <SettingInput
                          value={settings.scriptDescriptions?.[path] ?? ''}
                          onChange={(event) =>
                            void patch({
                              scriptDescriptions: {
                                ...settings.scriptDescriptions,
                                [path]: event.target.value,
                              },
                            })
                          }
                          onBlur={(event) => {
                            const value = event.target.value.trim();
                            const next = { ...settings.scriptDescriptions };
                            if (value) next[path] = value;
                            else delete next[path];
                            void patch({ scriptDescriptions: next });
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                          }}
                          className="max-w-full"
                          placeholder={t('shelf.preferences.scriptDescription')}
                        />
                      </span>
                    }
                  >
                    <Tool
                      label={t('shelf.preferences.removeScript')}
                      onClick={() => {
                        const descriptions = { ...settings.scriptDescriptions };
                        delete descriptions[path];
                        void patch({
                          scriptPaths: settings.scriptPaths.filter((value) => value !== path),
                          scriptDescriptions: descriptions,
                          favoriteActionIDs: (settings.favoriteActionIDs ?? []).filter(
                            (id) => id !== `script:${path}`,
                          ),
                        });
                      }}
                    >
                      <X size={14} />
                    </Tool>
                  </SettingRow>
                ))}
                <div className="px-3 py-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!isTauri()}
                    onClick={() => void addScripts()}
                  >
                    <Plus size={13} />
                    {t('shelf.preferences.addScript')}
                  </Button>
                </div>
                {toggle('scriptCopyOutput')}
                {toggle('scriptCloseOnSuccess')}
              </SettingsSection>
            </>
          ),
          cloud: (
            <>
              <ShelfSettingsPrimarySection>
                <fieldset disabled={settings.onlineDisabled} className="min-w-0">
                  {settings.cloudAccounts.length === 0 && !editor && (
                    <SettingsStatus>{t('shelf.preferences.noCloudAccounts')}</SettingsStatus>
                  )}
                  {settings.cloudAccounts.map((account) => (
                    <SettingRow
                      key={account.id}
                      icon={Cloud}
                      label={account.name}
                      description={t(`shelf.preferences.providers.${account.provider}`)}
                    >
                      <div className="flex items-center gap-0.5">
                        <Tool
                          label={t('common.edit')}
                          disabled={Boolean(editor)}
                          onClick={() => setEditor({ kind: 'cloud', value: account })}
                        >
                          <Pencil size={14} />
                        </Tool>
                        <Tool
                          label={t('shelf.preferences.deleteCredential')}
                          disabled={
                            Boolean(editor) || !state.credentialAccountIds?.includes(account.id)
                          }
                          onClick={() =>
                            void send({ action: 'deleteCredential', accountId: account.id })
                          }
                        >
                          <Trash2 size={14} />
                        </Tool>
                        <Tool
                          label={t('shelf.preferences.removeCloudAccount')}
                          disabled={Boolean(editor)}
                          onClick={() => void removeCloud(account)}
                        >
                          <X size={14} />
                        </Tool>
                      </div>
                    </SettingRow>
                  ))}
                  <div className="px-3 py-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={Boolean(editor)}
                      onClick={() => setEditor({ kind: 'cloud', value: newShelfCloud() })}
                    >
                      <Plus size={13} />
                      {t('shelf.preferences.addCloudAccount')}
                    </Button>
                  </div>
                  {editor?.kind === 'cloud' && (
                    <ShelfCloudEditor
                      key={editor.value.id}
                      initial={editor.value}
                      hasCredential={state.credentialAccountIds?.includes(editor.value.id) ?? false}
                      busy={busy}
                      onCancel={closeEditor}
                      onSave={saveCloud}
                    />
                  )}
                </fieldset>
              </ShelfSettingsPrimarySection>
              <SettingsSection title={t('shelf.preferences.shareHistory')}>
                <div className="flex items-center justify-between gap-2 px-3 pb-1">
                  <div className="flex items-center gap-1 text-xs">
                    {(['all', 'valid', 'expired'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={
                          historyFilter === value
                            ? 'rounded-md bg-xp-surface px-2 py-0.5 text-xp-text'
                            : 'rounded-md px-2 py-0.5 text-xp-text-secondary hover:text-xp-text'
                        }
                        onClick={() => setHistoryFilter(value)}
                      >
                        {t(`shelf.preferences.historyFilter.${value}`)}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs tabular-nums text-xp-text-secondary">
                    {filterShelfShareHistory(state.cloudHistory, historyFilter).length} /{' '}
                    {state.cloudHistory.length}
                  </span>
                </div>
                {state.cloudHistory.length === 0 && (
                  <SettingsStatus>{t('shelf.preferences.noShareHistory')}</SettingsStatus>
                )}
                {state.cloudHistory.length > 0 &&
                  filterShelfShareHistory(state.cloudHistory, historyFilter).length === 0 && (
                    <SettingsStatus>
                      {t('shelf.preferences.noShareHistoryForFilter')}
                    </SettingsStatus>
                  )}
                {filterShelfShareHistory(state.cloudHistory, historyFilter).map((record) => (
                  <div key={record.id} className="px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="font-medium text-xp-text">{record.accountName}</span>
                        {/* #64：链接来源标注（预签名 / 公开基址）；#67：到期状态。 */}
                        {record.linkSource && (
                          <span
                            className={
                              record.linkSource === 'presigned'
                                ? 'rounded-full border border-amber-500/40 px-1.5 text-[10px] text-amber-500'
                                : 'rounded-full border border-xp-border px-1.5 text-[10px] text-xp-text-secondary'
                            }
                          >
                            {t(
                              record.linkSource === 'presigned'
                                ? 'shelf.preferences.linkSourcePresigned'
                                : 'shelf.preferences.linkSourcePublicBase',
                            )}
                          </span>
                        )}
                        {isShelfShareExpired(record) && (
                          <span className="rounded-full border border-red-500/40 px-1.5 text-[10px] text-red-500">
                            {t('shelf.preferences.shareExpired')}
                          </span>
                        )}
                      </div>
                      <time className="tabular-nums text-xp-text-secondary">
                        {new Date(record.createdAt).toLocaleString(i18n.language)}
                      </time>
                    </div>
                    <p className="mt-1 text-xp-text-secondary">{record.message}</p>
                    {record.links.map((link) => (
                      <div key={link} className="mt-1 flex min-w-0 items-center gap-1">
                        <span
                          className="min-w-0 flex-1 truncate text-xp-text-secondary"
                          title={link}
                        >
                          {link}
                        </span>
                        <Tool
                          label={t('shelf.preferences.copyLink')}
                          disabled={!validShelfWebURL(link)}
                          onClick={() => void run(() => navigator.clipboard.writeText(link))}
                        >
                          <Copy size={13} />
                        </Tool>
                        <Tool
                          label={t('shelf.preferences.openLink')}
                          disabled={!validShelfWebURL(link)}
                          onClick={() => void run(() => TauriAPI.openUrl(link))}
                        >
                          <ExternalLink size={13} />
                        </Tool>
                      </div>
                    ))}
                    {/* #67：从列表删除人人可用；删除并撤销按提供商能力开放。 */}
                    <div className="mt-1 flex items-center gap-2">
                      <button
                        type="button"
                        className="text-xp-text-secondary hover:text-xp-text"
                        disabled={busy || revokingRecordId !== null}
                        onClick={() =>
                          void send({ action: 'removeCloudRecord', recordId: record.id })
                        }
                      >
                        {t('shelf.preferences.removeRecord')}
                      </button>
                      {shelfShareCanRevoke(record, liveSettings.current?.cloudAccounts ?? []) && (
                        <button
                          type="button"
                          className={
                            revokeConfirmId === record.id
                              ? 'text-red-500'
                              : 'text-xp-text-secondary hover:text-red-500'
                          }
                          disabled={busy || revokingRecordId !== null}
                          onClick={() => {
                            if (revokeConfirmId === record.id) {
                              setRevokeConfirmId(null);
                              setRevokingRecordId(record.id);
                              void send({ action: 'revokeCloudRecord', recordId: record.id });
                            } else {
                              setRevokeConfirmId(record.id);
                            }
                          }}
                        >
                          {(() => {
                            if (revokingRecordId === record.id) {
                              return t('shelf.preferences.revokingRecord');
                            }
                            return revokeConfirmId === record.id
                              ? t('shelf.preferences.revokeRecordConfirm')
                              : t('shelf.preferences.revokeRecord');
                          })()}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </SettingsSection>
            </>
          ),
          customActions: (
            <ShelfSettingsPrimarySection>
              {settings.customActions.length === 0 && !editor && (
                <SettingsStatus>{t('shelf.preferences.noCustomActions')}</SettingsStatus>
              )}
              {settings.customActions.map((action) => (
                <SettingRow
                  key={action.id}
                  icon={UserRound}
                  label={action.name}
                  description={t(`shelf.preferences.actionKinds.${action.kind}`)}
                >
                  <div className="flex items-center gap-0.5">
                    <Tool
                      label={t('common.edit')}
                      disabled={Boolean(editor)}
                      onClick={() => setEditor({ kind: 'action', value: action })}
                    >
                      <Pencil size={14} />
                    </Tool>
                    <Tool
                      label={t('shelf.preferences.removeCustomAction')}
                      disabled={Boolean(editor)}
                      onClick={() =>
                        void patch({
                          customActions: settings.customActions.filter(
                            (item) => item.id !== action.id,
                          ),
                          instantActionIDs: settings.instantActionIDs.filter(
                            (id) => id !== `preset:${action.id}`,
                          ),
                          favoriteActionIDs: (settings.favoriteActionIDs ?? []).filter(
                            (id) => id !== `preset:${action.id}`,
                          ),
                        })
                      }
                    >
                      <X size={14} />
                    </Tool>
                  </div>
                </SettingRow>
              ))}
              {/* #76：最爱操作（≤5）——架子动作菜单的置顶分组。 */}
              <div className="px-3 pt-2">
                <p className="text-xs font-medium text-xp-text">
                  {t('shelf.preferences.favoriteActions')}
                </p>
                <p className="mt-0.5 text-xs text-xp-text-secondary">
                  {t('shelf.preferences.favoriteActionsHint')}
                </p>
                <div className="mt-1.5 flex max-h-44 flex-col gap-1 overflow-y-auto pr-1">
                  {choices.map((choice) => {
                    const active = (settings.favoriteActionIDs ?? []).includes(choice.id);
                    return (
                      <label
                        key={choice.id}
                        className="flex cursor-pointer items-center gap-2 text-xs text-xp-text"
                      >
                        <input
                          type="checkbox"
                          checked={active}
                          disabled={!active && (settings.favoriteActionIDs ?? []).length >= 5}
                          onChange={() => toggleFavorite(choice.id)}
                          className="accent-[var(--ds-accent)]"
                        />
                        <Star
                          size={12}
                          className={
                            active ? 'fill-current text-amber-400' : 'text-xp-text-secondary'
                          }
                        />
                        <span className="truncate">{choice.title}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs tabular-nums text-xp-text-secondary">
                  {(settings.favoriteActionIDs ?? []).length}/5
                </p>
              </div>
              <div className="px-3 py-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={Boolean(editor)}
                  onClick={() => setEditor({ kind: 'action', value: newShelfAction() })}
                >
                  <Plus size={13} />
                  {t('shelf.preferences.addCustomAction')}
                </Button>
              </div>
              {editor?.kind === 'action' && (
                <ShelfActionEditor
                  key={editor.value.id}
                  initial={editor.value}
                  busy={busy}
                  onCancel={closeEditor}
                  onSave={saveAction}
                />
              )}
            </ShelfSettingsPrimarySection>
          ),
          instantActions: (
            <ShelfSettingsPrimarySection>
              {toggle('instantActionsEnabled')}
              {settings.instantActionIDs.map((id, index) => (
                <SettingRow
                  key={id}
                  icon={Zap}
                  label={
                    choices.find((choice) => choice.id === id)?.title ??
                    t('shelf.preferences.invalidAction')
                  }
                >
                  <div className="flex items-center gap-0.5">
                    <Tool
                      label={t('shelf.preferences.moveUp')}
                      disabled={index === 0 || !settings.instantActionsEnabled}
                      onClick={() =>
                        void patch({
                          instantActionIDs: moveShelfChoice(settings.instantActionIDs, index, -1),
                        })
                      }
                    >
                      <ArrowUp size={14} />
                    </Tool>
                    <Tool
                      label={t('shelf.preferences.moveDown')}
                      disabled={
                        index === settings.instantActionIDs.length - 1 ||
                        !settings.instantActionsEnabled
                      }
                      onClick={() =>
                        void patch({
                          instantActionIDs: moveShelfChoice(settings.instantActionIDs, index, 1),
                        })
                      }
                    >
                      <ArrowDown size={14} />
                    </Tool>
                    <Tool
                      label={t('shelf.preferences.removeInstantAction')}
                      disabled={!settings.instantActionsEnabled}
                      onClick={() =>
                        void patch({
                          instantActionIDs: settings.instantActionIDs.filter(
                            (value) => value !== id,
                          ),
                        })
                      }
                    >
                      <X size={14} />
                    </Tool>
                  </div>
                </SettingRow>
              ))}
              <SettingRow icon={Plus} label={t('shelf.preferences.addInstantAction')}>
                <fieldset
                  disabled={
                    settings.instantActionIDs.length >= 6 || !settings.instantActionsEnabled
                  }
                >
                  <SelectField
                    value="add"
                    label={t('shelf.preferences.addInstantAction')}
                    onChange={(id) => {
                      if (id !== 'add') {
                        void patch({ instantActionIDs: [...settings.instantActionIDs, id] });
                      }
                    }}
                    options={[
                      { value: 'add', label: t('shelf.preferences.chooseAction') },
                      ...choices
                        .filter((choice) => !settings.instantActionIDs.includes(choice.id))
                        .map((choice) => ({ value: choice.id, label: choice.title })),
                    ]}
                  />
                </fieldset>
              </SettingRow>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs tabular-nums text-xp-text-secondary">
                  {settings.instantActionIDs.length}/6
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void patch({ instantActionIDs: ['airdrop', 'messages', 'mail', 'cloud'] })
                  }
                >
                  <RotateCcw size={13} />
                  {t('shelf.preferences.restoreInstantActions')}
                </Button>
              </div>
            </ShelfSettingsPrimarySection>
          ),
          watching: (
            <>
              <ShelfSettingsPrimarySection>
                {settings.watchedFolders.length === 0 && !editor && (
                  <SettingsStatus>{t('shelf.preferences.noWatchedFolders')}</SettingsStatus>
                )}
                {settings.watchedFolders.map((folder) => {
                  // #33：三态徽标——error 来自引擎实时上报，stopped 由开关推导。
                  const status =
                    state.watchedFolderStates?.[folder.id] ??
                    (folder.enabled ? 'active' : 'stopped');
                  const badge = watchStatusBadge(status, (key) =>
                    t(`shelf.preferences.watchStatus.${key}`),
                  );
                  return (
                    <SettingRow
                      key={folder.id}
                      icon={FolderSync}
                      label={
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="break-all">
                            {folder.path.split('/').filter(Boolean).at(-1) || folder.path}
                          </span>
                          <span
                            data-watch-status={badge.tone}
                            className="whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium"
                          >
                            {badge.label}
                          </span>
                        </span>
                      }
                      description={<span className="break-all">{folder.path}</span>}
                    >
                      <div className="flex items-center gap-1">
                        {status === 'error' && (
                          <Tool
                            label={t('shelf.preferences.reselectFolder')}
                            disabled={Boolean(editor)}
                            onClick={() => setEditor({ kind: 'watch', value: folder })}
                          >
                            <RotateCcw size={14} />
                          </Tool>
                        )}
                        <Toggle
                          id={`shelf-watch-${folder.id}`}
                          label={t('shelf.preferences.watchEnabled')}
                          checked={folder.enabled}
                          onChange={(enabled) =>
                            void patch({
                              watchedFolders: settings.watchedFolders.map((item) =>
                                item.id === folder.id ? { ...item, enabled } : item,
                              ),
                            })
                          }
                        />
                        <Tool
                          label={t('shelf.preferences.editWatchRule')}
                          disabled={Boolean(editor)}
                          onClick={() => setEditor({ kind: 'watch', value: folder })}
                        >
                          <Pencil size={14} />
                        </Tool>
                        <Tool
                          label={t('shelf.preferences.removeWatch')}
                          disabled={Boolean(editor)}
                          onClick={() =>
                            void patch({
                              watchedFolders: settings.watchedFolders.filter(
                                (item) => item.id !== folder.id,
                              ),
                            })
                          }
                        >
                          <X size={14} />
                        </Tool>
                      </div>
                    </SettingRow>
                  );
                })}
                <div className="px-3 py-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={Boolean(editor)}
                    onClick={() => setEditor({ kind: 'watch', value: newShelfWatchedFolder() })}
                  >
                    <Plus size={13} />
                    {t('shelf.preferences.addWatchedFolder')}
                  </Button>
                </div>
                {editor?.kind === 'watch' && (
                  <ShelfWatchEditor
                    key={editor.value.id}
                    initial={editor.value}
                    busy={busy}
                    onCancel={closeEditor}
                    onSave={saveWatch}
                  />
                )}
              </ShelfSettingsPrimarySection>
              <SettingsSection title={t('shelf.preferences.screenshots')}>
                <SettingRow
                  icon={Camera}
                  label={t('shelf.preferences.fields.screenshotMonitoringEnabled')}
                >
                  <Toggle
                    id="shelf-screenshot-monitor"
                    checked={settings.screenshotMonitoringEnabled}
                    disabled={!settings.screenshotDirectory}
                    onChange={(value) => void patch({ screenshotMonitoringEnabled: value })}
                  />
                </SettingRow>
                <SettingRow icon={FolderOpen} label={t('shelf.preferences.folder')}>
                  <ShelfPathInput
                    label={t('shelf.preferences.chooseFolder')}
                    value={settings.screenshotDirectory}
                    commitOnBlur
                    onChange={(value) =>
                      void patch({
                        screenshotDirectory: value,
                        ...(!value ? { screenshotMonitoringEnabled: false } : {}),
                      })
                    }
                    onError={setLocalError}
                  />
                </SettingRow>
                {select('screenshotAdditionBehavior', ['current', 'new'])}
                {/* #34：「拍一张试试」两步验证 + 禁用系统浮动缩略图的深链指引。 */}
                <SettingRow
                  icon={Camera}
                  label={t('shelf.preferences.screenshotTest')}
                  description={t('shelf.preferences.screenshotTestHint')}
                >
                  <div className="flex items-center gap-2">
                    {screenshotTest === 'success' && (
                      <span className="text-xs text-emerald-400">
                        {t('shelf.preferences.screenshotTestSuccess')}
                      </span>
                    )}
                    {screenshotTest === 'failed' && (
                      <span className="text-xs text-amber-400">
                        {t('shelf.preferences.screenshotTestFailed')}
                      </span>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={
                        !settings.screenshotMonitoringEnabled || !settings.screenshotDirectory
                      }
                      onClick={() => void beginScreenshotTest()}
                    >
                      {screenshotTest === 'waiting'
                        ? t('shelf.preferences.screenshotTestWaiting')
                        : t('shelf.preferences.screenshotTest')}
                    </Button>
                  </div>
                </SettingRow>
                <SettingRow
                  icon={CloudOff}
                  label={t('shelf.preferences.thumbnailHint')}
                  description={t('shelf.preferences.thumbnailHintDetail')}
                >
                  <div className="flex items-center gap-0.5">
                    <Tool
                      label={t('shelf.preferences.openSystemSettings')}
                      onClick={() => void send({ action: 'openScreenshotSettings' })}
                    >
                      <ExternalLink size={14} />
                    </Tool>
                    <Tool
                      label={
                        copiedCommand
                          ? t('shelf.preferences.commandCopied')
                          : t('shelf.preferences.copyCommand')
                      }
                      onClick={() => void copyThumbnailCommand()}
                    >
                      {copiedCommand ? <Check size={14} /> : <Copy size={14} />}
                    </Tool>
                  </div>
                </SettingRow>
              </SettingsSection>
            </>
          ),
        }}
      />
      {auxiliary && (
        <Dialog
          open
          maxWidth={520}
          onOpenChange={(open) => {
            if (!open) {
              setAuxiliary(undefined);
              if (recordingRef.current) void stopRecording();
            }
          }}
        >
          <div className="wisp-shelf-preferences wisp-shelf-auxiliary">
            <header className="wisp-shelf-auxiliary-header">
              <DialogTitle>
                {t(
                  auxiliary === 'shortcuts'
                    ? 'shelf.preferences.keyboard'
                    : 'shelf.preferences.ignoredApps',
                )}
              </DialogTitle>
              <Tool
                label={t('common.close')}
                onClick={() => {
                  setAuxiliary(undefined);
                  if (recordingRef.current) void stopRecording();
                }}
              >
                <X size={14} />
              </Tool>
            </header>
            <div className="wisp-shelf-auxiliary-body">
              {(localError || error) && (
                <SettingsStatus error>{localError || error}</SettingsStatus>
              )}
              {recording && (
                <div className="wisp-shelf-shortcut-recording">
                  <Button
                    variant="secondary"
                    onKeyDown={(event) => void capture(event)}
                    autoFocus
                    data-autofocus
                    aria-label={t('shelf.preferences.recording')}
                  >
                    <Keyboard size={14} />
                    {t('shelf.preferences.recording')}
                  </Button>
                  <Tool label={t('common.cancel')} onClick={() => void stopRecording()}>
                    <X size={14} />
                  </Tool>
                </div>
              )}
              <fieldset disabled={busy || Boolean(recording)}>
                {auxiliary === 'shortcuts' ? (
                  <>
                    <SettingsSection title={t('shelf.preferences.globalShortcuts')}>
                      {displayShortcutRows(settings.shortcutBindings, false)}
                    </SettingsSection>
                    <SettingsSection title={t('shelf.preferences.localShortcuts')}>
                      {displayShortcutRows(settings.localShortcutBindings, true)}
                    </SettingsSection>
                  </>
                ) : (
                  <>
                    <SettingsSection title={t('shelf.preferences.ignoredApps')}>
                      {settings.ignoredApps.length === 0 && (
                        <SettingsStatus>{t('shelf.preferences.noIgnoredApps')}</SettingsStatus>
                      )}
                      {settings.ignoredApps.map((identifier) => (
                        <SettingRow
                          key={identifier}
                          icon={AppWindow}
                          label={<span className="break-all">{identifier}</span>}
                        >
                          <Tool
                            label={t('shelf.preferences.removeIgnoredApp')}
                            onClick={() =>
                              void patch({
                                ignoredApps: settings.ignoredApps.filter(
                                  (value) => value !== identifier,
                                ),
                              })
                            }
                          >
                            <X size={14} />
                          </Tool>
                        </SettingRow>
                      ))}
                      <div className="px-3 py-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!isTauri()}
                          onClick={() => void send({ action: 'selectIgnoredApplications' })}
                        >
                          <Plus size={13} />
                          {t('shelf.preferences.addIgnoredApp')}
                        </Button>
                      </div>
                    </SettingsSection>
                  </>
                )}
              </fieldset>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
};

export default ShelfSettings;
