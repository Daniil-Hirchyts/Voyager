import * as React from 'react';
import { cn } from '@/shared/lib/cn';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[96px] w-full resize-none rounded-[22px] border border-[var(--color-border-strong)] bg-[rgba(255,255,255,0.78)] px-4 py-3 text-sm text-[var(--color-text)] transition-[background-color,border-color,box-shadow] outline-none placeholder:text-[var(--color-text-muted)]/70 focus:border-[var(--color-primary)] focus:ring-4 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
