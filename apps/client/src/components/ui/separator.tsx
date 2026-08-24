import React from 'react';

interface SeparatorProps {
  className?: string;
  orientation?: 'horizontal' | 'vertical';
}

export const Separator = ({ className = '', orientation = 'horizontal' }: SeparatorProps) => {
  return (
    <div
      className={`${
        orientation === 'horizontal' ? 'h-px w-full bg-xp-border' : 'h-full w-px bg-xp-border'
      } ${className}`}
    />
  );
};
