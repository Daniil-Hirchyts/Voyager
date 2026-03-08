import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/shared/lib/cn'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] transition-colors',
  {
    variants: {
      variant: {
        default: 'border-[rgba(114,174,230,0.2)] bg-[rgba(114,174,230,0.14)] text-[var(--color-primary-foreground)]',
        accent: 'border-[rgba(114,174,230,0.2)] bg-[rgba(114,174,230,0.14)] text-[var(--color-primary-foreground)]',
        neutral: 'border-[var(--color-border-strong)] bg-white/70 text-[var(--color-text-muted)]',
        secondary: 'border-[var(--color-border-strong)] bg-white/70 text-[var(--color-text-muted)]',
        outline: 'border-[var(--color-border-strong)] bg-transparent text-[var(--color-text-muted)]',
        destructive: 'border-[rgba(196,95,79,0.2)] bg-[rgba(196,95,79,0.12)] text-[var(--color-danger)]',
        danger: 'border-[rgba(196,95,79,0.2)] bg-[rgba(196,95,79,0.12)] text-[var(--color-danger)]',
        success: 'border-[rgba(45,124,99,0.22)] bg-[rgba(45,124,99,0.12)] text-[var(--color-success)]',
        warning: 'border-[rgba(201,138,55,0.24)] bg-[rgba(201,138,55,0.14)] text-[var(--color-warning)]',
        entity: 'border-[rgba(114,174,230,0.2)] bg-[rgba(114,174,230,0.14)] text-[var(--color-primary-foreground)]',
        action: 'border-[rgba(90,102,118,0.18)] bg-[rgba(255,255,255,0.78)] text-[var(--color-text-muted)]',
        status: 'border-[var(--color-border-strong)] bg-white/70 text-[var(--color-text-muted)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
