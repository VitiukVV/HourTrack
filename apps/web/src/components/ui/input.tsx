import * as React from 'react';

import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // S18 — bump min height to 44px on `< sm` for the iOS / Material
          // touch-target rule. Desktop keeps the compact h-9 (36px). The
          // base `h-9` is preserved so existing layout math (where the
          // form expects ~36px) stays correct on tablet+ while phones get
          // the larger surface.
          'flex h-9 min-h-[44px] sm:min-h-0 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
