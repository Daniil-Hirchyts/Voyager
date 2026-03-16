import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/shared/lib/cn';

const alertVariants = cva(
  'relative flex w-full items-start gap-3 rounded-[var(--radius-md)] border p-4 shadow-[var(--shadow-sm)] [&>svg]:shrink-0 [&>svg]:mt-0.5',
  {
    variants: {
      variant: {
        default: 'border-[var(--color-border-strong)] bg-white/72 text-[var(--color-text)]',
        destructive:
          'border-[rgba(255,81,14,0.22)] bg-[rgba(255,240,238,0.92)] text-[var(--color-danger)]',
        warning:
          'border-[rgba(255,162,0,0.24)] bg-[rgba(255,247,231,0.94)] text-[var(--color-warning)]',
        success:
          'border-[rgba(0,201,120,0.22)] bg-[rgba(239,249,245,0.94)] text-[var(--color-success)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5
      ref={ref}
      className={cn('text-sm leading-none font-semibold text-current', className)}
      {...props}
    />
  ),
);
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('mt-0.5 text-sm leading-6 text-current/85', className)} {...props} />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription };
