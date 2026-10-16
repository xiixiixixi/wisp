import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileEntry } from '@/lib/tauri-api';
import type { Toast } from '@/hooks/use-toast';
import {
  cancelFileRevealScrollForGroup,
  cancelFileRevealScrollOutside,
  requestFileRevealScroll,
} from '@/lib/file-reveal-scroll';
import {
  subscribeToShelfRevealNavigation,
  type ShelfRevealNavigation,
} from '@/lib/shelf-reveal-navigation';

interface ShelfRevealDeps {
  currentPath: string;
  groupId: string;
  navigateToPath: (path: string) => void;
  refetch: () => void;
  setSelectedFiles: (paths: Set<string>) => void;
  setSelectedFile: (file: FileEntry | null) => void;
  toast: (notification: Toast) => void;
}

interface PendingReveal extends ShelfRevealNavigation {
  groupId: string;
  source: string;
  arrived: boolean;
}

export const useShelfRevealNavigation = (deps: ShelfRevealDeps) => {
  const { t } = useTranslation();
  const latest = useRef({ ...deps, t });
  latest.current = { ...deps, t };
  const pending = useRef<PendingReveal | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToShelfRevealNavigation((request) => {
      const current = latest.current;
      pending.current = {
        ...request,
        groupId: current.groupId,
        source: current.currentPath,
        arrived: current.currentPath === request.directory,
      };
      if (current.currentPath === request.directory) current.refetch();
      else current.navigateToPath(request.directory);
    });
    return () => {
      unsubscribe();
      pending.current = null;
      cancelFileRevealScrollForGroup(latest.current.groupId);
    };
  }, []);

  useEffect(() => {
    cancelFileRevealScrollOutside(deps.groupId, deps.currentPath);
    const request = pending.current;
    if (!request) return;
    if (
      deps.groupId !== request.groupId ||
      (deps.currentPath !== request.directory &&
        (request.arrived || deps.currentPath !== request.source))
    ) {
      pending.current = null;
    } else if (deps.currentPath === request.directory) request.arrived = true;
  }, [deps.currentPath, deps.groupId]);

  const onDirectoryReady = useCallback(
    (directory: string, files: FileEntry[], succeeded: boolean) => {
      const request = pending.current;
      const current = latest.current;
      if (
        !request ||
        request.directory !== directory ||
        current.currentPath !== directory ||
        current.groupId !== request.groupId
      ) {
        return;
      }

      // Selection belongs to the settled target pane, never the previous pane's list.
      pending.current = null;
      const requested = new Set(request.paths);
      const byPath = new Map(files.map((file) => [file.path, file]));
      const selected = succeeded
        ? Array.from(requested, (path) => byPath.get(path)).filter(
            (file): file is FileEntry => file !== undefined,
          )
        : [];
      if (!selected.length) {
        current.toast({ title: current.t('shelf.revealFailed'), variant: 'destructive' });
        return;
      }
      current.setSelectedFiles(new Set(selected.map((file) => file.path)));
      current.setSelectedFile(selected[0]);
      requestFileRevealScroll({ groupId: request.groupId, directory, path: selected[0].path });
      const omitted = request.omittedCount + requested.size - selected.length;
      if (omitted) {
        current.toast({
          title: current.t('shelf.revealPartial', { shown: selected.length, omitted }),
        });
      }
    },
    [],
  );

  return onDirectoryReady;
};
