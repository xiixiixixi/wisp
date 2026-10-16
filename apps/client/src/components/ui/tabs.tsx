import React, { createContext, useContext, useId, useState } from 'react';
import { cn } from '@/lib/utils';

interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}

const TabsContext = createContext<{
  value: string;
  select: (value: string) => void;
  id: string;
} | null>(null);

const useTabs = () => {
  const context = useContext(TabsContext);
  if (!context) throw new Error('Tabs components must be rendered within Tabs');
  return context;
};

export const Tabs = ({
  value,
  defaultValue = '',
  onValueChange,
  className = '',
  children,
}: TabsProps) => {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const id = useId();
  const currentValue = value ?? internalValue;
  const select = (next: string) => {
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
  };
  return (
    <TabsContext.Provider value={{ value: currentValue, select, id }}>
      <div className={className} data-tabs-value={currentValue}>
        {children}
      </div>
    </TabsContext.Provider>
  );
};

export const TabsList = ({
  className = '',
  children,
  onKeyDown,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    {...props}
    role="tablist"
    aria-orientation="horizontal"
    className={cn(
      'segmented-control inline-flex min-h-7 max-w-full items-center justify-start gap-0.5 rounded-lg p-0.5',
      className,
    )}
    onKeyDown={(event) => {
      onKeyDown?.(event);
      if (
        event.defaultPrevented ||
        !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
      ) {
        return;
      }
      const items = Array.from(
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
      );
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0 || items.length === 0) return;
      event.preventDefault();
      const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
      const forward = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
      let next = (index + (forward ? 1 : -1) + items.length) % items.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = items.length - 1;
      items[next].focus();
      items[next].click();
    }}
  >
    {children}
  </div>
);

interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export const TabsTrigger = ({
  value,
  className = '',
  children,
  onClick,
  ...props
}: TabsTriggerProps) => {
  const tabs = useTabs();
  const active = tabs.value === value;
  return (
    <button
      {...props}
      type="button"
      id={`${tabs.id}-tab-${value}`}
      role="tab"
      aria-selected={active}
      aria-controls={`${tabs.id}-panel-${value}`}
      tabIndex={active ? 0 : -1}
      data-active={active}
      className={cn(
        'segmented-control-item relative inline-flex min-h-6 flex-1 items-center justify-center whitespace-nowrap rounded-md px-3 text-[13px] font-medium leading-4 transition-[background-color,color,box-shadow,opacity] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40',
        active
          ? 'text-[var(--ds-label-primary)]'
          : 'text-[var(--ds-label-secondary)] hover:text-[var(--ds-label-primary)]',
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) tabs.select(value);
      }}
    >
      {children}
    </button>
  );
};

interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  /** Preserve live editor buffers and undo history while another tab is visible. */
  forceMount?: boolean;
}

export const TabsContent = ({
  value,
  forceMount = false,
  className = '',
  children,
  style,
  ...props
}: TabsContentProps) => {
  const tabs = useTabs();
  return (
    <div
      {...props}
      role="tabpanel"
      id={`${tabs.id}-panel-${value}`}
      aria-labelledby={`${tabs.id}-tab-${value}`}
      hidden={tabs.value !== value}
      style={{ ...style, display: tabs.value === value ? style?.display : 'none' }}
      tabIndex={0}
      className={cn('mt-3 focus-visible:outline-none', className)}
    >
      {forceMount || tabs.value === value ? children : null}
    </div>
  );
};
