import React from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

/** Inset content field; the focus ring follows the system accent. */
export const Input = ({ className = '', ...props }: InputProps) => {
  return (
    <input
      className={cn(
        'glass-input flex h-7 w-full min-w-0 rounded-[7px] border border-[var(--ds-separator)] bg-[var(--ds-fill)] px-2.5 py-1 text-[13px] font-normal leading-4 text-[var(--ds-label-primary)] transition-[background-color,border-color,box-shadow,opacity] file:border-0 file:bg-transparent file:text-[13px] file:font-medium placeholder:text-[var(--ds-label-tertiary)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...props}
    />
  );
};
