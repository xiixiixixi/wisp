import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

/** Adaptive Liquid Glass field with a native-sized focus treatment. */
export const Input = ({ className = '', ...props }: InputProps) => {
  return (
    <input
      className={`glass-input flex h-9 w-full border border-xp-border bg-xp-surface-light px-3 py-1.5 text-sm text-xp-text transition-all file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-xp-text-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      {...props}
    />
  );
};
