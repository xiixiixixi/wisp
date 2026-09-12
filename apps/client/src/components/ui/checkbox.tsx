import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Compact system checkbox. */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'liquid-checkbox peer h-4 w-4 shrink-0 rounded-[5px] border border-[var(--ds-separator)] bg-[var(--ds-fill)] text-[var(--ds-on-dark)] transition-[background-color,border-color,box-shadow,opacity] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:border-transparent data-[state=indeterminate]:border-transparent data-[state=checked]:bg-[var(--ds-accent)] data-[state=indeterminate]:bg-[var(--ds-accent)]',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="group/indicator flex items-center justify-center text-current">
      <Check
        className="h-3 w-3 group-data-[state=indeterminate]/indicator:hidden"
        strokeWidth={2.5}
        aria-hidden="true"
      />
      <Minus
        className="h-3 w-3 group-data-[state=checked]/indicator:hidden"
        strokeWidth={2.5}
        aria-hidden="true"
      />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
