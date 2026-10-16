import React from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary';
  size?: 'default' | 'sm' | 'lg';
  children: React.ReactNode;
}

/** Shared macOS action. Material, emphasis and focus states use the design system. */
export const Button = ({
  variant = 'default',
  size = 'default',
  className = '',
  children,
  type = 'button',
  ...props
}: ButtonProps) => {
  const baseClasses =
    'glass-button inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] font-medium leading-4 transition-[background-color,border-color,color,box-shadow,opacity] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0';

  const variantClasses = {
    default: 'bg-[var(--ds-accent)] text-[var(--ds-on-dark)] hover:bg-[var(--ds-accent-press)]',
    outline: 'border border-[var(--ds-separator)] bg-transparent text-[var(--ds-label-primary)]',
    ghost:
      'text-[var(--ds-label-secondary)] hover:bg-[var(--ds-fill)] hover:text-[var(--ds-label-primary)]',
    destructive: 'bg-[var(--ds-destructive)] text-[var(--ds-on-dark)] hover:opacity-90',
    secondary: 'bg-[var(--ds-fill)] text-[var(--ds-label-primary)]',
  };

  const sizeClasses = {
    default: 'h-7 px-3 text-[13px]',
    sm: 'h-6 px-2.5 text-xs',
    lg: 'h-9 px-4 text-[13px]',
  };

  return (
    <button
      type={type}
      data-variant={variant}
      data-size={size}
      className={cn(baseClasses, variantClasses[variant], sizeClasses[size], className)}
      {...props}
    >
      {children}
    </button>
  );
};
