import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWindowMaterial } from '@/hooks/use-window-material';

const root = document.documentElement;
const pointerX = () => root.style.getPropertyValue('--wisp-glass-pointer-x');
const pointerY = () => root.style.getPropertyValue('--wisp-glass-pointer-y');

describe('window material pointer response', () => {
  let reduced: boolean;
  let motion: MediaQueryList;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let originalWidth: number;
  let originalHeight: number;

  const move = (x: number, y: number) => {
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }));
  };
  const paint = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  };

  beforeEach(() => {
    reduced = false;
    frames = new Map();
    nextFrame = 0;
    originalWidth = window.innerWidth;
    originalHeight = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 });
    motion = new EventTarget() as MediaQueryList;
    Object.defineProperty(motion, 'matches', { get: () => reduced });
    vi.spyOn(window, 'matchMedia').mockReturnValue(motion);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
    root.removeAttribute('data-native-reduce-motion');
    root.style.removeProperty('--wisp-glass-pointer-x');
    root.style.removeProperty('--wisp-glass-pointer-y');
  });

  it('coalesces pointer events into one frame and paints the latest viewport position', () => {
    const addListener = vi.spyOn(window, 'addEventListener');
    renderHook(() => useWindowMaterial());
    expect(addListener).toHaveBeenCalledWith('pointermove', expect.any(Function), {
      passive: true,
    });
    expect(pointerX()).toBe('50%');
    move(100, 100);
    move(750, 200);
    expect(window.requestAnimationFrame).toHaveBeenCalledOnce();
    expect(pointerX()).toBe('50%');
    paint();
    expect(pointerX()).toBe('75.00%');
    expect(pointerY()).toBe('40.00%');
    move(1500, -10);
    paint();
    expect(pointerX()).toBe('100.00%');
    expect(pointerY()).toBe('0.00%');
  });

  it('recenters on pointer exit and window blur, cancelling pending frames', () => {
    renderHook(() => useWindowMaterial());
    move(100, 100);
    root.dispatchEvent(new Event('pointerleave'));
    expect(frames.size).toBe(0);
    expect(pointerX()).toBe('50%');
    move(100, 100);
    paint();
    expect(pointerX()).toBe('10.00%');
    window.dispatchEvent(new Event('blur'));
    expect(pointerX()).toBe('50%');
    expect(pointerY()).toBe('50%');
  });

  it('does no pointer work while system motion is reduced and cancels work on a live change', () => {
    reduced = true;
    renderHook(() => useWindowMaterial());
    move(100, 100);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    reduced = false;
    motion.dispatchEvent(new Event('change'));
    move(100, 100);
    expect(frames.size).toBe(1);
    reduced = true;
    motion.dispatchEvent(new Event('change'));
    expect(frames.size).toBe(0);
    expect(pointerX()).toBe('50%');
  });

  it('respects native reduced motion and resumes after the preference is removed', async () => {
    root.setAttribute('data-native-reduce-motion', '');
    renderHook(() => useWindowMaterial());
    move(100, 100);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    await act(async () => root.removeAttribute('data-native-reduce-motion'));
    move(200, 150);
    paint();
    expect(pointerX()).toBe('20.00%');
    await act(async () => root.setAttribute('data-native-reduce-motion', ''));
    expect(pointerX()).toBe('50%');
    move(100, 100);
    expect(frames.size).toBe(0);
  });

  it('cancels work, removes listeners and restores prior variables on unmount', async () => {
    root.style.setProperty('--wisp-glass-pointer-x', '30%');
    const { unmount } = renderHook(() => useWindowMaterial());
    move(100, 100);
    unmount();
    expect(frames.size).toBe(0);
    expect(pointerX()).toBe('30%');
    expect(pointerY()).toBe('');
    move(200, 200);
    window.dispatchEvent(new Event('blur'));
    root.dispatchEvent(new Event('pointerleave'));
    reduced = true;
    motion.dispatchEvent(new Event('change'));
    await act(async () => root.setAttribute('data-native-reduce-motion', ''));
    expect(frames.size).toBe(0);
    expect(pointerX()).toBe('30%');
  });
});
