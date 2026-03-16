import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/shared/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] transition-colors',
  {
    variants: {
      variant: {
        default:
          'border-[var(--color-accent-blue)]/20 bg-[var(--color-accent-blue)]/10 text-[var(--color-accent-blue)]',
        accent:
          'border-[var(--color-accent-blue)]/20 bg-[var(--color-accent-blue)]/10 text-[var(--color-accent-blue)]',
        neutral: 'border-[var(--color-border-strong)] bg-white/70 text-[var(--color-text-muted)]',
        secondary: 'border-[var(--color-border-strong)] bg-white/70 text-[var(--color-text-muted)]',
        outline:
          'border-[var(--color-border-strong)] bg-transparent text-[var(--color-text-muted)]',
        destructive:
          'border-[rgba(255,81,14,0.2)] bg-[rgba(255,81,14,0.10)] text-[var(--color-danger)]',
        danger: 'border-[rgba(255,81,14,0.2)] bg-[rgba(255,81,14,0.10)] text-[var(--color-danger)]',
        success:
          'border-[rgba(0,201,120,0.22)] bg-[rgba(0,201,120,0.10)] text-[var(--color-success)]',
        warning:
          'border-[rgba(255,162,0,0.24)] bg-[rgba(255,162,0,0.12)] text-[var(--color-warning)]',
        entity:
          'border-[var(--color-accent-blue)]/20 bg-[var(--color-accent-blue)]/10 text-[var(--color-accent-blue)]',
        action:
          'border-[rgba(23,23,23,0.10)] bg-[rgba(255,255,255,0.78)] text-[var(--color-text-muted)]',
        status: 'border-[var(--color-border-strong)] bg-white/70 text-[var(--color-text-muted)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
