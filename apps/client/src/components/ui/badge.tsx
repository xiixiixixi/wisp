import React from 'react';

interface BadgeProps {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';
  className?: string;
  children: React.ReactNode;
}

export const Badge = ({ variant = 'default', className = '', children }: BadgeProps) => {
  const baseClasses =
    'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2';

  const variantClasses = {
    default: 'bg-xp-selection text-xp-lime',
    secondary: 'bg-xp-surface-light text-xp-text hover:bg-xp-border',
    destructive: 'bg-xp-bg text-xp-red hover:bg-xp-border',
    outline: 'border border-xp-border text-xp-text hover:bg-xp-surface-light',
    success: 'bg-xp-bg text-xp-green hover:bg-xp-border',
    warning: 'bg-xp-bg text-xp-yellow hover:bg-xp-border',
  };

  return (
    <span className={`${baseClasses} ${variantClasses[variant]} ${className}`}>{children}</span>
  );
};
