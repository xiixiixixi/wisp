/**
 * MCP 设置页 —— 照 ZCode 的服务器管理方式：
 * 服务器列表（类型徽章 + 启用开关 + 测连接 + 工具清单）+「添加服务器」
 * 内联表单（stdio：命令/参数/环境变量 JSON；http：地址/请求头 JSON）。
 * 配置落在 ~/.pi/agent/mcp.json（Claude Desktop 同款格式）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plug, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsSection, SettingRow, Toggle } from './shared';
import { transport, isTauri } from '@/lib/transport';
import { toast } from '@/hooks/use-toast';

/** 单个服务器的编辑态（env/headers 用 JSON 文本编辑，高级用户语义）。 */
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

const describeEntry = (e: McpEntry): string =>
  e.type === 'http' ? e.url || '' : [e.command, ...(e.args ?? [])].filter(Boolean).join(' ');

/** 校验 JSON 文本框；空串视为未填。 */
const parseJsonField = (text: string): Record<string, string> | undefined => {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const parsed: unknown = JSON.parse(trimmed);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('not an object');
  }
  return parsed as Record<string, string>;
};

const McpSettings = () => {
  const { t } = useTranslation();
  const [servers, setServers] = useState<Record<string, McpEntry>>({});
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // 正在编辑/新增的服务器名；'__new' 表示新增
  const [draftName, setDraftName] = useState('');
  const [draft, setDraft] = useState<McpEntry>(emptyEntry());
  const [draftEnv, setDraftEnv] = useState('');
  const [draftHeaders, setDraftHeaders] = useState('');
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; text: string }>>({});

  const reload = useCallback(async () => {
    if (!isTauri()) {
      setLoaded(true);
      return;
    }
    try {
      const cfg = await transport<Record<string, McpEntry>>('mcp_config_get');
      setServers(cfg);
    } catch (e) {
      toast({ title: t('settings.mcp.loadFailed'), description: String(e) });
    }
    setLoaded(true);
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ZCode 同款：进页面自动探测全部服务器连通性（状态灯直接可见，不用逐个手点）
  const probeAll = useCallback(async () => {
    const names = Object.keys(servers);
    for (const name of names) {
      setTesting(name);
      try {
        const r = await transport<{ ok: boolean; toolCount?: number; error?: string }>(
          'mcp_test_server',
          { server: name },
        );
        setTestResults((prev) => ({
          ...prev,
          [name]: r.ok
            ? { ok: true, text: t('settings.mcp.testOk', { count: r.toolCount ?? 0 }) }
            : { ok: false, text: r.error ?? 'failed' },
        }));
      } catch (e) {
        setTestResults((prev) => ({ ...prev, [name]: { ok: false, text: String(e) } }));
      } finally {
        setTesting(null);
      }
    }
  }, [servers, t]);

  const probedRef = useRef(false);
  useEffect(() => {
    if (loaded && !probedRef.current && Object.keys(servers).length > 0) {
      probedRef.current = true;
      void probeAll();
    }
  }, [loaded, servers, probeAll]);

  const persist = useCallback(
    async (next: Record<string, McpEntry>) => {
      setServers(next);
      try {
        await transport('mcp_config_set', { config: { mcpServers: next } });
      } catch (e) {
        toast({ title: t('settings.mcp.saveFailed'), description: String(e) });
      }
    },
    [t],
  );

  const toggleEnabled = (name: string) => {
    const next = { ...servers, [name]: { ...servers[name], enabled: !servers[name].enabled } };
    void persist(next);
  };

  const removeServer = (name: string) => {
    const next = { ...servers };
    delete next[name];
    void persist(next);
    setTestResults((prev) => {
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
  };

  const startEdit = (name: string) => {
    const entry = servers[name];
    setEditing(name);
    setDraftName(name);
    setDraft({ ...entry });
    setDraftEnv(entry.env ? JSON.stringify(entry.env, null, 2) : '');
    setDraftHeaders(entry.headers ? JSON.stringify(entry.headers, null, 2) : '');
  };

  const startAdd = () => {
    setEditing('__new');
    setDraftName('');
    setDraft(emptyEntry());
    setDraftEnv('');
    setDraftHeaders('');
  };

  const saveEdit = () => {
    const name = draftName.trim();
    if (!name) return;
    let entry: McpEntry;
    try {
      entry = {
        ...draft,
        env: parseJsonField(draftEnv),
        headers: draft.type === 'http' ? parseJsonField(draftHeaders) : undefined,
      };
    } catch {
      toast({ title: t('settings.mcp.badJson') });
      return;
    }
    if (draft.type === 'stdio' && !entry.command?.trim()) {
      toast({ title: t('settings.mcp.needCommand') });
      return;
    }
    if (draft.type === 'http' && !entry.url?.trim()) {
      toast({ title: t('settings.mcp.needUrl') });
      return;
    }
    const next = { ...servers };
    if (editing !== name) delete next[editing ?? ''];
    next[name] = entry;
    void persist(next);
    setEditing(null);
  };

  const testServer = async (name: string) => {
    setTesting(name);
    try {
      const r = await transport<{ ok: boolean; toolCount?: number; tools?: string[]; error?: string }>(
        'mcp_test_server',
        { server: name },
      );
      setTestResults((prev) => ({
        ...prev,
        [name]: r.ok
          ? { ok: true, text: t('settings.mcp.testOk', { count: r.toolCount ?? 0 }) }
          : { ok: false, text: r.error ?? 'failed' },
      }));
    } catch (e) {
      setTestResults((prev) => ({ ...prev, [name]: { ok: false, text: String(e) } }));
    } finally {
      setTesting(null);
    }
  };

  const names = Object.keys(servers);

  return (
    <SettingsSection title={t('settings.mcp.title')} description={t('settings.mcp.desc')}>
      {!isTauri() && (
        <div className="px-4 py-3 text-xs text-xp-text-muted">{t('settings.mcp.desktopOnly')}</div>
      )}
      {isTauri() && loaded && names.length === 0 && (
        <div className="px-4 py-3 text-xs text-xp-text-muted">{t('settings.mcp.empty')}</div>
      )}
      {names.map((name) => {
        const entry = servers[name];
        const result = testResults[name];
        const dot: 'ok' | 'err' | 'wait' | 'idle' = testing === name
          ? 'wait'
          : result
            ? result.ok
              ? 'ok'
              : 'err'
            : 'idle';
        const dotCls =
          dot === 'ok'
            ? 'bg-xp-green'
            : dot === 'err'
              ? 'bg-xp-red'
              : dot === 'wait'
                ? 'bg-xp-yellow animate-pulse'
                : 'bg-xp-border-strong bg-xp-text-muted opacity-50';
        return (
          <div key={name} data-testid={`mcp-server-row-${name}`}>
            {editing === name ? null : (
              <SettingRow
                label={
                  <span className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${dotCls}`} aria-hidden="true" data-testid={`mcp-dot-${name}`} />
                    {name}
                  </span>
                }
                description={
                  <span className="flex flex-col gap-0.5">
                    <span className="font-mono text-[10px] text-xp-text-muted">
                      {entry.type === 'http' ? 'http' : 'stdio'} · {describeEntry(entry)}
                    </span>
                    {result && (
                      <span
                        className={`text-[10px] ${result.ok ? 'text-xp-green' : 'text-xp-red'}`}
                        data-testid={`mcp-test-result-${name}`}
                      >
                        {result.ok ? '✓ ' : '✗ '}
                        {result.text}
                      </span>
                    )}
                  </span>
                }
              >
                <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void testServer(name)}
                      disabled={testing === name}
                      title={t('settings.mcp.test')}
                      className="rounded-md p-1.5 text-xp-text-muted hover:bg-xp-surface-light hover:text-xp-text"
                      data-testid={`mcp-test-${name}`}
                    >
                      <RefreshCw size={13} className={testing === name ? 'animate-spin' : ''} />
                    </button>
                    <Toggle
                      id={`mcp-toggle-${name}`}
                      checked={entry.enabled}
                      onChange={() => toggleEnabled(name)}
                    />
                    <button
                      type="button"
                      onClick={() => startEdit(name)}
                      title={t('settings.mcp.edit')}
                      className="rounded-md p-1.5 text-xp-text-muted hover:bg-xp-surface-light hover:text-xp-text"
                    >
                      <Plug size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeServer(name)}
                      title={t('settings.mcp.remove')}
                      className="rounded-md p-1.5 text-xp-text-muted hover:bg-xp-surface-light hover:text-xp-red"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
              </SettingRow>
            )}
          </div>
        );
      })}

      {/* 新增/编辑表单 */}
      {editing !== null && (
        <div
          className="mx-4 my-2 rounded-lg border border-xp-border bg-xp-surface px-3 py-3"
          data-testid="mcp-edit-form"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-xp-text">
              {editing === '__new' ? t('settings.mcp.addTitle') : t('settings.mcp.editTitle')}
            </span>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded p-1 text-xp-text-muted hover:bg-xp-surface-light"
              aria-label={t('common.cancel')}
            >
              <X size={13} />
            </button>
          </div>
          <div className="space-y-2">
            <Input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder={t('settings.mcp.namePlaceholder')}
              aria-label={t('settings.mcp.namePlaceholder')}
              data-testid="mcp-edit-name"
            />
            <div className="flex gap-1.5">
              {(['stdio', 'http'] as const).map((tp) => (
                <button
                  key={tp}
                  type="button"
                  onClick={() => setDraft({ ...draft, type: tp })}
                  className={`rounded-md border px-2.5 py-1 text-[11px] ${
                    draft.type === tp
                      ? 'border-xp-accent text-xp-accent'
                      : 'border-xp-border text-xp-text-muted'
                  }`}
                >
                  {tp}
                </button>
              ))}
            </div>
            {draft.type === 'stdio' ? (
              <>
                <Input
                  value={draft.command ?? ''}
                  onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                  placeholder="npx"
                  aria-label="command"
                />
                <Input
                  value={(draft.args ?? []).join(' ')}
                  onChange={(e) =>
                    setDraft({ ...draft, args: e.target.value.split(/\s+/).filter(Boolean) })
                  }
                  placeholder="-y figma-developer-mcp --stdio"
                  aria-label="args"
                />
                <textarea
                  value={draftEnv}
                  onChange={(e) => setDraftEnv(e.target.value)}
                  placeholder={'{ "KEY": "value" }'}
                  aria-label="env json"
                  rows={2}
                  className="w-full rounded-md border border-xp-border bg-xp-surface px-2 py-1.5 font-mono text-[11px] text-xp-text outline-none focus:border-xp-accent"
                />
              </>
            ) : (
              <>
                <Input
                  value={draft.url ?? ''}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                  placeholder="https://example.com/mcp"
                  aria-label="url"
                />
                <textarea
                  value={draftHeaders}
                  onChange={(e) => setDraftHeaders(e.target.value)}
                  placeholder={'{ "Authorization": "Bearer …" }'}
                  aria-label="headers json"
                  rows={2}
                  className="w-full rounded-md border border-xp-border bg-xp-surface px-2 py-1.5 font-mono text-[11px] text-xp-text outline-none focus:border-xp-accent"
                />
              </>
            )}
            <div className="flex justify-end gap-1.5 pt-1">
              <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={saveEdit} data-testid="mcp-edit-save">
                <Check size={12} />
                {t('common.save')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {editing === null && (
        <div className="px-4 pb-3 pt-1">
          <Button variant="outline" size="sm" onClick={startAdd} data-testid="mcp-add">
            <Plus size={12} />
            {t('settings.mcp.add')}
          </Button>
        </div>
      )}
    </SettingsSection>
  );
};

export default McpSettings;
