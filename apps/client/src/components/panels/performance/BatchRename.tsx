import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Check, Regex, Wand2 } from 'lucide-react';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';

/**
 * Batch rename for the files in the current directory: regex find & replace
 * with a live preview (unmatched / conflicting targets flagged) executed via
 * the bulk_rename backend command. The 100%-standard feature of every
 * competitor file manager.
 */
const BatchRename = ({ files, onDone }: { files: FileEntry[]; onDone: () => void }) => {
  const { t } = useTranslation();
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [preview, setPreview] = useState<
    { original_name: string; new_name: string; success: boolean; error: string | null }[]
  >([]);
  const [running, setRunning] = useState(false);
  const [doneCount, setDoneCount] = useState<number | null>(null);

  const renamable = useMemo(() => files.filter((f) => !f.is_dir), [files]);

  const buildPattern = useCallback(
    (raw: string) => (useRegex ? raw : raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    [useRegex],
  );

  const runPreview = useCallback(async () => {
    if (!findText) return;
    setDoneCount(null);
    try {
      const result = await TauriAPI.bulkRename(
        renamable.map((f) => f.path),
        buildPattern(findText),
        replaceText,
        true,
      );
      setPreview(result);
    } catch (err) {
      setPreview([
        {
          original_name: '',
          new_name: '',
          success: false,
          error: String(err),
        },
      ]);
    }
  }, [findText, replaceText, renamable, buildPattern]);

  const changed = preview.filter((r) => r.success && r.new_name !== r.original_name);
  const conflicted = preview.filter((r) => !r.success);

  const execute = useCallback(async () => {
    setRunning(true);
    try {
      const targets = renamable
        .map((f) => f.path)
        .filter((path) => {
          const name = path.split(/[\\/]/).pop() || path;
          return changed.some((c) => c.original_name === name);
        });
      await TauriAPI.bulkRename(targets, buildPattern(findText), replaceText, false);
      setDoneCount(targets.length);
      setPreview([]);
      onDone();
    } catch {
      // audit log records failures; panel refresh shows state
    } finally {
      setRunning(false);
    }
  }, [renamable, changed, findText, replaceText, buildPattern, onDone]);

  return (
    <div className="glass-card rounded-xl p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-xp-text-muted">
          {t('performanceDashboard.batchRename')}
        </span>
        <button
          type="button"
          onClick={() => setUseRegex((v) => !v)}
          className={`flex h-6 items-center gap-1 rounded-full px-2 text-[10px] transition-colors ${
            useRegex
              ? 'bg-xp-lime text-[#1d1c1a]'
              : 'bg-card text-xp-text-secondary shadow-[0_1px_5px_rgba(29,28,26,0.08)]'
          }`}
          title={t('performanceDashboard.regexToggle')}
        >
          <Regex size={10} aria-hidden="true" />
          {useRegex ? '.*' : t('performanceDashboard.plainText')}
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <input
          value={findText}
          onChange={(e) => setFindText(e.target.value)}
          placeholder={t('performanceDashboard.findPlaceholder')}
          className="border-xp-border/60 bg-xp-bg/60 h-8 min-w-0 flex-1 rounded-lg border px-2.5 text-xs text-xp-text placeholder-xp-text-muted focus:border-xp-blue/50 focus:outline-none"
        />
        <ArrowRight size={12} className="shrink-0 text-xp-text-muted" aria-hidden="true" />
        <input
          value={replaceText}
          onChange={(e) => setReplaceText(e.target.value)}
          placeholder={t('performanceDashboard.replacePlaceholder')}
          className="border-xp-border/60 bg-xp-bg/60 h-8 min-w-0 flex-1 rounded-lg border px-2.5 text-xs text-xp-text placeholder-xp-text-muted focus:border-xp-blue/50 focus:outline-none"
        />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={runPreview}
          disabled={!findText || renamable.length === 0}
          className="flex h-7 flex-1 items-center justify-center gap-1 rounded-full bg-card px-3 text-[11px] font-medium text-xp-text shadow-[0_1px_5px_rgba(29,28,26,0.08)] transition-transform hover:-translate-y-px disabled:opacity-40"
        >
          <Wand2 size={11} aria-hidden="true" />
          {t('performanceDashboard.previewRename')}
        </button>
        {changed.length > 0 && (
          <button
            type="button"
            onClick={execute}
            disabled={running}
            className="flex h-7 items-center gap-1 rounded-full bg-xp-blue px-3.5 text-[11px] font-medium text-white disabled:opacity-50"
          >
            <Check size={11} aria-hidden="true" />
            {running
              ? t('performanceDashboard.renaming')
              : t('performanceDashboard.renameCount', { count: changed.length })}
          </button>
        )}
      </div>

      {doneCount !== null && doneCount > 0 && (
        <p className="mt-2 text-[11px] text-xp-green">
          {t('performanceDashboard.renameDone', { count: doneCount })}
        </p>
      )}

      {preview.length > 0 && (
        <div className="border-xp-border/40 mt-2 max-h-44 overflow-y-auto rounded-lg border">
          {preview.slice(0, 30).map((r, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 px-2 py-1 text-[10px]"
              style={{ borderTop: i === 0 ? 'none' : '1px solid var(--xp-border)' }}
            >
              <span
                className="min-w-0 flex-1 truncate text-xp-text-secondary"
                title={r.original_name}
              >
                {r.original_name}
              </span>
              {r.success ? (
                <>
                  <ArrowRight size={9} className="shrink-0 text-xp-text-muted" aria-hidden="true" />
                  <span
                    className="min-w-0 flex-1 truncate font-medium text-xp-text"
                    title={r.new_name}
                  >
                    {r.new_name}
                  </span>
                </>
              ) : (
                <span className="flex-1 truncate text-xp-red" title={r.error || ''}>
                  {r.error}
                </span>
              )}
            </div>
          ))}
          {preview.length > 30 && (
            <div className="px-2 py-1 text-[10px] text-xp-text-muted">+{preview.length - 30}</div>
          )}
        </div>
      )}

      {conflicted.length > 0 && changed.length > 0 && (
        <p className="mt-1.5 text-[10px] text-xp-yellow">
          {t('performanceDashboard.renameConflicts', { count: conflicted.length })}
        </p>
      )}
    </div>
  );
};

export default BatchRename;
