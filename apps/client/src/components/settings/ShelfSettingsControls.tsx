import { useEffect, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

export const ShelfSettingsPrimarySection = ({ children }: { children: ReactNode }) => (
  <section className="wisp-settings-section wisp-shelf-primary-section">
    <div className="wisp-settings-section-rows">{children}</div>
  </section>
);

export const ShelfSettingTool = ({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) => (
  <Button
    variant="ghost"
    size="sm"
    className="h-7 w-7 px-0"
    title={label}
    aria-label={label}
    onClick={onClick}
    disabled={disabled}
  >
    {children}
  </Button>
);

export const ShelfSettingDisclosure = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <details className="wisp-settings-advanced border-t border-xp-border">
    <summary>
      <ChevronRight size={14} aria-hidden="true" />
      <span>{title}</span>
    </summary>
    <div className="pb-3">{children}</div>
  </details>
);

export const ShelfSettingRange = ({
  value,
  disabled,
  label,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  label: string;
  onCommit: (value: number) => void;
}) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) {
      onCommit(draft);
    }
  };
  return (
    <div className="flex w-48 max-w-full items-center gap-2">
      <Slider
        aria-label={label}
        min={0.3}
        max={1}
        step={0.1}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="flex-1"
      />
      <span className="w-7 text-right text-xs tabular-nums">{draft.toFixed(1)}</span>
    </div>
  );
};
