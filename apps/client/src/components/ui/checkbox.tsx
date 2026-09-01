import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * MUJI paper checkbox — a small squared stamp, not a rounded-[2px] toggle.
 * Checked state is filled ink with a paper-colored check.
 */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer h-3.5 w-3.5 shrink-0 rounded-[1px] border border-xp-border-light bg-xp-surface-light transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-xp-text focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--xp-bg)] disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:border-xp-accent data-[state=checked]:bg-xp-accent data-[state=checked]:text-xp-on-accent',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn('flex items-center justify-center text-current')}>
      <Check className="h-3 w-3" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
