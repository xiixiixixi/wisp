import { useEffect, useRef } from 'react';
import { isLocalEntryPath, recordSuccessfulVisit } from '@/lib/recent-entry-actions';

/** Record a navigation once it has usable data, never on watcher refetches. */
export const useRecentDirectory = (path: string, ready: boolean): void => {
  const visit = useRef({ path, recorded: false });
  useEffect(() => {
    if (visit.current.path !== path) visit.current = { path, recorded: false };
    if (!ready || visit.current.recorded || !isLocalEntryPath(path)) return;
    visit.current.recorded = true;
    void recordSuccessfulVisit(path);
  }, [path, ready]);
};
