/**
 * 微信机器人面板 —— 照抄 dsh-weixin-clawbot 管理弹窗（MIT）的结构与视觉：
 * 品牌头部（微信绿 logo 方块 + 标题/副标题）→ 状态点行 → 三 section
 * （关联机器人：白底二维码卡/已连接行；回复颗粒度：SettingRow+下拉；
 *  文件夹访问范围：勾选列表）。逻辑在 lib/weixin/bridge.ts，面板只是视图。
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectField, SettingRow } from '@/components/settings/shared';
import { weixinBridge } from '@/lib/weixin/bridge';
import { isTauri } from '@/lib/transport';

/** 微信 logo 描线图形（抄 dsh-weixin-clawbot WechatGlyph，白色，坐品牌绿底）。 */
const WechatGlyph = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M8.5 5.5c-3.6 0-6.5 2.4-6.5 5.4 0 1.7.9 3.2 2.4 4.2l-.6 2.1 2.4-1.2c.7.2 1.5.3 2.3.3h.4a5.5 5.5 0 0 1-.2-1.5c0-3 2.9-5.4 6.4-5.4h.5C15.9 7.2 12.5 5.5 8.5 5.5Z" />
    <path d="M15.9 9.5c-3.3 0-6 2.2-6 4.9s2.7 4.9 6 4.9c.7 0 1.3-.1 1.9-.3l2.1 1-.5-1.8c1.3-.9 2.5-2.2 2.5-3.8 0-2.7-2.7-4.9-6-4.9Z" />
  </svg>
);

/** 状态点（照 dsh StateDot：成功绿 / 错误红 / 等待灰）。 */
const StateDot = ({ state }: { state: 'ok' | 'err' | 'wait' }) => (
  <span
    aria-hidden="true"
    className={`inline-block h-2 w-2 shrink-0 rounded-full ${
      state === 'ok' ? 'bg-[#07c160]' : state === 'err' ? 'bg-xp-red' : 'bg-xp-border-strong bg-xp-text-muted'
    }`}
  />
);

