import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, RotateCw, Trash2 } from 'lucide-react';
import { formatFileSize } from '@/lib/utils';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';
import { isWindows, isMac } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import type { CleanupSuggestion } from '@/hooks/use-performance-stats';
import { PanelConfirmation, PanelMessage } from '../PanelFeedback';
import BatchRename from './BatchRename';

interface MetricCardsProps {
  suggestions: CleanupSuggestion[];
  allFiles: FileEntry[];
  isLoading: boolean;
  onRefresh: () => void;
}
const MetricCards = ({ suggestions, allFiles, isLoading, onRefresh }: MetricCardsProps) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const trash = suggestions.find((item) => item.id === 'trash');
  const handleTrash = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      if (isWindows) {
        const count = await TauriAPI.emptyTrash();
        setResult(t('panelActions.trashEmptied', { count }));
      } else {
        const directories = await TauriAPI.getUserDirectories();
        await TauriAPI.openFile(
          `${directories.home}/${isMac ? '.Trash' : '.local/share/Trash/files'}`,
        );
      }
      setConfirming(false);
      onRefresh();
    } catch (err) {
      setError(t('panelActions.trashFailed', { error: String(err) }));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="px-4 pb-4">
      <section className="wisp-panel-section !px-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className="wisp-panel-section-title">{t('navigation.trash')}</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label={t('performanceDashboard.refresh')}
          >
            <RotateCw size={14} aria-hidden="true" />
          </Button>
        </div>
        <p className="wisp-panel-help">
          {t(isWindows ? 'panelActions.trashWindows' : 'panelActions.trashSystem')}
        </p>
        {trash && (
          <p className="mb-3 text-xs text-xp-text-secondary">
            {trash.description}
            {trash.estimatedSize > 0 ? ` · ${formatFileSize(trash.estimatedSize)}` : ''}
          </p>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => (isWindows ? setConfirming(true) : void handleTrash())}
          disabled={busy || (isWindows && !trash)}
        >
          {isWindows ? (
            <Trash2 size={14} aria-hidden="true" />
          ) : (
            <ExternalLink size={14} aria-hidden="true" />
          )}
          {t(isWindows ? 'performance.suggestions.emptyTrash' : 'panelActions.openSystemTrash')}
        </Button>
        {error && <PanelMessage error>{error}</PanelMessage>}
        {result && <PanelMessage>{result}</PanelMessage>}
      </section>
      <BatchRename files={allFiles} onDone={onRefresh} />
      <PanelConfirmation
        open={confirming}
        title={t('panelActions.emptyTrashTitle')}
        description={t('panelActions.emptyTrashDescription')}
        confirmLabel={t('performance.suggestions.emptyTrash')}
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void handleTrash()}
      />
    </div>
  );
};
export default MetricCards;
