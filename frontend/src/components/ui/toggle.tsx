import * as React from 'react';
import * as TogglePrimitive from '@radix-ui/react-toggle';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/shared/lib/cn';

const toggleVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap border text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-secondary-surface)] hover:text-[var(--color-text)] data-[state=on]:bg-[var(--color-secondary-surface)] data-[state=on]:text-[var(--color-text)]',
        outline:
          'border-[var(--color-border)] bg-white text-[var(--color-text)] hover:bg-[var(--color-secondary-surface)] data-[state=on]:border-[var(--color-border-strong)] data-[state=on]:bg-[var(--color-secondary-surface)]',
      },
      size: {
        default: 'h-10 min-w-10 rounded-[10px] px-3',
        sm: 'h-9 min-w-9 rounded-[8px] px-2.5 text-xs',
        lg: 'h-11 min-w-11 rounded-[10px] px-4',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type ToggleProps = React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>;

const Toggle = React.forwardRef<React.ElementRef<typeof TogglePrimitive.Root>, ToggleProps>(
  ({ className, variant, size, ...props }, ref) => (
    <TogglePrimitive.Root
      ref={ref}
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  ),
);
Toggle.displayName = TogglePrimitive.Root.displayName;

export { Toggle, toggleVariants };