const Section = ({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) => (
  <div className="rounded-lg border border-xp-border bg-xp-surface px-3 py-2.5">
    <div className="text-[13px] font-semibold text-xp-text">{title}</div>
    {desc && <div className="mt-0.5 text-[11px] leading-4 text-xp-text-muted">{desc}</div>}
    <div className="mt-2 space-y-2">{children}</div>
  </div>
);

const WeixinBridgePanel = ({ currentPath }: { currentPath: string }) => {
  const { t } = useTranslation();
  const [, force] = useState(0);
  const [code, setCode] = useState('');
  const [folderDraft, setFolderDraft] = useState('');

  useEffect(() => {
    const un = weixinBridge.subscribe(() => force((n) => n + 1));
    // 照 DSH：弹窗一开二维码就在——init 恢复凭据后仍未连接（含失效）则自动发起配对
    void weixinBridge.init().then(() => {
      const st = weixinBridge.state.status;
      if (isTauri() && (st === 'idle' || st === 'expired' || st === 'error')) {
        void weixinBridge.beginPairing();
      }
    });
    return un;
  }, []);

  const state = weixinBridge.state;
  const persisted = weixinBridge.getPersisted();
  const dot: 'ok' | 'err' | 'wait' =
    state.status === 'connected'
      ? 'ok'
      : state.status === 'error' || state.status === 'expired'
        ? 'err'
        : 'wait';
  const statusText: Record<string, string> = {
    idle: t('weixin.stIdle'),
    qr: t('weixin.stQr'),
    'need-code': t('weixin.stNeedCode'),
    connecting: t('weixin.stConnecting'),
    connected: t('weixin.stConnected'),
    expired: t('weixin.stExpired'),
    error: t('weixin.stError'),
  };
  const granularity =
    persisted.replyOn === 'turn' ? 'turn' : persisted.noticeTools ? 'full' : 'step';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-3" data-testid="weixin-panel">
      {/* 品牌头部（照 dsh header：绿 logo 方块 + 标题/副标题） */}
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#07c160] text-white">
          <WechatGlyph />
        </span>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold leading-5 text-xp-text">{t('weixin.title')}</div>
          <div className="text-[11px] leading-4 text-xp-text-secondary">{t('weixin.subtitle')}</div>
        </div>
      </div>

      {/* 状态点行（照 dsh statusline） */}
      <div className="flex items-center gap-1.5 text-[12px] text-xp-text-secondary">
        <StateDot state={dot} />
        <span>{statusText[state.status] ?? state.status}</span>
        {state.botId && <span className="ml-auto font-mono text-[11px] text-xp-text-muted">{state.botId.slice(0, 10)}…</span>}
      </div>

      {!isTauri() && (
        <div className="rounded-md border border-xp-border bg-xp-surface px-3 py-2 text-[11px] text-xp-text-muted">
          {t('weixin.desktopOnly')}
        </div>
      )}

      {/* Section 1 · 关联机器人 */}
      <Section title={t('weixin.secPair')} desc={t('weixin.secPairDesc')}>
        {!state.qrUrl && (state.status === 'idle' || state.status === 'expired' || state.status === 'error') && (
          <div className="py-2 text-center text-[11px] text-xp-text-muted">{t('weixin.qrWaiting')}</div>
        )}
        {state.qrUrl && (state.status === 'qr' || state.status === 'need-code' || state.status === 'connecting') && (
          <>
            {/* 二维码卡：白底圆角 16（可扫性，照 dsh qr-card）+ 角上刷新换新码 */}
            <div className="relative mx-auto w-fit rounded-2xl bg-white p-3 shadow-sm">
              <img src={state.qrUrl} alt={t('weixin.qrAlt')} className="h-40 w-40" />
              <button
                type="button"
                aria-label={t('weixin.refreshQr')}
                title={t('weixin.refreshQr')}
                onClick={() => void weixinBridge.beginPairing()}
                data-testid="weixin-refresh-qr"
                className="absolute right-1.5 top-1.5 rounded-md bg-black/5 p-1.5 text-xp-text-muted transition-colors hover:bg-black/10 hover:text-xp-text"
              >
                <RefreshCw size={13} />
              </button>
            </div>
            <div className="text-center text-[11px] text-xp-text-secondary">
              {statusText[state.status]}
            </div>
          </>
        )}
        {state.status === 'need-code' && (
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-[11px] text-xp-text-secondary">{t('weixin.codeLabel')}</span>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('weixin.codePlaceholder')}
              aria-label={t('weixin.codePlaceholder')}
              inputMode="numeric"
              data-testid="weixin-code"
              className="h-7"
            />
            <Button
              size="sm"
              className="h-7"
              onClick={() => {
                weixinBridge.submitVerifyCode(code);
                setCode('');
              }}
            >
              {t('weixin.codeSubmit')}
            </Button>
          </div>
        )}
        {state.status === 'connected' && (
          <>
            <div className="flex items-center gap-2 rounded-md border border-xp-border px-2.5 py-2">
              <StateDot state="ok" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-xp-text">{t('weixin.connectedTitle')}</div>
                <div className="truncate text-[11px] text-xp-text-muted">
                  {state.botId ? `bot ${state.botId}` : ''}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => void weixinBridge.unbind()}>
                {t('weixin.unbind')}
              </Button>
            </div>
            <div className="flex items-start gap-1.5 text-[11px] leading-4 text-xp-text-muted">
              <span aria-hidden="true">ⓘ</span>
              <span>{t('weixin.firstMsgNote')}</span>
            </div>
          </>
        )}
      </Section>

      {/* Section 2 · 回复颗粒度（照 dsh：SettingRow + 下拉） */}
      <Section title={t('weixin.granularity')}>
        <SettingRow label={t('weixin.granLabel')} description={t('weixin.granDesc')}>
          <SelectField
            value={granularity}
            onChange={(v) =>
              void weixinBridge.setPersisted(
                v === 'full'
                  ? { replyOn: 'step', noticeTools: true }
                  : v === 'step'
                    ? { replyOn: 'step', noticeTools: false }
                    : { replyOn: 'turn', noticeTools: false },
              )
            }
            options={[
              { value: 'full', label: t('weixin.granFull') },
              { value: 'step', label: t('weixin.granStep') },
              { value: 'turn', label: t('weixin.granTurn') },
            ]}
          />
        </SettingRow>
      </Section>

      {/* Section 3 · 文件夹访问范围（照 dsh 勾选列表；全不勾 = 不限制） */}
      <Section title={t('weixin.scope')} desc={t('weixin.scopeDesc')}>
        <div role="group" aria-label={t('weixin.scope')} className="space-y-1">
          {persisted.folders.length === 0 && (
            <div className="rounded-md px-1 py-1 text-[11px] text-xp-text-muted">{t('weixin.scopeAll')}</div>
          )}
          {persisted.folders.map((f) => (
            <button
              key={f}
              type="button"
              role="menuitemcheckbox"
              aria-checked
              className="group flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-xp-surface-light"
              onClick={() =>
                void weixinBridge.setPersisted({ folders: persisted.folders.filter((x) => x !== f) })
              }
              title={t('weixin.scopeRemove')}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-xp-accent bg-xp-accent text-white">
                <svg viewBox="0 0 20 20" className="h-3 w-3" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" />
                </svg>
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-xp-text" title={f}>
                {f}
              </span>
              <Trash2 size={12} className="shrink-0 text-xp-text-muted opacity-0 group-hover:opacity-100" />
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <Input
            value={folderDraft}
            onChange={(e) => setFolderDraft(e.target.value)}
            placeholder={t('weixin.scopePlaceholder')}
            aria-label={t('weixin.scopePlaceholder')}
            className="h-7"
          />
          {currentPath?.startsWith('/') && (
            <Button variant="outline" size="sm" className="h-7" title={currentPath} onClick={() => setFolderDraft(currentPath)}>
              {t('weixin.scopeCurrent')}
            </Button>
          )}
          <Button
            size="sm"
            className="h-7"
            disabled={!folderDraft.trim()}
            onClick={() => {
              const f = folderDraft.trim();
              if (f && !persisted.folders.includes(f)) {
                void weixinBridge.setPersisted({ folders: [...persisted.folders, f] });
              }
              setFolderDraft('');
            }}
          >
            <Plus size={11} />
            {t('weixin.scopeAdd')}
          </Button>
        </div>
      </Section>

      {/* 日志（排障折叠，不抢 DSH 结构的戏） */}
      {weixinBridge.getLogs().length > 0 && (
        <details className="mt-auto overflow-hidden rounded-md border border-xp-border">
          <summary className="cursor-pointer px-3 py-1.5 text-[11px] text-xp-text-muted hover:bg-xp-surface-light">
            {t('weixin.logs')}（{weixinBridge.getLogs().length}）
          </summary>
          <div className="max-h-36 space-y-0.5 overflow-y-auto border-t border-xp-border px-3 py-2 font-mono text-[11px] leading-4 text-xp-text-muted">
            {weixinBridge.getLogs().slice(-15).reverse().map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};

export default WeixinBridgePanel;
