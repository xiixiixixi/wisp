import { useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TauriAPI } from '@/lib/tauri-api';
import { isTauri } from '@/lib/transport';
import useUpdater from '@/hooks/use-updater';
import wispLogo from '../../../../src-tauri/icons/icon.png';
import '@/styles/general-settings.css';

/** Uses the same desktop check/install flow as the existing update notification. */
const AboutUpdateControl = () => {
  const { t } = useTranslation();
  const { status, checkForUpdate, installUpdate } = useUpdater();
  const [phase, setPhase] = useState<
    'idle' | 'checking' | 'latest' | 'available' | 'failed' | 'install-failed'
  >('idle');
  const [installing, setInstalling] = useState(false);

  const handleCheck = async () => {
    setPhase('checking');
    try {
      const update = await checkForUpdate();
      setPhase(update ? 'available' : 'latest');
    } catch {
      setPhase('failed');
    }
  };

  const handleInstall = async () => {
    setInstalling(true);
    setPhase('idle');
    try {
      await installUpdate();
    } catch {
      setPhase('install-failed');
    } finally {
      setInstalling(false);
    }
  };

  const available = phase === 'available' || status.available;
  const busy = installing || status.downloading;
  const failed = !busy && (phase === 'failed' || phase === 'install-failed' || !!status.error);
  const statusText = () => {
    if (status.downloading) return `${t('updater.downloading')} ${Math.round(status.progress)}%`;
    if (phase === 'checking') return t('updater.checking');
    if (failed) {
      return phase === 'install-failed' || status.error
        ? t('settings.about.installFailed', {
            defaultValue: 'Couldn’t install the update. Try again.',
          })
        : t('updater.failed');
    }
    if (phase === 'latest') return t('updater.upToDate');
    if (available) return t('updater.available', { version: status.version });
    return null;
  };

  return (
    <div className="wisp-settings-update">
      <Button
        variant="secondary"
        onClick={available ? handleInstall : handleCheck}
        disabled={phase === 'checking' || busy}
      >
        {available ? (
          <Download size={14} aria-hidden="true" />
        ) : (
          <RefreshCw size={14} aria-hidden="true" />
        )}
        {available ? t('updater.install') : t('updater.checkNow')}
      </Button>
      <p
        className="wisp-settings-update-status"
        role={failed ? 'alert' : 'status'}
        aria-live={failed ? 'assertive' : 'polite'}
      >
        {statusText()}
      </p>
    </div>
  );
};

const BrowserUpdateControl = () => {
  const { t } = useTranslation();
  const [showHint, setShowHint] = useState(false);

  return (
    <div className="wisp-settings-update">
      <Button variant="secondary" onClick={() => setShowHint(true)}>
        <RefreshCw size={14} aria-hidden="true" />
        {t('updater.checkNow')}
      </Button>
      <p className="wisp-settings-update-status" role="status" aria-live="polite">
        {showHint &&
          t('settings.about.desktopUpdateHint', {
            defaultValue: 'Check for and install updates in the Wisp desktop app.',
          })}
      </p>
    </div>
  );
};

const AboutSettings = () => {
  const { t } = useTranslation();
  const [linkFailed, setLinkFailed] = useState(false);

  const handleLinkClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isTauri()) return;
    event.preventDefault();
    setLinkFailed(false);
    void TauriAPI.openUrl(event.currentTarget.href).catch(() => setLinkFailed(true));
  };

  return (
    <section className="wisp-settings-about" aria-label={t('settings.tabs.about')}>
      <div className="wisp-settings-about-header">
        <div className="wisp-settings-about-identity">
          <img src={wispLogo} alt="" width={40} height={40} aria-hidden="true" />
          <div>
            <h3>Wisp</h3>
            <p>v{__APP_VERSION__}</p>
          </div>
        </div>
        {isTauri() ? <AboutUpdateControl /> : <BrowserUpdateControl />}
      </div>
      <div className="wisp-settings-about-links">
        {[
          { href: 'https://github.com/xiixiixixi/wisp', label: 'GitHub' },
          {
            href: 'https://github.com/xiixiixixi/wisp/releases',
            label: t('interface.releases'),
          },
          {
            href: 'https://github.com/sponsors/xiixiixixi',
            label: t('settings.about.support', { defaultValue: 'Support Wisp' }),
          },
        ].map(({ href, label }) => (
          <a
            key={href}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleLinkClick}
          >
            {label}
          </a>
        ))}
      </div>
      {linkFailed && (
        <p className="wisp-settings-about-error" role="alert">
          {t('settings.about.openLinkFailed', {
            defaultValue: 'Couldn’t open the link. Try again.',
          })}
        </p>
      )}
    </section>
  );
};

export default AboutSettings;
