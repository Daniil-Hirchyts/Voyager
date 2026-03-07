import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/shared/lib/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-[#2F6F73] text-white hover:bg-[#266063]',
        secondary:
          'bg-[#F4EBDD] text-[#526072] hover:bg-[#E7D8C3]',
        outline:
          'border border-[var(--color-border)] bg-transparent text-[#526072] hover:bg-[#F4EBDD] hover:text-[#1D2430]',
        ghost:
          'text-[#526072] hover:bg-[#F4EBDD] hover:text-[#1D2430]',
        destructive:
          'bg-[#C56A3D] text-white hover:bg-[#b05e35]',
        link:
          'text-[#2F6F73] underline-offset-4 hover:underline',
        icon:
          'border border-[var(--color-border)] bg-transparent text-[#526072] hover:bg-[#F4EBDD]',
      },
      size: {
        default: 'h-9 rounded-[10px] px-4 py-2',
        sm: 'h-8 rounded-[8px] px-3 text-xs',
        lg: 'h-11 rounded-[10px] px-8',
        icon: 'h-9 w-9 rounded-[10px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
