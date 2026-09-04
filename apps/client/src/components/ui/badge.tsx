import React from 'react';

interface BadgeProps {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';
  className?: string;
  children: React.ReactNode;
}

/** Compact status capsule. Status is communicated with color, not shouting. */
export const Badge = ({ variant = 'default', className = '', children }: BadgeProps) => {
  const baseClasses =
    'liquid-badge inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium';

  const variantClasses = {
    default: 'bg-xp-selection-bg text-xp-lime',
    secondary: 'bg-xp-surface-light text-xp-text-secondary',
    destructive: 'bg-xp-selection-bg text-xp-red',
    outline: 'border border-xp-border text-xp-text-secondary',
    success: 'bg-xp-surface-light text-xp-green',
    warning: 'bg-xp-surface-light text-xp-yellow',
  };

  return (
    <span className={`${baseClasses} ${variantClasses[variant]} ${className}`}>{children}</span>
  );
};
