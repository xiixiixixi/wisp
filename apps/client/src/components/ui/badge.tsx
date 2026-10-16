import React from 'react';
import { cn } from '@/lib/utils';

interface BadgeProps {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';
  className?: string;
  children: React.ReactNode;
}

/** Compact status capsule; text keeps the meaning available without color. */
export const Badge = ({ variant = 'default', className = '', children }: BadgeProps) => {
  const baseClasses =
    'liquid-badge inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium leading-4';

  const variantClasses = {
    default: 'bg-[var(--ds-accent-tint)] text-[var(--ds-link)]',
    secondary: 'bg-[var(--ds-fill)] text-[var(--ds-label-secondary)]',
    destructive: 'bg-xp-red/10 text-xp-red',
    outline: 'border border-[var(--ds-separator)] text-[var(--ds-label-secondary)]',
    success: 'bg-xp-green/10 text-xp-green',
    warning: 'bg-xp-yellow/10 text-xp-yellow',
  };

  return (
    <span data-variant={variant} className={cn(baseClasses, variantClasses[variant], className)}>
      {children}
    </span>
  );
};
