import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary';
  size?: 'default' | 'sm' | 'lg';
  children: React.ReactNode;
}

/** Shared Liquid Glass control. The material and interaction states live in
 * liquid-glass.css so feature surfaces don't invent their own button chrome. */
export const Button = ({
  variant = 'default',
  size = 'default',
  className = '',
  children,
  ...props
}: ButtonProps) => {
  const baseClasses =
    'glass-button inline-flex items-center justify-center gap-1.5 font-medium transition-all focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40';

  const variantClasses = {
    default: 'bg-xp-accent text-xp-on-accent hover:bg-xp-accent-hover',
    outline: 'border border-xp-border bg-transparent text-xp-text',
    ghost: 'text-xp-text-secondary hover:text-xp-text',
    destructive: 'bg-xp-red text-xp-on-accent hover:opacity-90',
    secondary: 'bg-xp-surface-light text-xp-text',
  };

  const sizeClasses = {
    default: 'h-9 px-3.5 text-sm',
    sm: 'h-7 px-2.5 text-xs',
    lg: 'h-11 px-5 text-base',
  };

  return (
    <button
      data-variant={variant}
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
