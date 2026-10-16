import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PanelMessage } from '../PanelFeedback';

type RenameResult = {
  original_name: string;
  new_name: string;
  success: boolean;
  error: string | null;
};
type Preview = {
  signature: string;
  paths: string[];
  pattern: string;
  replacement: string;
  results: RenameResult[];
};

const BatchRename = ({ files, onDone }: { files: FileEntry[]; onDone: () => void }) => {
  const { t } = useTranslation();
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [running, setRunning] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const requestId = useRef(0);
  const paths = useMemo(() => files.filter((f) => !f.is_dir).map((f) => f.path), [files]);
  const pattern = useRegex ? findText : findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const signature = JSON.stringify([paths, pattern, replaceText]);
  const liveSignature = useRef(signature);
  liveSignature.current = signature;
  const current = preview?.signature === signature ? preview : null;
  const changed = current?.results.filter((r) => r.success && r.new_name !== r.original_name) ?? [];
  const conflicts = current?.results.filter((r) => !r.success) ?? [];

  const runPreview = async () => {
    if (!findText || previewing || running) return;
    const request = ++requestId.current;
    setPreviewing(true);
    setFeedback(null);
    try {
      const results = await TauriAPI.bulkRename(paths, pattern, replaceText, true);
      if (request === requestId.current && signature === liveSignature.current) {
        setPreview({ signature, paths, pattern, replacement: replaceText, results });
      }
    } catch (error) {
      if (request === requestId.current)
        {setFeedback({
          text: t('panelActions.previewFailed', { error: String(error) }),
          error: true,
        });}
    } finally {
      if (request === requestId.current) setPreviewing(false);
    }
  };

  const execute = async () => {
    if (!current || running || changed.length === 0) return;
    setRunning(true);
    setFeedback(null);
    try {
      const targets = current.paths.filter((path) =>
        changed.some((item) => item.original_name === path.split(/[\\/]/).pop()),
      );
      const results = await TauriAPI.bulkRename(
        targets,
        current.pattern,
        current.replacement,
        false,
      );
      const succeeded = results.filter(
        (item) => item.success && item.original_name !== item.new_name,
      ).length;
      const failed = results.filter((item) => !item.success);
      setFeedback({
        text: failed.length
          ? `${t('panelActions.renamePartial', { count: succeeded, failed: failed.length }) 
            } ${ 
            failed
              .slice(0, 3)
              .map((item) => `${item.original_name}: ${item.error ?? ''}`)
              .join(' · ')}`
          : t('performanceDashboard.renameDone', { count: succeeded }),
        error: failed.length > 0,
      });
      setPreview(null);
      window.dispatchEvent(new CustomEvent('files-changed'));
      onDone();
    } catch (error) {
      setFeedback({ text: t('panelActions.renameFailed', { error: String(error) }), error: true });
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="wisp-panel-section !px-0 !pb-0">
      <h3 className="wisp-panel-section-title">{t('performanceDashboard.batchRename')}</h3>
      <p className="wisp-panel-help">{t('panelActions.renameScope', { count: paths.length })}</p>
      <div className="wisp-panel-fields wisp-panel-fields-pair">
        <label>
          {t('panelActions.findLabel')}
          <Input
            value={findText}
            disabled={running}
            autoComplete="off"
            onChange={(e) => setFindText(e.target.value)}
            placeholder={t('performanceDashboard.findPlaceholder')}
          />
        </label>
        <label>
          {t('panelActions.replaceLabel')}
          <Input
            value={replaceText}
            disabled={running}
            autoComplete="off"
            onChange={(e) => setReplaceText(e.target.value)}
            placeholder={t('performanceDashboard.replacePlaceholder')}
          />
        </label>
      </div>
      <label className="my-3 flex items-center gap-2 text-xs text-xp-text-secondary">
        <input
          type="checkbox"
          checked={useRegex}
          disabled={running}
          onChange={(e) => setUseRegex(e.target.checked)}
        />
        {t('panelActions.regexLabel')}
      </label>
      <div className="wisp-panel-actions">
        <Button
          variant="outline"
          size="sm"
          onClick={runPreview}
          disabled={!findText || !paths.length || running || previewing}
        >
          {previewing ? t('panelActions.previewing') : t('performanceDashboard.previewRename')}
        </Button>
        {changed.length > 0 && (
          <Button size="sm" onClick={execute} disabled={running}>
            {running
              ? t('performanceDashboard.renaming')
              : t('performanceDashboard.renameCount', { count: changed.length })}
          </Button>
        )}
      </div>
      {preview && !current && <PanelMessage>{t('panelActions.previewOutdated')}</PanelMessage>}
      {feedback && <PanelMessage error={feedback.error}>{feedback.text}</PanelMessage>}
      {current && current.results.length > 0 && (
        <div
          className="mt-3 max-h-52 overflow-y-auto rounded-lg border border-xp-border"
          aria-label={t('performanceDashboard.previewRename')}
        >
          {current.results.map((item, index) => (
            <div
              key={`${item.original_name}-${index}`}
              className="flex items-center gap-2 border-b border-xp-border px-3 py-2 text-xs last:border-0"
            >
              <span className="min-w-0 flex-1 break-all text-xp-text-secondary">
                {item.original_name}
              </span>
              <ArrowRight
                size={12}
                className="shrink-0 text-xp-text-secondary"
                aria-hidden="true"
              />
              <span
                className={`min-w-0 flex-1 break-all ${item.success ? 'text-xp-text' : 'text-xp-red'}`}
              >
                {item.success ? item.new_name : item.error}
              </span>
            </div>
          ))}
        </div>
      )}
      {current && changed.length === 0 && conflicts.length === 0 && (
        <PanelMessage>{t('panelActions.noRenameChanges')}</PanelMessage>
      )}
      {conflicts.length > 0 && (
        <PanelMessage error>
          {t('performanceDashboard.renameConflicts', { count: conflicts.length })}
        </PanelMessage>
      )}
    </section>
  );
};
export default BatchRename;
