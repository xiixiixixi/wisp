import React, { useState } from 'react';

interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}

export const Tabs = ({
  value,
  defaultValue,
  onValueChange,
  className = '',
  children,
}: TabsProps) => {
  const [internalValue, setInternalValue] = useState(defaultValue || '');
  const currentValue = value !== undefined ? value : internalValue;

  const handleValueChange = (newValue: string) => {
    if (value === undefined) {
      setInternalValue(newValue);
    }
    onValueChange?.(newValue);
  };

  return (
    <div className={`${className}`} data-tabs-value={currentValue}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child, {
            ...(child.props as Record<string, unknown>),
            currentValue,
            onValueChange: handleValueChange,
          } as Record<string, unknown>);
        }
        return child;
      })}
    </div>
  );
};

interface TabsListProps {
  className?: string;
  children: React.ReactNode;
  currentValue?: string;
  onValueChange?: (value: string) => void;
}

/**
 * MUJI tabs — a hairline shelf; the active tab is a red tick, not a filled bubble.
 */
export const TabsList = ({
  className = '',
  children,
  currentValue,
  onValueChange,
}: TabsListProps) => {
  return (
    <div
      className={`inline-flex h-9 items-stretch justify-start gap-0 border-b border-xp-border ${className}`}
    >
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child, {
            ...(child.props as Record<string, unknown>),
            currentValue,
            onValueChange,
          } as Record<string, unknown>);
        }
        return child;
      })}
    </div>
  );
};

interface TabsTriggerProps {
  value: string;
  className?: string;
  children: React.ReactNode;
  currentValue?: string;
  onValueChange?: (value: string) => void;
}

export const TabsTrigger = ({
  value,
  className = '',
  children,
  currentValue,
  onValueChange,
}: TabsTriggerProps) => {
  const isActive = currentValue === value;

  return (
    <button
      className={`relative inline-flex items-center justify-center whitespace-nowrap px-3 text-sm transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 ${
        isActive
          ? 'font-medium text-xp-text after:absolute after:inset-x-2 after:bottom-0 after:h-px after:bg-xp-lime'
          : 'text-xp-text-muted hover:text-xp-text'
      } ${className}`}
      onClick={() => onValueChange?.(value)}
    >
      {children}
    </button>
  );
};

interface TabsContentProps {
  value: string;
  className?: string;
  children: React.ReactNode;
  currentValue?: string;
}

export const TabsContent = ({
  value,
  className = '',
  children,
  currentValue,
}: TabsContentProps) => {
  if (currentValue !== value) return null;

  return <div className={`mt-3 focus-visible:outline-none ${className}`}>{children}</div>;
};
