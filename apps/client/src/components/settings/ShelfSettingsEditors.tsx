import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Save, X } from 'lucide-react';
import { TauriAPI } from '@/lib/tauri-api';
import { isTauri } from '@/lib/transport';
import type { ShelfCloudTestResult } from '@wisp/sdk';
import { Button } from '@/components/ui/button';
import { SettingInput, SettingRow, SelectField, SettingsStatus, Toggle } from './shared';
import {
  SHELF_ACTION_KINDS,
  SHELF_CLOUD_PROVIDERS,
  SHELF_FILE_TYPES,
  SHELF_PRESIGN_EXPIRY,
  normalizedShelfPathTemplate,
  normalizedShelfPresignExpiry,
  parseShelfExtensions,
  shelfID,
  shelfPathTemplateErrorKey,
  validShelfWebURL,
  type ShelfActionPreset,
  type ShelfCloudAccount,
  type ShelfWatchedFolder,
} from './shelf-settings-helpers';

interface EditorProps {
  busy: boolean;
  onCancel: () => void;
}

const Editor = ({
  title,
  error,
  busy,
  onCancel,
  onSubmit,
  children,
}: EditorProps & {
  title: string;
  error?: string;
  onSubmit: () => void;
  children: ReactNode;
}) => {
  const { t } = useTranslation();
  return (
    <form
      className="mt-2 border-t border-xp-border pt-3"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <h4 className="px-3 pb-2 text-[13px] font-semibold text-xp-text">{title}</h4>
      <fieldset disabled={busy} className="min-w-0">
        {children}
        {error && <SettingsStatus error>{error}</SettingsStatus>}
        <div className="flex justify-end gap-2 px-3 pb-3 pt-3">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            <X size={13} />
            {t('common.cancel')}
          </Button>
          <Button type="submit" size="sm">
            <Save size={13} />
            {t(busy ? 'common.saving' : 'common.save')}
          </Button>
        </div>
      </fieldset>
    </form>
  );
};

