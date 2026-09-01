import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary';
  size?: 'default' | 'sm' | 'lg';
  children: React.ReactNode;
}

/**
 * MUJI paper button — squared corners, hairline or ink fill, no shadows.
 * The primary press is an ink stamp; hover is a faint paper lift, never a glow.
 */
export const Button = ({
  variant = 'default',
  size = 'default',
  className = '',
  children,
  ...props
}: ButtonProps) => {
  const baseClasses =
    'inline-flex items-center justify-center rounded-[2px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-xp-text focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--xp-bg)] disabled:pointer-events-none disabled:opacity-40';

  const variantClasses = {
    // Ink stamp on paper — flips polarity with the sun
    default: 'bg-xp-accent text-xp-on-accent hover:bg-xp-accent-hover',
    // Hairline paper cut
    outline: 'border border-xp-border bg-transparent text-xp-text hover:bg-xp-surface-light',
    // Bare ink — sits directly on the ground
    ghost: 'text-xp-text-secondary hover:bg-xp-surface-light hover:text-xp-text',
    // 無印紅 — the only red moment, reserved for destructive acts
    destructive: 'bg-xp-lime text-xp-on-accent hover:opacity-85',
    // A folded paper square — slightly raised from the ground
    secondary: 'bg-xp-surface-light text-xp-text hover:bg-xp-border',
  };

  const sizeClasses = {
    default: 'h-9 px-4 text-sm',
    sm: 'h-7 px-2.5 text-xs',
    lg: 'h-11 px-6 text-base',
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
