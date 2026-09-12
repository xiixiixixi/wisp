import { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Slider } from '@/components/ui/slider';

describe('native system slider', () => {
  it('forwards the native ref, range bounds, label, focus and input events', async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLInputElement>();
    const input = vi.fn();
    const change = vi.fn();
    render(
      <Slider
        ref={ref}
        aria-label="Level"
        min={0}
        max={10}
        step={2}
        defaultValue={2}
        onInput={input}
        onChange={change}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Level' });
    expect(ref.current).toBe(slider);
    expect(slider).toHaveAttribute('type', 'range');
    expect(slider).toHaveAttribute('step', '2');
    await user.tab();
    expect(slider).toHaveFocus();
    ref.current!.stepUp();
    fireEvent.input(slider);
    expect(ref.current!.valueAsNumber).toBe(4);
    expect(input).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledOnce();
    expect(slider.style.background).toContain('40%');
  });

  it('updates a controlled track from props and leaves a rejected change at the controlled value', () => {
    const change = vi.fn();
    const { rerender } = render(
      <Slider aria-label="Level" min={1} max={9} value={3} onChange={change} />,
    );
    const slider = screen.getByRole('slider', { name: 'Level' }) as HTMLInputElement;
    expect(slider.style.background).toContain('25%');
    fireEvent.change(slider, { target: { value: '7' } });
    expect(change).toHaveBeenCalledOnce();
    expect(slider.value).toBe('3');
    expect(slider.style.background).toContain('25%');

    rerender(<Slider aria-label="Level" min={1} max={9} value={7} onChange={change} />);
    expect(slider.value).toBe('7');
    expect(slider.style.background).toContain('75%');
    rerender(<Slider aria-label="Level" min={1} max={13} value={7} onChange={change} />);
    expect(slider.style.background).toContain('50%');
  });

  it('keeps an uncontrolled input, form submission and reset in sync', async () => {
    const { container, rerender } = render(
      <form id="levels">
        <Slider aria-label="Level" name="level" min={1} max={9} defaultValue={3} />
      </form>,
    );
    const slider = screen.getByRole('slider', { name: 'Level' }) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '7' } });
    expect(slider.style.background).toContain('75%');
    rerender(
      <form id="levels">
        <Slider aria-label="Level" name="level" min={1} max={9} defaultValue={3} />
      </form>,
    );
    expect(slider.value).toBe('7');
    const form = container.querySelector('form')!;
    expect(new FormData(form).get('level')).toBe('7');
    act(() => form.reset());
    await waitFor(() => {
      expect(slider.value).toBe('3');
      expect(slider.style.background).toContain('25%');
    });
  });

  it('uses native midpoint defaults and clamps the track when the range collapses', () => {
    const { rerender } = render(<Slider aria-label="Level" min={-20} max={20} />);
    const slider = screen.getByRole('slider', { name: 'Level' }) as HTMLInputElement;
    expect(slider.valueAsNumber).toBe(0);
    expect(slider.style.background).toContain('50%');
    rerender(<Slider aria-label="Level" min={0} max={0} />);
    expect(slider.style.background).toContain('0%');
    expect(slider.style.background).not.toContain('NaN');
  });

  it('preserves explicit media background styles and disabled semantics', () => {
    const { rerender } = render(
      <Slider aria-label="Volume" defaultValue={20} style={{ background: 'red' }} disabled />,
    );
    const slider = screen.getByRole('slider', { name: 'Volume' });
    expect(slider).toBeDisabled();
    expect(slider.style.background).toBe('red');
    rerender(<Slider aria-label="Volume" defaultValue={20} style={{ background: 'blue' }} />);
    fireEvent.change(slider, { target: { value: '80' } });
    expect(slider.style.background).toBe('blue');
  });
});
