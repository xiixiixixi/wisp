import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import {
  FILE_REVEAL_SCROLL_EVENT,
  consumeFileRevealScroll,
  pendingFileRevealScroll,
  type FileRevealScrollRequest,
} from '@/lib/file-reveal-scroll';

interface FileRevealScrollOptions {
  groupId: string;
  currentPath: string;
  paths: readonly (string | null)[];
  containerRef: RefObject<HTMLElement | null>;
  enabled?: boolean;
  scrollToIndex?: (index: number) => void;
  onRevealPath?: (path: string) => void;
}

export const useFileRevealScroll = (options: FileRevealScrollOptions): void => {
  const latest = useRef(options);
  latest.current = options;
  const pending = useRef<FileRevealScrollRequest | null>(null);
  const frame = useRef<number | null>(null);
  const finish = useRef(() => {});
  const accept = useRef((_request: FileRevealScrollRequest): boolean => false);
  finish.current = () => {
    const request = pending.current;
    const current = latest.current;
    const container = current.containerRef.current;
    if (!request) return;
    if (
      current.enabled === false ||
      current.groupId !== request.groupId ||
      current.currentPath !== request.directory ||
      !container ||
      container.closest('[data-active="false"]')
    ) {
      pending.current = null;
      return;
    }
    const target = container.querySelector<HTMLElement>(
      `[data-file-path="${CSS.escape(request.path)}"]`,
    );
    if (!target) return;
    pending.current = null;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
  };

  accept.current = (request) => {
    const current = latest.current;
    const container = current.containerRef.current;
    if (
      !request ||
      current.enabled === false ||
      request.groupId !== current.groupId ||
      request.directory !== current.currentPath ||
      !container ||
      container.closest('[data-active="false"]')
    ) {
      return false;
    }
    const index = current.paths.indexOf(request.path);
    if (index < 0) return false;
    consumeFileRevealScroll(request);
    pending.current = { ...request };
    current.onRevealPath?.(request.path);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    current.scrollToIndex?.(index);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      finish.current();
    });
    return true;
  };

  // A virtual row can mount after the initial frame. Finish on its real render,
  // not with a guessed timeout or repeated polling.
  useLayoutEffect(() => {
    const queued = pendingFileRevealScroll();
    if (queued) accept.current(queued);
    finish.current();
  });

  useEffect(() => {
    const onReveal = (event: Event) => {
      if (event.defaultPrevented) return;
      const request = (event as CustomEvent<FileRevealScrollRequest>).detail;
      if (request && accept.current(request)) event.preventDefault();
    };
    window.addEventListener(FILE_REVEAL_SCROLL_EVENT, onReveal);
    return () => {
      window.removeEventListener(FILE_REVEAL_SCROLL_EVENT, onReveal);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      pending.current = null;
    };
  }, []);
};
