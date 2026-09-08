import { getAppLocale } from '@/lib/locale';
import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { TauriAPI, type TokenIndex } from '@/lib/tauri-api';
import { TOKENIZER_STATUS_INTERVAL_MS } from '@/lib/constants';

const TokenizerStatusIndicator = () => {
  const { t: tUi } = useTranslation();
  const [stats, setStats] = useState<TokenIndex | null>(null);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const tokenizerStats = await TauriAPI.getTokenizerStats();
        setStats(tokenizerStats);
      } catch {
        // Silently ignore — indexing runs in the background
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, TOKENIZER_STATUS_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Only show when there are actually indexed files
  if (!stats || !stats.total_files) return null;

  return (
    <div
      className="flex items-center gap-1 text-xs text-xp-text-muted"
      title={tUi('interface.searchIndex')}
    >
      <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
          clipRule="evenodd"
        />
      </svg>
      <span className="font-dot text-[11px] leading-none">
        {stats.total_files.toLocaleString(getAppLocale())}
      </span>
      <span>{tUi('interface.indexed')}</span>
    </div>
  );
};

export default TokenizerStatusIndicator;
