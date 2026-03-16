import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/shared/lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-200 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:translate-y-px',
  {
    variants: {
      variant: {
        default:
          'border border-transparent bg-[var(--color-cta)] text-[var(--color-cta-foreground)] hover:bg-[#2A2A2A] hover:shadow-[var(--shadow-md)]',
        secondary: 'voyager-surface text-[var(--color-text)] hover:bg-[rgba(255,255,255,0.76)] hover:shadow-[var(--shadow-md)]',
        outline:
          'border border-[var(--color-border-strong)] bg-[rgba(255,255,255,0.56)] text-[var(--color-text)] hover:bg-[rgba(255,255,255,0.8)] hover:shadow-[var(--shadow-md)]',
        ghost: 'text-[var(--color-text-muted)] hover:bg-white/50 hover:text-[var(--color-text)]',
        destructive:
          'border border-transparent bg-[var(--color-danger)] text-white hover:bg-[#E5480D] hover:shadow-[var(--shadow-md)]',
        link: 'h-auto rounded-none p-0 text-[var(--color-info)] underline-offset-4 hover:underline',
        icon: 'border border-[var(--color-border-strong)] bg-[rgba(255,255,255,0.62)] text-[var(--color-text)] hover:bg-[rgba(255,255,255,0.84)] hover:shadow-[var(--shadow-md)]',
      },
      size: {
        default: 'h-11 rounded-[var(--radius-default)] px-5 py-2.5',
        sm: 'h-9 rounded-[var(--radius-sm)] px-3.5 text-xs',
        lg: 'h-12 rounded-[var(--radius-md)] px-8 text-base',
        icon: 'size-11 rounded-[var(--radius-default)]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
