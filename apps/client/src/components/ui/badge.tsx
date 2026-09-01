import React from 'react';

interface BadgeProps {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';
  className?: string;
  children: React.ReactNode;
}

/**
 * MUJI paper badge — a squared paper tag, never a pill.
 * The default is the one 無印紅 moment; the rest are quiet ink washes.
 */
export const Badge = ({ variant = 'default', className = '', children }: BadgeProps) => {
  const baseClasses =
    'inline-flex items-center rounded-[2px] px-1.5 py-px text-[10px] font-medium tracking-wide uppercase';

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
