import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/shared/lib/cn'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-[#2F6F73]/10 text-[#2F6F73]',
        secondary: 'bg-[#F4EBDD] text-[#526072]',
        outline: 'border border-[var(--color-border)] text-[#526072]',
        destructive: 'bg-[#C56A3D]/10 text-[#C56A3D]',
        entity: 'bg-blue-50 text-blue-700',
        action: 'bg-purple-50 text-purple-700',
        status: 'bg-[#F4EBDD] text-[#526072]',
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
