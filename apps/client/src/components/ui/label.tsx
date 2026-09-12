import React from 'react';
import { cn } from '@/lib/utils';

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  children: React.ReactNode;
}

export const Label = ({ className = '', children, ...props }: LabelProps) => {
  return (
    <label
      className={cn(
        'text-[13px] font-medium leading-4 text-[var(--ds-label-primary)] peer-disabled:cursor-not-allowed peer-disabled:opacity-40',
        className,
      )}
      {...props}
    >
      {children}
    </label>
  );
};
