import { useEffect } from 'react';

const POINTER_X = '--wisp-glass-pointer-x';
const POINTER_Y = '--wisp-glass-pointer-y';

/** Move the window's optical highlight without adding React render work. */
export const useWindowMaterial = (): void => {
  useEffect(() => {
    const root = document.documentElement;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const previousX = root.style.getPropertyValue(POINTER_X);
    const previousY = root.style.getPropertyValue(POINTER_Y);
    let frame: number | null = null;
    let clientX = 0;
    let clientY = 0;

    const reducedMotion = () => motion.matches || root.hasAttribute('data-native-reduce-motion');
    const cancelFrame = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
    };
    const reset = () => {
      cancelFrame();
      root.style.setProperty(POINTER_X, '50%');
      root.style.setProperty(POINTER_Y, '50%');
    };
    const paint = () => {
      frame = null;
      if (reducedMotion()) return;
      const x = Math.min(100, Math.max(0, (clientX / Math.max(1, window.innerWidth)) * 100));
      const y = Math.min(100, Math.max(0, (clientY / Math.max(1, window.innerHeight)) * 100));
      root.style.setProperty(POINTER_X, `${x.toFixed(2)}%`);
      root.style.setProperty(POINTER_Y, `${y.toFixed(2)}%`);
    };
    const move = (event: PointerEvent) => {
      if (reducedMotion()) return;
      clientX = event.clientX;
      clientY = event.clientY;
      if (frame === null) frame = window.requestAnimationFrame(paint);
    };
    const updateMotion = () => {
      if (reducedMotion()) reset();
    };

    reset();
    window.addEventListener('pointermove', move, { passive: true });
    root.addEventListener('pointerleave', reset, { passive: true });
    window.addEventListener('blur', reset);
    motion.addEventListener('change', updateMotion);
    const observer = new MutationObserver(updateMotion);
    observer.observe(root, { attributes: true, attributeFilter: ['data-native-reduce-motion'] });

    return () => {
      cancelFrame();
      window.removeEventListener('pointermove', move);
      root.removeEventListener('pointerleave', reset);
      window.removeEventListener('blur', reset);
      motion.removeEventListener('change', updateMotion);
      observer.disconnect();
      if (previousX) root.style.setProperty(POINTER_X, previousX);
      else root.style.removeProperty(POINTER_X);
      if (previousY) root.style.setProperty(POINTER_Y, previousY);
      else root.style.removeProperty(POINTER_Y);
    };
  }, []);
};