export const ShelfPathInput = ({
  value,
  onChange,
  label,
  directory = true,
  multiple = false,
  commitOnBlur = false,
  onError,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  directory?: boolean;
  multiple?: boolean;
  commitOnBlur?: boolean;
  onError?: (message: string) => void;
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const choose = async () => {
    try {
      const paths = await TauriAPI.showOpenDialog({ directory, multiple });
      if (paths?.[0]) {
        setDraft(paths[0]);
        onChange(paths[0]);
      }
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className="flex w-52 max-w-full items-center gap-1">
      <SettingInput
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          if (!commitOnBlur) onChange(event.target.value);
        }}
        onBlur={() => {
          if (commitOnBlur && draft !== value) onChange(draft);
        }}
        onKeyDown={(event) => {
          if (commitOnBlur && event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        className="min-w-0 flex-1"
      />
      <Button
        variant="ghost"
        size="sm"
        className="w-7 px-0"
        aria-label={label}
        title={label}
        disabled={!isTauri()}
        onClick={() => void choose()}
      >
        <FolderOpen size={14} />
      </Button>
      {!isTauri() && <span className="sr-only">{t('shelf.preferences.desktopRequired')}</span>}
    </div>
  );
};

export const ShelfActionEditor = ({
  initial,
  busy,
  onCancel,
  onSave,
}: EditorProps & {
  initial: ShelfActionPreset;
  onSave: (action: ShelfActionPreset) => Promise<boolean>;
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string>();
  const field = <K extends keyof ShelfActionPreset>(key: K, value: ShelfActionPreset[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));
  const image = ['resizeImages', 'compressImages', 'convertImages', 'stitchImages'].includes(
    draft.kind,
  );
  const size = ['resizeImages', 'stitchImages'].includes(draft.kind);
  const output =
    image || ['archive', 'imagePDF', 'extractText', 'mergePDFs', 'protectPDF'].includes(draft.kind);
  const passwordProtected = ['archive', 'protectPDF'].includes(draft.kind);
  const renameMode = draft.renameMode === 'replace' ? 'replace' : 'template';
  const resizeMode = ['fit', 'percent'].includes(draft.resizeMode ?? '')
    ? (draft.resizeMode as 'fit' | 'percent')
    : 'edge';
  const save = async () => {
    const normalized = {
      ...draft,
      name: draft.name.trim(),
      destination: draft.destination.trim(),
      application: draft.application.trim(),
    };
    let message: string | undefined;
    if (!normalized.name) message = 'nameRequired';
    else if (['copy', 'move'].includes(draft.kind) && !normalized.destination) {
      message = 'destinationRequired';
    } else if (draft.kind === 'openApp' && !normalized.application) message = 'applicationRequired';
    else if (
      draft.kind === 'rename' &&
      renameMode === 'replace' &&
      !(draft.findText ?? '').trim()
    ) {
      message = 'findTextRequired';
    } else if (draft.kind === 'rename' && renameMode === 'template' && !draft.nameTemplate.trim()) {
      message = 'templateRequired';
    } else if (
      draft.kind === 'rename' &&
      renameMode === 'template' &&
      (!Number.isInteger(draft.counterStart ?? 1) ||
        (draft.counterStart ?? 1) < 1 ||
        (draft.counterStart ?? 1) > 999999)
    ) {
      message = 'invalidCounterStart';
    } else if (size && (!Number.isInteger(draft.width) || draft.width < 1 || draft.width > 16384)) {
      message = 'invalidSize';
    } else if (
      draft.kind === 'resizeImages' &&
      resizeMode === 'fit' &&
      (!Number.isInteger(draft.maxWidth ?? 1600) ||
        !Number.isInteger(draft.maxHeight ?? 1600) ||
        (draft.maxWidth ?? 1600) < 1 ||
        (draft.maxWidth ?? 1600) > 16384 ||
        (draft.maxHeight ?? 1600) < 1 ||
        (draft.maxHeight ?? 1600) > 16384)
    ) {
      message = 'invalidSize';
    } else if (
      draft.kind === 'resizeImages' &&
      resizeMode === 'percent' &&
      (!Number.isInteger(draft.scalePercent ?? 100) ||
        (draft.scalePercent ?? 100) < 1 ||
        (draft.scalePercent ?? 100) > 1000)
    ) {
      message = 'invalidPercent';
    }
    if (message) {
      setError(t(`shelf.preferences.errors.${message}`));
      return;
    }
    setError(undefined);
    await onSave(normalized);
  };
  // #40：与引擎同源的改名预览（示例文件，只读预览条）。
  const previewNames = ['照片 A.jpg', '照片 B.png'];
  const previews = previewNames.map((sample, index) => {
    const stem = sample.replace(/\.[^.]+$/, '');
    const extension = sample.slice(stem.length);
    let next: string;
    if (renameMode === 'replace') {
      const find = draft.findText ?? '';
      const replacement = draft.replaceText ?? '';
      if (draft.caseSensitive) {
        next = stem.split(find).join(replacement);
      } else if (find) {
        const pattern = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        next = stem.replace(new RegExp(pattern, 'gi'), replacement);
      } else {
        next = stem;
      }
    } else {
      next = (draft.nameTemplate || '{name}-{n}')
        .replaceAll('{name}', stem)
        .replaceAll('{n}', String((draft.counterStart ?? 1) + index))
        .replaceAll('{date}', new Date().toISOString().slice(0, 10).replaceAll('-', ''));
    }
    return { current: sample, next: next + extension };
  });
  return (
    <Editor
      title={t('shelf.preferences.customActions')}
      error={error}
      busy={busy}
      onCancel={onCancel}
      onSubmit={() => void save()}
    >
      <SettingRow label={t('shelf.preferences.name')}>
        <SettingInput
          value={draft.name}
          onChange={(event) => field('name', event.target.value)}
          className="w-52"
          autoFocus
        />
      </SettingRow>
      <SettingRow label={t('shelf.preferences.action')}>
        <SelectField
          value={draft.kind}
          onChange={(value) => field('kind', value as ShelfActionPreset['kind'])}
          options={SHELF_ACTION_KINDS.map((value) => ({
            value,
            label: t(`shelf.preferences.actionKinds.${value}`),
          }))}
        />
      </SettingRow>
      {(['copy', 'move'].includes(draft.kind) || output) && (
        <SettingRow
          label={t(output ? 'shelf.preferences.outputFolder' : 'shelf.preferences.destination')}
        >
          <ShelfPathInput
            label={t('shelf.preferences.chooseFolder')}
            value={draft.destination}
            onChange={(value) => field('destination', value)}
            onError={setError}
          />
        </SettingRow>
      )}
      {draft.kind === 'openApp' && (
        <SettingRow label={t('shelf.preferences.application')}>
          <ShelfPathInput
            label={t('shelf.preferences.chooseApplication')}
            value={draft.application}
            directory={false}
            onChange={(value) => field('application', value)}
            onError={setError}
          />
        </SettingRow>
      )}
      {draft.kind === 'rename' && (
        <SettingRow label={t('shelf.preferences.renameMode')}>
          <SelectField
            value={renameMode}
            onChange={(value) => field('renameMode', value)}
            options={['template', 'replace'].map((value) => ({
              value,
              label: t(`shelf.preferences.renameModes.${value}`),
            }))}
          />
        </SettingRow>
      )}
      {draft.kind === 'rename' && renameMode === 'replace' && (
        <>
          <SettingRow label={t('shelf.preferences.findText')}>
            <SettingInput
              value={draft.findText ?? ''}
              onChange={(event) => field('findText', event.target.value)}
              className="w-52"
            />
          </SettingRow>
          <SettingRow label={t('shelf.preferences.replaceText')}>
            <SettingInput
              value={draft.replaceText ?? ''}
              onChange={(event) => field('replaceText', event.target.value)}
              className="w-52"
            />
          </SettingRow>
          <SettingRow label={t('shelf.preferences.caseSensitive')}>
            <Toggle
              id="shelf-action-case-sensitive"
              checked={Boolean(draft.caseSensitive)}
              onChange={(value) => field('caseSensitive', value)}
            />
          </SettingRow>
        </>
      )}
      {draft.kind === 'rename' && renameMode === 'template' && (
        <>
          <SettingRow label={t('shelf.preferences.nameTemplate')}>
            <SettingInput
              value={draft.nameTemplate}
              onChange={(event) => field('nameTemplate', event.target.value)}
              className="w-52"
              placeholder="{name}-{n}"
            />
          </SettingRow>
          <SettingRow label={t('shelf.preferences.counterStart')}>
            <SettingInput
              type="number"
              min={1}
              max={999999}
              step={1}
              value={draft.counterStart ?? 1}
              onChange={(event) => field('counterStart', Number(event.target.value))}
              className="w-24 tabular-nums"
            />
          </SettingRow>
        </>
      )}
      {draft.kind === 'rename' && (
        <div className="px-3 py-2">
          <div className="rounded-md border border-xp-border bg-xp-surface px-3 py-2 text-xs text-xp-text-secondary">
            <p className="mb-1 font-medium">{t('shelf.preferences.renamePreview')}</p>
            {previews.map((row) => (
              <p key={row.current} className="truncate">
                <span>{row.current}</span>
                <span className="mx-1.5 text-xp-text-secondary">→</span>
                <span className={row.next === row.current ? 'text-xp-text-secondary' : ''}>
                  {row.next}
                </span>
              </p>
            ))}
          </div>
        </div>
      )}
      {draft.kind === 'archive' && (
        <SettingRow label={t('shelf.preferences.nameTemplate')}>
          <SettingInput
            value={draft.nameTemplate}
            onChange={(event) => field('nameTemplate', event.target.value)}
            className="w-52"
          />
        </SettingRow>
      )}
      {passwordProtected && (
        <SettingRow label={t('shelf.preferences.password')}>
          <SettingInput
            type="password"
            value={draft.password ?? ''}
            onChange={(event) => field('password', event.target.value)}
            className="w-52"
            placeholder={
              draft.kind === 'archive' ? t('shelf.preferences.optionalPassword') : undefined
            }
          />
        </SettingRow>
      )}
      {draft.kind === 'resizeImages' && (
        <SettingRow label={t('shelf.preferences.resizeMode')}>
          <SelectField
            value={resizeMode}
            onChange={(value) => field('resizeMode', value)}
            options={['edge', 'fit', 'percent'].map((value) => ({
              value,
              label: t(`shelf.preferences.resizeModes.${value}`),
            }))}
          />
        </SettingRow>
      )}
      {draft.kind === 'resizeImages' && resizeMode === 'fit' && (
        <SettingRow label={t('shelf.preferences.maxDimensions')}>
          <div className="flex items-center gap-1.5">
            <SettingInput
              type="number"
              min={1}
              max={16384}
              step={1}
              value={draft.maxWidth ?? 1600}
              onChange={(event) => field('maxWidth', Number(event.target.value))}
              className="w-20 tabular-nums"
            />
            <span className="text-xs text-xp-text-secondary">×</span>
            <SettingInput
              type="number"
              min={1}
              max={16384}
              step={1}
              value={draft.maxHeight ?? 1600}
              onChange={(event) => field('maxHeight', Number(event.target.value))}
              className="w-20 tabular-nums"
            />
          </div>
        </SettingRow>
      )}
      {draft.kind === 'resizeImages' && resizeMode === 'percent' && (
        <SettingRow label={t('shelf.preferences.scalePercent')}>
          <SettingInput
            type="number"
            min={1}
            max={1000}
            step={1}
            value={draft.scalePercent ?? 100}
            onChange={(event) => field('scalePercent', Number(event.target.value))}
            className="w-20 tabular-nums"
          />
        </SettingRow>
      )}
      {size && resizeMode !== 'fit' && resizeMode !== 'percent' && (
        <SettingRow label={t('shelf.preferences.imageWidth')}>
          <SettingInput
            type="number"
            min={1}
            max={16384}
            step={1}
            value={draft.width}
            onChange={(event) => field('width', Number(event.target.value))}
            className="w-24 tabular-nums"
          />
        </SettingRow>
      )}
      {image && (
        <SettingRow label={t('shelf.preferences.imageFormat')}>
          <SelectField
            value={draft.format}
            onChange={(value) => field('format', value)}
            options={['jpeg', 'png', 'tiff', 'heic'].map((value) => ({
              value,
              label: t(`shelf.preferences.formats.${value}`),
            }))}
          />
        </SettingRow>
      )}
      {image && ['jpg', 'jpeg', 'heic'].includes(draft.format.toLowerCase()) && (
        <SettingRow label={t('shelf.preferences.quality')}>
          <div className="flex w-48 max-w-full items-center gap-2">
            <input
              type="range"
              aria-label={t('shelf.preferences.quality')}
              min={0.1}
              max={1}
              step={0.05}
              value={draft.quality}
              onChange={(event) => field('quality', Number(event.target.value))}
              className="min-w-0 flex-1 accent-[var(--ds-accent)]"
            />
            <span className="w-9 text-right text-xs tabular-nums">
              {Math.round(draft.quality * 100)}%
            </span>
          </div>
        </SettingRow>
      )}
      {output && draft.kind !== 'extractText' && (
        <SettingRow label={t('shelf.preferences.afterOutput')}>
          <SelectField
            value={draft.afterOutput ?? 'keep'}
            onChange={(value) => field('afterOutput', value)}
            options={['keep', 'replace', 'newShelf', 'reveal'].map((value) => ({
              value,
              label: t(`shelf.preferences.afterOutputs.${value}`),
            }))}
          />
        </SettingRow>
      )}
    </Editor>
  );
};

export const ShelfWatchEditor = ({
  initial,
  busy,
  onCancel,
  onSave,
}: EditorProps & {
  initial: ShelfWatchedFolder;
  onSave: (folder: ShelfWatchedFolder) => Promise<boolean>;
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const [extensions, setExtensions] = useState(initial.extensions.join(', '));
  const [error, setError] = useState<string>();
  const field = <K extends keyof ShelfWatchedFolder>(key: K, value: ShelfWatchedFolder[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));
  const save = async () => {
    const suffixes = parseShelfExtensions(extensions);
    let message: string | undefined;
    if (!draft.path.trim()) message = 'folderRequired';
    else if (
      !Number.isFinite(draft.collectionDelay) ||
      draft.collectionDelay < 0.5 ||
      draft.collectionDelay > 30
    ) {
      message = 'invalidDelay';
    } else if (suffixes.some((suffix) => !/^[a-z0-9._+-]+$/i.test(suffix))) {
      message = 'invalidExtensions';
    }
    if (message) {
      setError(t(`shelf.preferences.errors.${message}`));
      return;
    }
    setError(undefined);
    await onSave({ ...draft, path: draft.path.trim(), extensions: suffixes });
  };
  return (
    <Editor
      title={t('shelf.preferences.watchRule')}
      error={error}
      busy={busy}
      onCancel={onCancel}
      onSubmit={() => void save()}
    >
      <SettingRow label={t('shelf.preferences.folder')}>
        <ShelfPathInput
          label={t('shelf.preferences.chooseFolder')}
          value={draft.path}
          onChange={(value) => field('path', value)}
          onError={setError}
        />
      </SettingRow>
      <SettingRow label={t('shelf.preferences.watchEnabled')}>
        <Toggle
          id={`watch-${draft.id}`}
          checked={draft.enabled}
          onChange={(value) => field('enabled', value)}
        />
      </SettingRow>
      <SettingRow label={t('shelf.preferences.fileType')}>
        <SelectField
          value={draft.fileType}
          onChange={(value) => field('fileType', value as ShelfWatchedFolder['fileType'])}
          options={SHELF_FILE_TYPES.map((value) => ({
            value,
            label: t(`shelf.preferences.fileTypes.${value}`),
          }))}
        />
      </SettingRow>
      <SettingRow label={t('shelf.preferences.extensions')}>
        <SettingInput
          value={extensions}
          onChange={(event) => setExtensions(event.target.value)}
          className="w-52"
          placeholder={t('shelf.preferences.allExtensions')}
        />
      </SettingRow>
      <SettingRow label={t('shelf.preferences.nameCondition')}>
        <SelectField
          value={draft.nameCondition ?? 'any'}
          onChange={(value) => field('nameCondition', value)}
          options={['any', 'contains', 'startsWith'].map((value) => ({
            value,
            label: t(`shelf.preferences.nameConditions.${value}`),
          }))}
        />
      </SettingRow>
      {draft.nameCondition !== 'any' && (
        <SettingRow label={t('shelf.preferences.nameText')}>
          <SettingInput
            value={draft.nameText ?? ''}
            onChange={(event) => field('nameText', event.target.value)}
            className="w-52"
            placeholder={t('shelf.preferences.nameTextPlaceholder')}
          />
        </SettingRow>
      )}
      <SettingRow
        label={t('shelf.preferences.perFileNewShelf')}
        description={t('shelf.preferences.perFileNewShelfHint')}
      >
        <Toggle
          id={`watch-per-file-${draft.id}`}
          checked={Boolean(draft.perFileNewShelf)}
          onChange={(value) => field('perFileNewShelf', value)}
        />
      </SettingRow>
      <SettingRow label={t('shelf.preferences.delay')}>
        <SettingInput
          type="number"
          min={0.5}
          max={30}
          step={0.5}
          value={draft.collectionDelay}
          onChange={(event) => field('collectionDelay', Number(event.target.value))}
          className="w-24 tabular-nums"
        />
      </SettingRow>
    </Editor>
  );
};

// #66：三步状态 → 图标与颜色的查表（避免嵌套三元，未到/跳过的步骤统一灰色空心）。
const STEP_TONE_BY_STATUS: Record<string, string> = {
  passed: 'text-emerald-500',
  failed: 'text-red-500',
};
const STEP_GLYPH_BY_STATUS: Record<string, string> = {
  passed: '✓',
  failed: '✗',
};

export const ShelfCloudEditor = ({
  initial,
  busy,
  hasCredential,
  onCancel,
  onSave,
}: EditorProps & {
  initial: ShelfCloudAccount;
  hasCredential: boolean;
  onSave: (account: ShelfCloudAccount, secret?: string) => Promise<boolean>;
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const [secret, setSecret] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [error, setError] = useState<string>();
  // #66：三步测试连接（上传→列出→删除）跑在引擎侧，结果经事件回传。
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ShelfCloudTestResult | null>(null);
  const identityChanged =
    draft.provider !== initial.provider || draft.endpoint.trim() !== initial.endpoint.trim();
  useEffect(() => {
    let active = true;
    let release: (() => void) | undefined;
    void TauriAPI.listenToShelfCloudTest((result: ShelfCloudTestResult) => {
      if (active && result.accountId === initial.id) {
        setTestResult(result);
        setTesting(false);
      }
    }).then((stop) => {
      if (active) release = stop;
      else stop();
    });
    return () => {
      active = false;
      release?.();
    };
  }, [initial.id]);
  const field = <K extends keyof ShelfCloudAccount>(key: K, value: ShelfCloudAccount[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    if (key === 'provider' || key === 'endpoint') {
      setSecret('');
      setAccessKey('');
      setSessionToken('');
    }
  };
  const runConnectionTest = async () => {
    setError(undefined);
    setTesting(true);
    setTestResult(null);
    try {
      await TauriAPI.shelfRequest({ action: 'testCloudAccount', accountId: initial.id });
    } catch (requestError) {
      setTesting(false);
      setError(String(requestError));
    }
  };
  const save = async () => {
    const account = {
      ...draft,
      name: draft.name.trim(),
      endpoint: draft.endpoint.trim(),
      publicBaseURL: draft.publicBaseURL.trim(),
    };
    let message: string | undefined;
    if (!account.name) message = 'nameRequired';
    else if (
      [account.endpoint, account.publicBaseURL].some(
        (address) => address && !validShelfWebURL(address),
      )
    ) {
      message = 'invalidURL';
    } else if (account.provider !== 'icloud' && identityChanged && hasCredential && !secret) {
      message = 'credentialRequired';
    } else if (account.provider === 's3' && Boolean(accessKey) !== Boolean(secret)) {
      message = 's3CredentialsRequired';
    } else if (account.provider === 's3') {
      // #63：模板校验与档位归一（与引擎端同一套规则）。
      account.pathTemplate = normalizedShelfPathTemplate(account.pathTemplate ?? '');
      account.presignExpiry = normalizedShelfPresignExpiry(account.presignExpiry);
      message = shelfPathTemplateErrorKey(account.pathTemplate) ?? undefined;
    }
    if (message) {
      setError(t(`shelf.preferences.errors.${message}`));
      return;
    }
    if (identityChanged) account.credentialKey = shelfID();
    const credential =
      account.provider === 's3' && secret
        ? JSON.stringify({
            accessKey,
            secretKey: secret,
            ...(sessionToken ? { sessionToken } : {}),
          })
        : secret || undefined;
    setError(undefined);
    if (await onSave(account, credential)) {
      setSecret('');
      setAccessKey('');
      setSessionToken('');
    }
  };
  let credentialPrompt = hasCredential ? 'keepCredential' : 'noCredential';
  if (identityChanged) credentialPrompt = 'credentialChanged';
  const secretPlaceholder = t(`shelf.preferences.${credentialPrompt}`);
  return (
    <Editor
      title={t('shelf.preferences.cloudAccount')}
      error={error}
      busy={busy}
      onCancel={onCancel}
      onSubmit={() => void save()}
    >
      <SettingRow label={t('shelf.preferences.name')}>
        <SettingInput
          value={draft.name}
          onChange={(event) => field('name', event.target.value)}
          className="w-52"
          autoFocus
        />
      </SettingRow>
      <SettingRow label={t('shelf.preferences.provider')}>
        <SelectField
          value={draft.provider}
          onChange={(value) => field('provider', value)}
          options={SHELF_CLOUD_PROVIDERS.map((value) => ({
            value,
            label: t(`shelf.preferences.providers.${value}`),
          }))}
        />
      </SettingRow>
      {draft.provider !== 'icloud' && (
        <>
          <SettingRow label={t('shelf.preferences.endpoint')}>
            <SettingInput
              type="url"
              value={draft.endpoint}
              onChange={(event) => field('endpoint', event.target.value)}
              className="w-52"
              placeholder="https://"
            />
          </SettingRow>
          <SettingRow label={t('shelf.preferences.publicURL')}>
            <SettingInput
              type="url"
              value={draft.publicBaseURL}
              onChange={(event) => field('publicBaseURL', event.target.value)}
              className="w-52"
              placeholder="https://"
            />
          </SettingRow>
          {draft.provider === 's3' && (
            <>
              <SettingRow label={t('shelf.preferences.bucket')}>
                <SettingInput
                  value={draft.bucket}
                  onChange={(event) => field('bucket', event.target.value)}
                  className="w-52"
                />
              </SettingRow>
              <SettingRow label={t('shelf.preferences.region')}>
                <SettingInput
                  value={draft.region}
                  onChange={(event) => field('region', event.target.value)}
                  className="w-52"
                />
              </SettingRow>
              {/* #63：上传路径模板 + 示例与校验提示（规则与引擎端逐条对齐）。 */}
              <SettingRow
                label={t('shelf.preferences.pathTemplate')}
                description={t('shelf.preferences.pathTemplateExample')}
              >
                <SettingInput
                  value={draft.pathTemplate ?? ''}
                  onChange={(event) => field('pathTemplate', event.target.value)}
                  className="w-52"
                  placeholder="{filename}"
                />
              </SettingRow>
              {/* #64：预签名链接开关 + 到期档位（与匿名公开基址二选一）。 */}
              <SettingRow label={t('shelf.preferences.presignEnabled')}>
                <Toggle
                  id={`shelf-presign-${initial.id}`}
                  checked={Boolean(draft.presignEnabled)}
                  onChange={(value) => field('presignEnabled', value)}
                />
              </SettingRow>
              {draft.presignEnabled && (
                <SettingRow
                  label={t('shelf.preferences.presignExpiry')}
                  description={t('shelf.preferences.presignHint')}
                >
                  <SelectField
                    value={normalizedShelfPresignExpiry(draft.presignExpiry)}
                    onChange={(value) => field('presignExpiry', value)}
                    options={(SHELF_PRESIGN_EXPIRY as readonly string[]).map((value) => ({
                      value,
                      label: t(`shelf.preferences.presignExpiryOptions.${value}`),
                    }))}
                  />
                </SettingRow>
              )}
              <SettingRow label={t('shelf.preferences.accessKey')}>
                <SettingInput
                  value={accessKey}
                  onChange={(event) => setAccessKey(event.target.value)}
                  className="w-52"
                  autoComplete="off"
                  placeholder={secretPlaceholder}
                />
              </SettingRow>
            </>
          )}
          <SettingRow label={t('shelf.preferences.secret')}>
            <SettingInput
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              className="w-52"
              autoComplete="new-password"
              placeholder={secretPlaceholder}
            />
          </SettingRow>
          {draft.provider === 's3' && (
            <SettingRow label={t('shelf.preferences.sessionToken')}>
              <SettingInput
                type="password"
                value={sessionToken}
                onChange={(event) => setSessionToken(event.target.value)}
                className="w-52"
                autoComplete="off"
              />
            </SettingRow>
          )}
          {/* #66：凭据测试连接——上传→列出→删除三步全过才报成功（跑在引擎侧）。 */}
          {['s3', 'custom'].includes(draft.provider) && (
            <SettingRow
              label={t('shelf.preferences.testConnection')}
              description={
                hasCredential && !identityChanged
                  ? t('shelf.preferences.testConnectionHint')
                  : t('shelf.preferences.testConnectionWaitSave')
              }
            >
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={testing || identityChanged || !hasCredential}
                  onClick={() => void runConnectionTest()}
                >
                  {testing
                    ? t('shelf.preferences.testConnectionRunning')
                    : t('shelf.preferences.testConnection')}
                </Button>
                {(testResult || testing) &&
                  (['upload', 'list', 'delete'] as const).map((step) => {
                    const status = testResult?.steps.find((entry) => entry.step === step)?.status;
                    const tone =
                      (status ? STEP_TONE_BY_STATUS[status] : undefined) ?? 'text-xp-text-secondary';
                    const glyph = (status ? STEP_GLYPH_BY_STATUS[status] : undefined) ?? '○';
                    return (
                      <span
                        key={step}
                        title={t(`shelf.preferences.testConnectionSteps.${step}`)}
                        className={tone}
                      >
                        {glyph}
                      </span>
                    );
                  })}
              </div>
              {testResult?.message && (
                <p
                  className={
                    testResult.succeeded
                      ? 'mt-1 text-xs leading-[1.4] text-emerald-500'
                      : 'mt-1 text-xs leading-[1.4] text-red-500'
                  }
                >
                  {testResult.message}
                </p>
              )}
            </SettingRow>
          )}
        </>
      )}
      <SettingRow label={t('shelf.preferences.credentialStatus')}>
        <span className="text-xs text-xp-text-secondary">
          {t(
            hasCredential && !identityChanged
              ? 'shelf.preferences.credentialSaved'
              : 'shelf.preferences.credentialMissing',
          )}
        </span>
      </SettingRow>
    </Editor>
  );
};
