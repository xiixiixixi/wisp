import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary';
  size?: 'default' | 'sm' | 'lg';
  children: React.ReactNode;
}

export const Button = ({
  variant = 'default',
  size = 'default',
  className = '',
  children,
  ...props
}: ButtonProps) => {
  const baseClasses =
    'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';

  const variantClasses = {
    default: 'bg-xp-blue text-white hover:bg-xp-accent-hover focus-visible:ring-xp-blue',
    outline:
      'border border-xp-border bg-xp-popover text-xp-text hover:bg-xp-surface-light focus-visible:ring-xp-blue',
    ghost: 'text-xp-text hover:bg-xp-surface-light focus-visible:ring-xp-blue',
    destructive: 'bg-xp-red text-white hover:bg-xp-red focus-visible:ring-xp-red',
    secondary: 'bg-xp-surface-light text-xp-text hover:bg-xp-border focus-visible:ring-xp-blue',
  };

  const sizeClasses = {
    default: 'h-10 px-4 py-2',
    sm: 'h-8 px-3 py-1 text-sm',
    lg: 'h-12 px-6 py-3 text-lg',
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
