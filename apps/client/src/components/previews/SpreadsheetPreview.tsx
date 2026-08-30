import React, { useState, useEffect } from 'react';
import { PreviewProps } from '@/lib/preview-factory';
import { TauriAPI } from '@/lib/tauri-api';
import { PreviewSkeleton } from '@/components/ui/Skeleton';

const MAX_ROWS = 50;

/**
 * Spreadsheet preview via SheetJS (browser-first parser). The workbook is
 * read from the raw bytes and only the first MAX_ROWS rows of each sheet
 * are materialised for the panel.
 */
const SpreadsheetPreview = ({ file, onError, onLoad }: PreviewProps) => {
  const [sheets, setSheets] = useState<{ name: string; rows: (string | number | boolean)[][] }[]>(
    [],
  );
  const [activeSheet, setActiveSheet] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadSpreadsheet = async () => {
      try {
        setLoading(true);
        setError(null);

        const bytes = await TauriAPI.readBinaryFile(file.path);
        const XLSX = await import('xlsx');
        // type: 'array' — bytes is a Uint8Array view over the IPC buffer
        const workbook = XLSX.read(bytes, { type: 'array' });

        const sheetsData = workbook.SheetNames.map((name) => {
          const worksheet = workbook.Sheets[name];
          const matrix = XLSX.utils.sheet_to_json<(string | number | boolean)[]>(worksheet, {
            header: 1,
            blankrows: false,
            defval: '',
          });
          return { name, rows: matrix.slice(0, MAX_ROWS) };
        });

        if (cancelled) return;
        setSheets(sheetsData);
        setActiveSheet(0);
        onLoad?.();
      } catch (err) {
        if (cancelled) return;
        const errorMessage = err instanceof Error ? err.message : 'Failed to load spreadsheet';
        setError(errorMessage);
        onError?.(err instanceof Error ? err : new Error(errorMessage));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadSpreadsheet();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path]);

  const currentSheet = sheets[activeSheet];

  return (
    <div className="flex h-full flex-col">
      {loading && <PreviewSkeleton />}

      {!loading && error && (
        <div className="flex flex-1 items-center justify-center rounded border border-xp-border bg-xp-surface">
          <div className="text-center text-xp-text-muted">
            <p className="text-sm">Cannot preview spreadsheet</p>
            <p className="mt-1 text-xs opacity-70">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && sheets.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col">
          {sheets.length > 1 && (
            <div className="scrollbar-none mb-1.5 flex flex-shrink-0 gap-1 overflow-x-auto">
              {sheets.map((sheet, i) => (
                <button
                  key={sheet.name}
                  type="button"
                  onClick={() => setActiveSheet(i)}
                  className={`whitespace-nowrap rounded-md px-2 py-1 text-xs transition-colors ${
                    i === activeSheet
                      ? 'bg-xp-selection-bg text-xp-blue'
                      : 'text-xp-text-muted hover:bg-xp-surface-light hover:text-xp-text'
                  }`}
                >
                  {sheet.name}
                </button>
              ))}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-xp-border bg-xp-surface">
            <table className="w-full text-xs">
              <tbody>
                {currentSheet?.rows.map((row, rowIndex) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <tr key={rowIndex} className={rowIndex === 0 ? 'bg-muted font-medium' : ''}>
                    {row.map((cell, cellIndex) => (
                      <td
                        // eslint-disable-next-line react/no-array-index-key
                        key={cellIndex}
                        className="max-w-24 truncate border-b border-r border-xp-border px-2 py-1 text-xp-text"
                        title={String(cell)}
                      >
                        {String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {currentSheet && currentSheet.rows.length >= MAX_ROWS && (
            <p className="mt-1.5 flex-shrink-0 text-center text-[10px] text-xp-text-muted">
              Showing first {MAX_ROWS} rows
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default SpreadsheetPreview;
