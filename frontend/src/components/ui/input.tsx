import * as React from 'react'
import { cn } from '@/shared/lib/cn'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-11 w-full rounded-[18px] border border-[var(--color-border-strong)] bg-[rgba(255,255,255,0.78)] px-4 py-2 text-sm text-[var(--color-text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] outline-none transition-[background-color,border-color,box-shadow] file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-[var(--color-text-muted)]/70 focus:border-[var(--color-primary)] focus:ring-4 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'

export { Input }
