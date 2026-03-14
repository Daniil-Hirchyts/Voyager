import * as React from 'react'
import { cn } from '@/shared/lib/cn'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[96px] w-full rounded-[22px] border border-[var(--color-border-strong)] bg-[rgba(255,255,255,0.78)] px-4 py-3 text-sm text-[var(--color-text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] outline-none transition-[background-color,border-color,box-shadow] placeholder:text-[var(--color-text-muted)]/70 focus:border-[var(--color-primary)] focus:ring-4 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50 resize-none',
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Textarea.displayName = 'Textarea'

export { Textarea }
