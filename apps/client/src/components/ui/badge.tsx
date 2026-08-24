import React from 'react';

interface BadgeProps {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';
  className?: string;
  children: React.ReactNode;
}

export const Badge = ({ variant = 'default', className = '', children }: BadgeProps) => {
  const baseClasses =
    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2';

  const variantClasses = {
    default: 'bg-xp-selection text-xp-blue',
    secondary: 'bg-xp-surface-light text-xp-text hover:bg-xp-border',
    destructive: 'bg-red-100 text-red-900 hover:bg-red-200',
    outline: 'border border-xp-border text-xp-text hover:bg-xp-surface-light',
    success: 'bg-green-100 text-green-900 hover:bg-green-200',
    warning: 'bg-yellow-100 text-yellow-900 hover:bg-yellow-200',
  };

  return (
    <span className={`${baseClasses} ${variantClasses[variant]} ${className}`}>{children}</span>
  );
};
