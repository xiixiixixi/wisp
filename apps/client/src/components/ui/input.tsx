import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

/**
 * MUJI paper input — a quiet well cut into the sheet.
 * Hairline edge, no ring glow; focus is a single hairline darkening.
 */
export const Input = ({ className = '', ...props }: InputProps) => {
  return (
    <input
      className={`flex h-9 w-full rounded-[2px] border border-xp-border bg-xp-surface-light px-3 py-1.5 text-sm text-xp-text transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-xp-text-muted hover:border-xp-border-light focus-visible:border-xp-text-secondary focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      {...props}
    />
  );
};
