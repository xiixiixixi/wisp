import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronRight, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogTitle } from '@/components/ui/dialog';
import { SettingsStatus, Toggle } from './shared';
import type { SettingsEditorProps } from './draft-state';
import { transport, isTauri } from '@/lib/transport';
import { formatMcpConfig, parseMcpConfig, McpConfigError, type McpEntry } from '@/lib/mcp-config';
import './mcp-settings.css';

const emptyEntry = (): McpEntry => ({ type: 'stdio', command: '', args: [], enabled: true });
const describeEntry = (entry: McpEntry): string => {
  if (entry.type !== 'http') return entry.command || '';
  try {
    return new URL(entry.url || '').host;
  } catch {
    return '';
  }
};
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
  const [view, setView] = useState<'list' | 'detail' | 'json'>('list');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [jsonDraft, setJsonDraft] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [jsonBaseline, setJsonBaseline] = useState('');
  const jsonDirty = jsonDraft !== jsonBaseline;
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
  const detailDirty = editing !== null && serializedDraft !== initialDraft.current;

  useEffect(() => {
    onDraftChange?.({
      dirty: jsonDirty || detailDirty,
      busy: saving,
    });
  }, [detailDirty, jsonDirty, saving, onDraftChange]);

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
      setTestResults({});
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
    setView('detail');
  };
  const openJson = () => {
    const text = formatMcpConfig(servers);
    setJsonDraft(text);
    setJsonBaseline(text);
    setJsonError('');
    setError('');
    setSaved(false);
    setView('json');
  };
  const validateJson = (): Record<string, McpEntry> | null => {
    try {
      const next = parseMcpConfig(jsonDraft);
      setJsonError('');
      return next;
    } catch (cause) {
      const issue = cause instanceof McpConfigError ? cause : new McpConfigError('syntax');
      setJsonError(
        `${issue.server ? `${issue.server}: ` : ''}${t(`settings.mcp.jsonErrors.${issue.reason}`)}`,
      );
      return null;
    }
  };
  const saveJson = async () => {
    const next = validateJson();
    if (next && (await persist(next))) {
      const text = formatMcpConfig(next);
      setJsonDraft(text);
      setJsonBaseline(text);
    }
  };
  const finishEdit = () => {
    setEditing(null);
    setView('list');
    setError('');
    setJsonError('');
    setJsonDraft(jsonBaseline);
    setConfirmLeave(false);
    requestAnimationFrame(() => addRef.current?.querySelector('button')?.focus());
  };
  const requestBack = () => {
    if (saving) return;
    if (detailDirty || jsonDirty) setConfirmLeave(true);
    else finishEdit();
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
        ...entry,
        type: 'http',
        command: undefined,
        args: undefined,
        env: undefined,
        url: entry.url?.trim(),
        headers: entry.headers,
        enabled: entry.enabled,
      };
    } else {
      entry = {
        ...entry,
        type: 'stdio',
        url: undefined,
        headers: undefined,
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
      finishEdit();
    }
  };
  let connectionTestStatus = editing === null ? undefined : testResults[editing]?.text;
  if (editing !== null && testing.has(editing)) connectionTestStatus = t('settings.mcp.testing');
  if (detailDirty) connectionTestStatus = t('settings.mcp.saveBeforeTest');

  return (
    <div className="wisp-mcp-settings" data-view={view}>
      {view === 'list' ? (
        <header className="wisp-mcp-heading">
          <div>
            <h3>{t('settings.mcp.title')}</h3>
            <p>{t('settings.mcp.desc')}</p>
          </div>
          <div className="wisp-mcp-heading-actions" ref={addRef}>
            <Button
              variant="ghost"
              size="sm"
              disabled={!isTauri() || !loaded || loadFailed || saving}
              onClick={openJson}
            >
              {t('settings.mcp.editJson')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!isTauri() || !loaded || loadFailed || saving}
              onClick={() => startEdit(null)}
              data-testid="mcp-add"
            >
              <Plus size={14} aria-hidden="true" />
              {t('settings.mcp.add')}
            </Button>
          </div>
        </header>
      ) : (
        <header className="wisp-mcp-detail-heading">
          <button type="button" className="wisp-mcp-back" disabled={saving} onClick={requestBack}>
            <ArrowLeft size={15} aria-hidden="true" />
            {t('settings.mcp.back')}
          </button>
          <div className="wisp-mcp-heading">
            <h3>
              {view === 'json'
                ? t('settings.mcp.jsonTitle')
                : t(editing === '__new' ? 'settings.mcp.addTitle' : 'settings.mcp.editTitle')}
            </h3>
            {view === 'json' && (
              <Button
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() => {
                  const next = validateJson();
                  if (next) setJsonDraft(formatMcpConfig(next));
                }}
              >
                {t('settings.mcp.format')}
              </Button>
            )}
          </div>
        </header>
      )}

      {view === 'list' && (
        <section aria-label={t('settings.mcp.listView')} className="wisp-mcp-list">
          {!isTauri() && <SettingsStatus>{t('settings.mcp.desktopOnly')}</SettingsStatus>}
          {isTauri() && !loaded && <SettingsStatus>{t('settings.loading')}</SettingsStatus>}
          {loadFailed && (
            <div className="wisp-mcp-load-error">
              <SettingsStatus error>{t('settings.mcp.loadFailed')}</SettingsStatus>
              <Button variant="secondary" onClick={reload}>
                {t('settings.retry')}
              </Button>
            </div>
          )}
          {isTauri() && loaded && !loadFailed && Object.keys(servers).length === 0 && (
            <SettingsStatus>{t('settings.mcp.empty')}</SettingsStatus>
          )}
          {Object.entries(servers).map(([name, entry]) => (
            <div className="wisp-mcp-server-row" key={name} data-testid={`mcp-server-row-${name}`}>
              <button
                type="button"
                className="wisp-mcp-server-open"
                disabled={saving}
                onClick={() => startEdit(name)}
                aria-label={t('settings.mcp.editNamed', { name })}
              >
                <span className="wisp-mcp-server-copy">
                  <span className="wisp-mcp-server-name">{name}</span>
                  <span className="wisp-mcp-server-description">
                    {describeEntry(entry) ||
                      t(entry.type === 'http' ? 'settings.mcp.network' : 'settings.mcp.local')}
                  </span>
                </span>
                <ChevronRight size={15} aria-hidden="true" />
              </button>
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
          ))}
          {error && <SettingsStatus error>{error}</SettingsStatus>}
          {saved && <SettingsStatus>{t('settings.mcp.saved')}</SettingsStatus>}
        </section>
      )}

      {view === 'json' && (
        <section className="wisp-mcp-json" aria-label={t('settings.mcp.jsonTitle')}>
          <textarea
            aria-label={t('settings.mcp.jsonTitle')}
            value={jsonDraft}
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            disabled={saving}
            aria-invalid={Boolean(jsonError)}
            aria-describedby="mcp-json-help"
            onChange={(event) => {
              setJsonDraft(event.target.value);
              setSaved(false);
              setJsonError('');
            }}
          />
          <p id="mcp-json-help" className="wisp-settings-hint">
            {t('settings.mcp.jsonHint')}
          </p>
          {jsonError && <SettingsStatus error>{jsonError}</SettingsStatus>}
          {error && <SettingsStatus error>{error}</SettingsStatus>}
          <footer className="wisp-mcp-editor-actions">
            <span role="status">{saved && !jsonDirty ? t('settings.mcp.saved') : ''}</span>
            <Button variant="secondary" disabled={saving} onClick={requestBack}>
              {t('common.cancel')}
            </Button>
            <Button disabled={saving || !jsonDirty} onClick={() => void saveJson()}>
              {t(saving ? 'settings.saving' : 'settings.mcp.saveJson')}
            </Button>
          </footer>
        </section>
      )}

      {view === 'detail' && editing !== null && (
        <form
          ref={formRef}
          className="wisp-mcp-detail"
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
          {editing !== '__new' && (
            <div className="wisp-mcp-connection-test">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void testServer(editing)}
                disabled={saving || detailDirty || testing.has(editing)}
                aria-label={t('settings.mcp.testNamed', { name: editing })}
                data-testid={`mcp-test-${editing}`}
              >
                <RefreshCw
                  size={13}
                  aria-hidden="true"
                  className={testing.has(editing) ? 'animate-spin' : ''}
                />
                {t('settings.mcp.test')}
              </Button>
              <span role="status" data-testid={`mcp-test-result-${editing}`}>
                {connectionTestStatus}
              </span>
            </div>
          )}
          {error && removing === null && <SettingsStatus error>{error}</SettingsStatus>}
          <footer className="wisp-mcp-editor-actions">
            {editing !== '__new' ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="wisp-mcp-remove"
                disabled={saving}
                onClick={() => {
                  setError('');
                  setRemoving(editing);
                }}
                aria-label={t('settings.mcp.removeNamed', { name: editing })}
              >
                <Trash2 size={13} aria-hidden="true" />
                {t('settings.mcp.remove')}
              </Button>
            ) : (
              <span />
            )}
            <Button type="button" variant="secondary" disabled={saving} onClick={requestBack}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving} data-testid="mcp-edit-save">
              {t(saving ? 'settings.saving' : 'common.save')}
            </Button>
          </footer>
        </form>
      )}
      {confirmLeave && (
        <Dialog open preventClose={saving} onOpenChange={setConfirmLeave} maxWidth={420}>
          <div className="wisp-settings-confirm">
            <DialogTitle>{t('settings.discardTitle')}</DialogTitle>
            <p>{t('settings.mcp.discardDraft')}</p>
            <div className="wisp-settings-actions">
              <Button variant="secondary" data-autofocus onClick={() => setConfirmLeave(false)}>
                {t('settings.keepEditing')}
              </Button>
              <Button onClick={finishEdit}>{t('settings.mcp.discardAndBack')}</Button>
            </div>
          </div>
        </Dialog>
      )}
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
