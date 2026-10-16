import { useLayoutEffect, useState, type RefObject } from 'react';

/** Measure the pane, not the toolbar's changing intrinsic width. */
export const usePaneWidth = (ref: RefObject<HTMLElement | null>): number => {
  const [width, setWidth] = useState(Infinity);

  useLayoutEffect(() => {
    const element = ref.current;
    const container =
      element?.closest('.wisp-editor-pane') ??
      element?.closest('.wisp-pane-toolbar') ??
      element?.parentElement;
    if (!container) return;

    const measure = () => {
      const next = container.getBoundingClientRect().width;
      if (next > 0) setWidth(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [ref]);

  return width;
};
