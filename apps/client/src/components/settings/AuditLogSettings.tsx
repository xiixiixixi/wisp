import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download,
  Trash2,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  XCircle,
  Filter,
  Calendar,
} from 'lucide-react';
import { SectionTitle, SelectField, Divider } from './shared';
import { TauriAPI, type AuditEntry } from '@/lib/tauri-api';

const PAGE_SIZE = 20;

const formatTimestamp = (iso: string): string => {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
};

const truncatePath = (path: string, maxLen = 50): string => {
  if (path.length <= maxLen) return path;
  return `...${path.slice(path.length - maxLen + 3)}`;
};

const AuditLogSettings = () => {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [operationFilter, setOperationFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const operationOptions = [
    { value: 'all', label: t('settings.audit.operations.all') },
    { value: 'copy', label: t('settings.audit.operations.copy') },
    { value: 'move', label: t('settings.audit.operations.move') },
    { value: 'rename', label: t('settings.audit.operations.rename') },
    { value: 'delete', label: t('settings.audit.operations.delete') },
    { value: 'secure_delete', label: t('settings.audit.operations.secureDelete') },
    { value: 'compress', label: t('settings.audit.operations.compress') },
    { value: 'extract', label: t('settings.audit.operations.extract') },
    { value: 'encrypt', label: t('settings.audit.operations.encrypt') },
    { value: 'decrypt', label: t('settings.audit.operations.decrypt') },
  ];

  const fetchLog = useCallback(async () => {
    setLoading(true);
    try {
      const fromISO = dateFrom ? new Date(dateFrom).toISOString() : undefined;
      const toISO = dateTo ? new Date(`${dateTo}T23:59:59`).toISOString() : undefined;
      const filterValue = operationFilter === 'all' ? undefined : operationFilter;
      const result = await TauriAPI.getAuditLog(
        PAGE_SIZE,
        page * PAGE_SIZE,
        filterValue,
        fromISO,
        toISO,
      );
      setEntries(result.entries);
      setTotal(result.total);
    } catch (err) {
      console.error('Failed to fetch audit log:', err);
      setEntries([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, operationFilter, dateFrom, dateTo]);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  useEffect(() => {
    setPage(0);
  }, [operationFilter, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleClear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    try {
      await TauriAPI.clearAuditLog();
      setConfirmClear(false);
      setPage(0);
      fetchLog();
    } catch (err) {
      console.error('Failed to clear audit log:', err);
    }
  };

  const handleExport = async () => {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const defaultName = `wisp_audit_log_${timestamp}.csv`;
      const outputPath = await save({
        defaultPath: defaultName,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (!outputPath) return;
      await TauriAPI.exportAuditLog(outputPath);
      setExportStatus(t('settings.audit.exportedTo', { path: outputPath }));
      setTimeout(() => setExportStatus(null), 5000);
    } catch (err) {
      setExportStatus(t('settings.audit.exportFailed', { error: err }));
      setTimeout(() => setExportStatus(null), 5000);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title={t('settings.audit.filtersTitle')}
        description={t('settings.audit.filtersDesc')}
      />

      <div className="flex flex-wrap items-end gap-3 px-4 py-2">
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-1 text-xs text-xp-text-secondary">
            <Filter size={12} />
            {t('settings.audit.operationLabel')}
          </label>
          <SelectField
            value={operationFilter}
            onChange={setOperationFilter}
            options={operationOptions}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-1 text-xs text-xp-text-secondary">
            <Calendar size={12} />
            {t('settings.audit.fromLabel')}
          </label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 rounded-md border border-xp-border bg-xp-bg px-2 text-sm text-xp-text"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-1 text-xs text-xp-text-secondary">
            <Calendar size={12} />
            {t('settings.audit.toLabel')}
          </label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-9 rounded-md border border-xp-border bg-xp-bg px-2 text-sm text-xp-text"
          />
        </div>
      </div>

      <Divider />

      <SectionTitle
        title={t('settings.audit.entriesTitle')}
        description={
          loading
            ? t('settings.audit.entriesCountLoading', { count: total })
            : t('settings.audit.entriesCount', { count: total })
        }
      />

      {/* Table */}
      <div className="px-4">
        <div className="overflow-hidden rounded-lg border border-xp-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-xp-surface-light/50 text-xs uppercase tracking-wider text-xp-text-secondary">
                <th className="px-3 py-2 text-left font-medium">
                  {t('settings.audit.colTimestamp')}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {t('settings.audit.colOperation')}
                </th>
                <th className="px-3 py-2 text-left font-medium">{t('settings.audit.colPaths')}</th>
                <th className="w-16 px-3 py-2 text-center font-medium">
                  {t('settings.audit.colStatus')}
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-sm text-xp-text-secondary">
                    {loading ? t('settings.audit.loading') : t('settings.audit.noEntries')}
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-xp-border/30 border-t transition-colors hover:bg-xp-surface-light/30"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-xp-text-secondary">
                      {formatTimestamp(entry.timestamp)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${operationBadgeClass(entry.operation)}`}
                      >
                        {entry.operation}
                      </span>
                    </td>
                    <td className="max-w-[300px] px-3 py-2 text-xs text-xp-text">
                      <div className="space-y-4">
                        {entry.paths.map((p) => (
                          <div key={p} className="truncate" title={p}>
                            {truncatePath(p)}
                          </div>
                        ))}
                      </div>
                      {entry.details && (
                        <div className="mt-0.5 italic text-xp-text-secondary">{entry.details}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {entry.success ? (
                        <CheckCircle size={16} className="inline text-xp-green" />
                      ) : (
                        <XCircle size={16} className="inline text-xp-red" />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2">
          <div className="text-xs text-xp-text-secondary">
            {t('settings.audit.pageOf', { page: page + 1, total: totalPages })}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-md p-1.5 text-xp-text-secondary transition-colors hover:bg-xp-surface hover:text-xp-text disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded-md p-1.5 text-xp-text-secondary transition-colors hover:bg-xp-surface hover:text-xp-text disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      <Divider />

      <SectionTitle title={t('settings.audit.actionsTitle')} />

      <div className="flex flex-wrap items-center gap-3 px-4 py-2">
        <button
          onClick={handleExport}
          className="flex items-center gap-2 rounded-md bg-xp-accent/15 px-4 py-2 text-sm font-medium text-xp-accent transition-colors hover:bg-xp-accent/25"
        >
          <Download size={16} />
          {t('settings.audit.exportCsv')}
        </button>

        <button
          onClick={handleClear}
          onBlur={() => setConfirmClear(false)}
          className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            confirmClear
              ? 'border border-xp-red/40 bg-xp-red/20 text-xp-red'
              : 'bg-xp-red/10 text-xp-red/70 hover:bg-xp-red/20'
          }`}
        >
          <Trash2 size={16} />
          {confirmClear ? t('settings.audit.clearLogConfirm') : t('settings.audit.clearLog')}
        </button>
      </div>

      {exportStatus && (
        <div className="px-4 py-2">
          <div className="rounded-md bg-xp-surface px-3 py-2 text-xs text-xp-text-secondary">
            {exportStatus}
          </div>
        </div>
      )}
    </div>
  );
};

const operationBadgeClass = (operation: string): string => {
  switch (operation) {
    case 'copy':
      return 'bg-xp-blue/10 text-xp-blue';
    case 'move':
      return 'bg-xp-purple/10 text-xp-purple';
    case 'rename':
      return 'bg-xp-cyan/10 text-xp-cyan';
    case 'delete':
      return 'bg-xp-red/10 text-xp-red';
    case 'secure_delete':
      return 'bg-xp-red/20 text-xp-red';
    case 'compress':
      return 'bg-xp-yellow/10 text-xp-yellow';
    case 'extract':
      return 'bg-xp-yellow/10 text-xp-yellow';
    case 'encrypt':
      return 'bg-xp-green/10 text-xp-green';
    case 'decrypt':
      return 'bg-xp-green/10 text-xp-green';
    default:
      return 'bg-xp-surface text-xp-text-secondary';
  }
};

export default AuditLogSettings;
