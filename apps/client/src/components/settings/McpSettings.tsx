import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogTitle } from '@/components/ui/dialog';
import { SettingsSection, SettingRow, SettingsStatus, Toggle } from './shared';
import type { SettingsEditorProps } from './draft-state';
import { transport, isTauri } from '@/lib/transport';

interface McpEntry {
  type: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
}
const emptyEntry = (): McpEntry => ({ type: 'stdio', command: '', args: [], enabled: true });
const describeEntry = (entry: McpEntry): string =>
  entry.type === 'http'
    ? entry.url || ''
    : [entry.command, ...(entry.args ?? [])].filter(Boolean).join(' ');
const parseJsonField = (text: string): Record<string, string> | undefined => {
  if (!text.trim()) return undefined;
  const value: unknown = JSON.parse(text);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.values(value).some((item) => typeof item !== 'string')
  ) {
    throw new Error('invalid configuration');
  }
  return value as Record<string, string>;
};

const McpSettings = ({ onDraftChange }: SettingsEditorProps = {}) => {
  const { t } = useTranslation();
  const [servers, setServers] = useState<Record<string, McpEntry>>({});
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draft, setDraft] = useState<McpEntry>(emptyEntry());
  const [draftEnv, setDraftEnv] = useState('');
  const [draftHeaders, setDraftHeaders] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [testing, setTesting] = useState<Set<string>>(new Set());
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; text: string }>>({});
  const initialDraft = useRef('');
  const formRef = useRef<HTMLFormElement>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const serializedDraft = JSON.stringify([draftName, draft, draftEnv, draftHeaders]);

  useEffect(() => {
    onDraftChange?.({
      dirty: editing !== null && serializedDraft !== initialDraft.current,
      busy: saving,
    });
  }, [editing, serializedDraft, saving, onDraftChange]);

  const reload = useCallback(async () => {
    if (!isTauri()) {
      setLoaded(true);
      return;
    }
    setLoaded(false);
    setLoadFailed(false);
    try {
      setServers(await transport<Record<string, McpEntry>>('mcp_config_get'));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (editing !== null) formRef.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [editing]);

  const persist = async (next: Record<string, McpEntry>): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await transport('mcp_config_set', { config: { mcpServers: next } });
      setServers(next);
      setSaved(true);
      return true;
    } catch {
      setError(t('settings.mcp.saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  };
  const startEdit = (name: string | null) => {
    const entry = name === null ? emptyEntry() : { ...servers[name] };
    const env = entry.env ? JSON.stringify(entry.env, null, 2) : '';
    const headers = entry.headers ? JSON.stringify(entry.headers, null, 2) : '';
    setDraftName(name ?? '');
    setDraft(entry);
    setDraftEnv(env);
    setDraftHeaders(headers);
    initialDraft.current = JSON.stringify([name ?? '', entry, env, headers]);
    setError('');
    setSaved(false);
    setEditing(name ?? '__new');
  };
  const finishEdit = () => {
    setEditing(null);
    setError('');
    requestAnimationFrame(() => addRef.current?.querySelector('button')?.focus());
  };
  const saveEdit = async () => {
    const name = draftName.trim();
    if (!name) {
      setError(t('settings.mcp.needName'));
      return;
    }
    if (name !== editing && Object.hasOwn(servers, name)) {
      setError(t('settings.mcp.duplicateName'));
      return;
    }
    let entry: McpEntry;
    try {
      entry = {
        ...draft,
        env: draft.type === 'stdio' ? parseJsonField(draftEnv) : undefined,
        headers: draft.type === 'http' ? parseJsonField(draftHeaders) : undefined,
      };
    } catch {
      setError(t('settings.mcp.badJson'));
      return;
    }
    if (draft.type === 'stdio' && !entry.command?.trim()) {
      setError(t('settings.mcp.needCommand'));
      return;
    }
    if (draft.type === 'http') {
      try {
        if (!['http:', 'https:'].includes(new URL(entry.url ?? '').protocol)) throw new Error();
      } catch {
        setError(t('settings.mcp.needUrl'));
        return;
      }
      entry = {
        type: 'http',
        url: entry.url?.trim(),
        headers: entry.headers,
        enabled: entry.enabled,
      };
    } else {
      entry = {
        type: 'stdio',
        command: entry.command?.trim(),
        args: entry.args?.filter((arg) => arg.trim().length > 0),
        env: entry.env,
        enabled: entry.enabled,
      };
    }
    const next = { ...servers };
    if (editing !== '__new' && editing !== name && editing !== null) delete next[editing];
    next[name] = entry;
    if (await persist(next)) finishEdit();
  };
  const testServer = async (name: string) => {
    setTesting((prev) => new Set(prev).add(name));
    try {
      const result = await transport<{ ok: boolean; toolCount?: number }>('mcp_test_server', {
        server: name,
      });
      setTestResults((prev) => ({
        ...prev,
        [name]: {
          ok: result.ok,
          text: result.ok
            ? t('settings.mcp.testOk', { count: result.toolCount ?? 0 })
            : t('settings.mcp.testFailed'),
        },
      }));
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [name]: { ok: false, text: t('settings.mcp.testFailed') },
      }));
    } finally {
      setTesting((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  };
  const removeServer = async () => {
    if (!removing) return;
    const next = { ...servers };
    delete next[removing];
    if (await persist(next)) {
      setRemoving(null);
      requestAnimationFrame(() => addRef.current?.querySelector('button')?.focus());
    }
  };

  return (
    <div className="space-y-4">
      <SettingsSection title={t('settings.mcp.title')}>
        {!isTauri() && <SettingsStatus>{t('settings.mcp.desktopOnly')}</SettingsStatus>}
        {isTauri() && !loaded && <SettingsStatus>{t('settings.loading')}</SettingsStatus>}
        {loadFailed && (
          <div>
            <SettingsStatus error>{t('settings.mcp.loadFailed')}</SettingsStatus>
            <div className="wisp-settings-actions">
              <Button variant="secondary" onClick={reload}>
                {t('settings.retry')}
              </Button>
            </div>
          </div>
        )}
        {isTauri() && loaded && !loadFailed && Object.keys(servers).length === 0 && (
          <SettingsStatus>{t('settings.mcp.empty')}</SettingsStatus>
        )}
        {Object.entries(servers).map(([name, entry]) => (
          <div key={name} data-testid={`mcp-server-row-${name}`}>
            <SettingRow
              label={name}
              description={
                <span className="break-words">
                  {t(entry.type === 'http' ? 'settings.mcp.network' : 'settings.mcp.local')} ·{' '}
                  {describeEntry(entry)}
                </span>
              }
            >
              <div className="wisp-settings-inline-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void testServer(name)}
                  disabled={saving || testing.has(name)}
                  aria-label={t('settings.mcp.testNamed', { name })}
                  data-testid={`mcp-test-${name}`}
                >
                  <RefreshCw
                    size={13}
                    aria-hidden="true"
                    className={testing.has(name) ? 'animate-spin' : ''}
                  />
                  {t('settings.mcp.test')}
                </Button>
                <Toggle
                  id={`mcp-toggle-${name}`}
                  label={t('settings.mcp.enableNamed', { name })}
                  checked={entry.enabled}
                  disabled={saving}
                  onChange={() =>
                    void persist({ ...servers, [name]: { ...entry, enabled: !entry.enabled } })
                  }
                />
              </div>
            </SettingRow>
            <div className="wisp-settings-inline-actions px-3 pb-3">
              <span
                className="wisp-settings-hint flex-1"
                role="status"
                data-testid={`mcp-test-result-${name}`}
              >
                {testing.has(name)
                  ? t('settings.mcp.testing')
                  : (testResults[name]?.text ??
                    t(entry.enabled ? 'settings.mcp.enabled' : 'settings.mcp.disabled'))}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={saving || editing !== null}
                onClick={() => startEdit(name)}
                aria-label={t('settings.mcp.editNamed', { name })}
              >
                {t('settings.mcp.edit')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={saving || editing !== null}
                onClick={() => {
                  setError('');
                  setRemoving(name);
                }}
                aria-label={t('settings.mcp.removeNamed', { name })}
              >
                <Trash2 size={13} aria-hidden="true" />
              </Button>
            </div>
          </div>
        ))}
        {editing === null && (
          <div ref={addRef} className="wisp-settings-actions">
            <Button
              variant="secondary"
              size="sm"
              disabled={!isTauri() || !loaded || loadFailed || saving}
              onClick={() => startEdit(null)}
              data-testid="mcp-add"
            >
              <Plus size={13} aria-hidden="true" />
              {t('settings.mcp.add')}
            </Button>
          </div>
        )}
      </SettingsSection>
      {editing !== null && (
        <SettingsSection
          title={t(editing === '__new' ? 'settings.mcp.addTitle' : 'settings.mcp.editTitle')}
        >
          <form
            ref={formRef}
            onSubmit={(event) => {
              event.preventDefault();
              void saveEdit();
            }}
            data-testid="mcp-edit-form"
          >
            <fieldset disabled={saving} className="wisp-settings-form">
              <label>
                {t('settings.mcp.nameLabel')}
                <Input
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  placeholder={t('settings.mcp.namePlaceholder')}
                  data-testid="mcp-edit-name"
                />
              </label>
              <fieldset className="wisp-settings-type">
                <legend>{t('settings.mcp.connectionType')}</legend>
                {(['stdio', 'http'] as const).map((type) => (
                  <label key={type}>
                    <input
                      type="radio"
                      name="mcp-connection-type"
                      value={type}
                      checked={draft.type === type}
                      onChange={() => setDraft({ ...draft, type })}
                    />
                    {t(type === 'http' ? 'settings.mcp.network' : 'settings.mcp.local')}
                  </label>
                ))}
              </fieldset>
              {draft.type === 'stdio' ? (
                <>
                  <label>
                    {t('settings.mcp.commandLabel')}
                    <Input
                      value={draft.command ?? ''}
                      onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                      placeholder="npx"
                    />
                  </label>
                  <label>
                    {t('settings.mcp.argsLabel')}
                    <textarea
                      value={(draft.args ?? []).join('\n')}
                      onChange={(event) =>
                        setDraft({ ...draft, args: event.target.value.split('\n') })
                      }
                      rows={3}
                    />
                    <span className="wisp-settings-hint">{t('settings.mcp.argsHint')}</span>
                  </label>
                  <details className="wisp-settings-advanced">
                    <summary>{t('settings.mcp.advanced')}</summary>
                    <label className="wisp-settings-field">
                      {t('settings.mcp.envLabel')}
                      <textarea
                        value={draftEnv}
                        onChange={(event) => setDraftEnv(event.target.value)}
                        placeholder={'{ "KEY": "value" }'}
                        rows={3}
                      />
                    </label>
                  </details>
                </>
              ) : (
                <>
                  <label>
                    {t('settings.mcp.urlLabel')}
                    <Input
                      value={draft.url ?? ''}
                      onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                      placeholder="https://example.com/mcp"
                    />
                  </label>
                  <details className="wisp-settings-advanced">
                    <summary>{t('settings.mcp.advanced')}</summary>
                    <label className="wisp-settings-field">
                      {t('settings.mcp.headersLabel')}
                      <textarea
                        value={draftHeaders}
                        onChange={(event) => setDraftHeaders(event.target.value)}
                        placeholder={'{ "Authorization": "Bearer …" }'}
                        rows={3}
                      />
                    </label>
                  </details>
                </>
              )}
            </fieldset>
            {error && <SettingsStatus error>{error}</SettingsStatus>}
            <div className="wisp-settings-actions">
              <Button type="button" variant="secondary" disabled={saving} onClick={finishEdit}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={saving} data-testid="mcp-edit-save">
                {t(saving ? 'settings.saving' : 'common.save')}
              </Button>
            </div>
          </form>
        </SettingsSection>
      )}
      {error && editing === null && removing === null && (
        <SettingsStatus error>{error}</SettingsStatus>
      )}
      {saved && <SettingsStatus>{t('settings.mcp.saved')}</SettingsStatus>}
      {removing && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !saving) setRemoving(null);
          }}
          preventClose={saving}
          maxWidth={420}
        >
          <div className="wisp-settings-confirm">
            <DialogTitle>{t('settings.mcp.removeTitle', { name: removing })}</DialogTitle>
            <p>{t('settings.mcp.removeDescription')}</p>
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
              <Button disabled={saving} onClick={removeServer}>
                {t(saving ? 'settings.saving' : 'settings.mcp.remove')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};
export default McpSettings;
