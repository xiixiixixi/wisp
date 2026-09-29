/** 微信机器人侧栏：连接状态、扫码操作和消息/文件夹设置。 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectField } from '@/components/settings/shared';
import { weixinBridge } from '@/lib/weixin/bridge';
import { isTauri } from '@/lib/transport';
import { TauriAPI } from '@/lib/tauri-api';
import { PanelConfirmation, PanelMessage } from './PanelFeedback';

const StateDot = ({ state }: { state: 'ok' | 'err' | 'wait' }) => (
  <span
    aria-hidden="true"
    className={`inline-block h-2 w-2 shrink-0 rounded-full ${
      state === 'ok'
        ? 'bg-[#07c160]'
        : state === 'err'
          ? 'bg-xp-red'
          : 'bg-xp-border-strong bg-xp-text-muted'
    }`}
  />
);

const Section = ({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) => (
  <section className="wisp-panel-section">
    <h3 className="wisp-panel-section-title">{title}</h3>
    {desc && <p className="mt-1 text-xs leading-5 text-xp-text-secondary">{desc}</p>}
    <div className="mt-3 space-y-3">{children}</div>
  </section>
);

const WeixinBridgePanel = ({ currentPath }: { currentPath: string }) => {
  const { t } = useTranslation();
  const [, force] = useState(0);
  const [code, setCode] = useState('');
  const [folderDraft, setFolderDraft] = useState('');
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'unrestrict' | 'unbind' | null>(null);

  const [saving, setSaving] = useState(false);
  const saveSettings = async (next: Parameters<typeof weixinBridge.setPersisted>[0]) => {
    setSaving(true);
    setScopeError(null);
    try {
      await weixinBridge.setPersisted(next);
      return true;
    } catch (error) {
      setScopeError(t('panelActions.saveFailed', { error: String(error) }));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const addFolder = async (folder: string) => {
    const value = folder.trim();
    if (!value.startsWith('/') && !/^[a-z]:[\\/]/i.test(value)) {
      setScopeError(t('panelActions.absoluteFolder'));
      return;
    }
    const folders = weixinBridge.getPersisted().folders;
    if (await saveSettings({ folders: folders.includes(value) ? folders : [...folders, value] }))
      {setFolderDraft('');}
  };
  const chooseFolder = async () => {
    try {
      const paths = await TauriAPI.showOpenDialog({ directory: true, multiple: false });
      if (paths?.[0]) await addFolder(paths[0]);
    } catch (error) {
      setScopeError(String(error));
    }
  };

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
  const desktopAvailable = isTauri();
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
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="weixin-panel">
      <div className="border-b border-xp-border px-4 pb-4 pt-4">
        <p className="text-xs leading-5 text-xp-text-secondary">{t('weixin.intro')}</p>
        {desktopAvailable && (
          <div
            role="status"
            className="mt-3 flex min-w-0 items-center gap-2 text-xs font-medium text-xp-text"
          >
            <StateDot state={dot} />
            <span>{statusText[state.status] ?? state.status}</span>
          </div>
        )}
      </div>

      <Section
        title={t(desktopAvailable ? 'weixin.secPair' : 'weixin.browserHeading')}
        desc={
          desktopAvailable && state.status !== 'connected' ? t('weixin.secPairDesc') : undefined
        }
      >
        {!desktopAvailable && (
          <>
            <p className="text-xs leading-5 text-xp-text-secondary">{t('weixin.desktopOnly')}</p>
            <p className="text-xs leading-5 text-xp-text-secondary">
              {t('weixin.desktopSettingsHint')}
            </p>
          </>
        )}
        {desktopAvailable && (state.status === 'error' || state.status === 'expired') && (
          <>
            <PanelMessage error>{state.error || statusText[state.status]}</PanelMessage>
            <Button variant="outline" size="sm" onClick={() => void weixinBridge.beginPairing()}>
              {t('panelActions.retryPairing')}
            </Button>
          </>
        )}
        {desktopAvailable && !state.qrUrl && state.status === 'idle' && (
          <p className="text-xs text-xp-text-secondary">{t('weixin.qrWaiting')}</p>
        )}
        {desktopAvailable &&
          state.qrUrl &&
          (state.status === 'qr' ||
            state.status === 'need-code' ||
            state.status === 'connecting') && (
            <div className="relative mx-auto w-fit rounded-xl bg-white p-2">
              <img src={state.qrUrl} alt={t('weixin.qrAlt')} className="h-40 w-40" />
              <button
                type="button"
                aria-label={t('weixin.refreshQr')}
                title={t('weixin.refreshQr')}
                onClick={() => void weixinBridge.beginPairing()}
                data-testid="weixin-refresh-qr"
                className="absolute right-1 top-1 rounded-md bg-black/5 p-1.5 text-xp-text-muted transition-colors hover:bg-black/10 hover:text-xp-text"
              >
                <RefreshCw size={13} />
              </button>
            </div>
          )}
        {desktopAvailable && state.status === 'need-code' && (
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-xs text-xp-text-secondary">{t('weixin.codeLabel')}</span>
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
        {desktopAvailable && state.status === 'connected' && (
          <>
            <div className="flex items-center justify-between gap-3">
              <span
                className="min-w-0 truncate font-mono text-xs text-xp-text-secondary"
                title={state.botId}
              >
                {state.botId || t('weixin.connectedTitle')}
              </span>
              <Button variant="outline" size="sm" onClick={() => setConfirmAction('unbind')}>
                {t('weixin.unbind')}
              </Button>
            </div>
            <p className="text-xs leading-5 text-xp-text-secondary">{t('weixin.firstMsgNote')}</p>
          </>
        )}
      </Section>

      {scopeError && (
        <div className="px-4">
          <PanelMessage error>{scopeError}</PanelMessage>
        </div>
      )}
      {desktopAvailable && (
        <>
          <Section title={t('weixin.granularity')} desc={t('weixin.granDesc')}>
            <div className="w-full [&_button]:!w-full">
              <SelectField
                value={granularity}
                label={t('weixin.granularity')}
                onChange={(v) =>
                  void saveSettings(
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
            </div>
          </Section>

          <Section title={t('weixin.scope')} desc={t('weixin.scopeDesc')}>
            <p className="text-xs font-medium leading-5 text-xp-text">
              {t(persisted.folders.length ? 'panelActions.scopeRestricted' : 'weixin.scopeAll')}
            </p>
            <ul className="space-y-1" aria-label={t('weixin.scope')}>
              {persisted.folders.map((folder) => (
                <li
                  key={folder}
                  className="flex items-center gap-2 border-b border-xp-border py-2 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 break-all text-xs text-xp-text">{folder}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={saving || persisted.folders.length === 1}
                    aria-label={t('panelActions.removeFolder', { folder })}
                    title={t('panelActions.removeFolder', { folder })}
                    onClick={() =>
                      void saveSettings({
                        folders: persisted.folders.filter((item) => item !== folder),
                      })
                    }
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
            {persisted.folders.length > 0 && (
              <p className="text-xs leading-5 text-xp-text-secondary">
                {t('panelActions.keepFolderScope')}
              </p>
            )}
            <div className="wisp-panel-actions">
              <Button variant="outline" size="sm" onClick={() => void chooseFolder()}>
                {t('panelActions.chooseFolder')}
              </Button>
              {currentPath?.startsWith('/') && (
                <Button
                  variant="outline"
                  size="sm"
                  title={currentPath}
                  onClick={() => void addFolder(currentPath)}
                >
                  {t('chatgptBridge.addCurrentRoot')}
                </Button>
              )}
              {persisted.folders.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setConfirmAction('unrestrict')}>
                  {t('panelActions.allowAllFolders')}
                </Button>
              )}
            </div>
            <details>
              <summary className="cursor-pointer py-2 text-xs text-xp-text-secondary">
                {t('panelActions.enterFolderPath')}
              </summary>
              <div className="flex gap-2">
                <Input
                  value={folderDraft}
                  onChange={(e) => setFolderDraft(e.target.value)}
                  placeholder={t('weixin.scopePlaceholder')}
                  aria-label={t('weixin.scopePlaceholder')}
                />
                <Button
                  size="sm"
                  disabled={!folderDraft.trim()}
                  onClick={() => void addFolder(folderDraft)}
                >
                  {t('weixin.scopeAdd')}
                </Button>
              </div>
            </details>
          </Section>
        </>
      )}

      <PanelConfirmation
        open={confirmAction !== null}
        title={t(
          confirmAction === 'unbind' ? 'panelActions.unbindTitle' : 'panelActions.unrestrictTitle',
        )}
        description={t(
          confirmAction === 'unbind'
            ? 'panelActions.unbindDescription'
            : 'panelActions.unrestrictDescription',
        )}
        confirmLabel={t(
          confirmAction === 'unbind' ? 'weixin.unbind' : 'panelActions.allowAllFolders',
        )}
        busy={saving}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          void (async () => {
            setSaving(true);
            try {
              if (confirmAction === 'unbind') await weixinBridge.unbind();
              else await saveSettings({ folders: [] });
              setConfirmAction(null);
            } catch (error) {
              setScopeError(t('panelActions.saveFailed', { error: String(error) }));
              setConfirmAction(null);
            } finally {
              setSaving(false);
            }
          })();
        }}
      />
      {weixinBridge.getLogs().length > 0 && (
        <details className="mt-auto border-t border-xp-border px-4 py-3">
          <summary className="cursor-pointer text-xs text-xp-text-secondary">
            {t('weixin.logs')}（{weixinBridge.getLogs().length}）
          </summary>
          <div className="mt-2 max-h-36 space-y-0.5 overflow-y-auto font-mono text-xs leading-4 text-xp-text-muted">
            {weixinBridge
              .getLogs()
              .slice(-15)
              .reverse()
              .map((l, i) => (
                <div key={i}>{l}</div>
              ))}
          </div>
        </details>
      )}
    </div>
  );
};

export default WeixinBridgePanel;
