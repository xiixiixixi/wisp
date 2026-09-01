import { useTranslation } from 'react-i18next';
import { FileCode, Trash2 } from 'lucide-react';
import { useOpenWithPrefs, type OpenHandler } from '@/hooks/use-open-with-prefs';
import { SectionTitle, Divider } from './shared';

const HANDLER_LABELS: Record<OpenHandler, string> = {
  'wisp-editor': 'openWith.wispEditor',
  vscode: 'openWith.vscode',
  system: 'openWith.systemDefault',
};

const FileAssociationsSettings = () => {
  const { t } = useTranslation();
  const { prefs, clearPreference, clearAll } = useOpenWithPrefs();

  const entries = Object.entries(prefs);

  return (
    <div className="space-y-4">
      <SectionTitle title={t('settings.fileAssociations.title')} />
      <p className="px-4 pb-2 text-xs text-xp-text-secondary">
        {t('settings.fileAssociations.description')}
      </p>

      {entries.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-xp-text-secondary">
          {t('settings.fileAssociations.noPreferences')}
        </div>
      ) : (
        <>
          <div className="space-y-4 px-2">
            {entries.map(([ext, handler]) => (
              <div
                key={ext}
                className="flex items-center justify-between rounded-[2px] px-3 py-2.5 transition-colors hover:bg-xp-surface-light/50"
              >
                <div className="flex items-center gap-3">
                  <FileCode size={16} className="shrink-0 text-xp-text-secondary" />
                  <div>
                    <span className="text-sm font-medium text-xp-text">.{ext}</span>
                    <span className="ml-2 text-xs text-xp-text-secondary">
                      → {t(HANDLER_LABELS[handler])}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => clearPreference(ext)}
                  className="rounded-[2px] p-1.5 text-xp-text-secondary transition-colors hover:text-xp-red"
                  title={t('settings.fileAssociations.reset')}
                  aria-label={t('settings.fileAssociations.resetExt', { ext })}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <Divider />

          <div className="px-4 py-2">
            <button
              onClick={clearAll}
              className="text-sm text-xp-text-secondary transition-colors hover:text-xp-red"
            >
              {t('settings.fileAssociations.resetAll')}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default FileAssociationsSettings;
