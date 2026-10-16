/**
 * Auto-hiding scrollbars ("appear while scrolling").
 *
 * One capture-phase scroll listener toggles `.is-scrolling` on whatever
 * element is scrolling (removed again after a short idle delay). CSS makes
 * scrollbar thumbs transparent by default and only paints them for
 * `.is-scrolling` containers — Finder-style overlay bars without reserving
 * a visible gutter.
 */

const HIDE_DELAY_MS = 600;
const SCROLLING_CLASS = 'is-scrolling';

const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

const markScrolling = (el: Element) => {
  el.classList.add(SCROLLING_CLASS);
  const previous = timers.get(el);
  if (previous) clearTimeout(previous);
  timers.set(
    el,
    setTimeout(() => {
      el.classList.remove(SCROLLING_CLASS);
      timers.delete(el);
    }, HIDE_DELAY_MS),
  );
};

/** Install once at app startup. Idempotent. */
export const installAutoScrollbars = () => {
  if ((installAutoScrollbars as unknown as { installed?: boolean }).installed) return;
  (installAutoScrollbars as unknown as { installed?: boolean }).installed = true;

  document.addEventListener(
    'scroll',
    (event) => {
      const target = event.target;
      if (target instanceof Element) {
        markScrolling(target);
      } else if (target === document) {
        // Window-level scrolling styles the <html> scrollbar.
        markScrolling(document.documentElement);
      }
    },
    { capture: true, passive: true },
  );
};
