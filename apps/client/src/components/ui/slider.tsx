import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type InputHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

export type SliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/** A native range input with the macOS 6px filled track and system thumb. */
export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({ className, style, onInput, onChange, value, form, ...props }, ref) => {
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => inputRef.current!, []);

    const updateTrack = useCallback(
      (input: HTMLInputElement) => {
        // Media controls can keep their existing progress/volume color treatment.
        if (style?.background !== undefined) return;
        const min = input.min !== '' && Number.isFinite(Number(input.min)) ? Number(input.min) : 0;
        const max =
          input.max !== '' && Number.isFinite(Number(input.max)) ? Number(input.max) : 100;
        const progress =
          max > min
            ? Math.min(100, Math.max(0, ((input.valueAsNumber - min) / (max - min)) * 100))
            : 0;
        const percent = Number.isFinite(progress) ? progress : 0;
        input.style.background = `linear-gradient(to right, var(--ds-accent) 0%, var(--ds-accent) ${percent}%, var(--ds-fill) ${percent}%, var(--ds-fill) 100%)`;
      },
      [style?.background],
    );

    // Let the browser sanitize values, defaults and step bounds before painting.
    useLayoutEffect(() => {
      if (inputRef.current) updateTrack(inputRef.current);
    });

    useEffect(() => {
      const input = inputRef.current;
      const owner = input?.form;
      if (!input || !owner) return;
      const reset = (event: Event) => {
        queueMicrotask(() => {
          if (!event.defaultPrevented && input.isConnected) updateTrack(input);
        });
      };
      owner.addEventListener('reset', reset);
      return () => owner.removeEventListener('reset', reset);
    }, [form, updateTrack]);

    return (
      <input
        {...props}
        ref={inputRef}
        type="range"
        form={form}
        value={value}
        className={cn(
          'wisp-slider h-1.5 w-full min-w-0 cursor-pointer appearance-none rounded-full disabled:cursor-default disabled:opacity-40',
          className,
        )}
        style={style}
        onInput={(event) => {
          if (value === undefined) updateTrack(event.currentTarget);
          onInput?.(event);
        }}
        onChange={(event) => {
          if (value === undefined) updateTrack(event.currentTarget);
          onChange?.(event);
        }}
      />
    );
  },
);
Slider.displayName = 'Slider';
