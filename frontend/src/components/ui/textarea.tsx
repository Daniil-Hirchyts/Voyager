import * as React from 'react';
import { cn } from '@/shared/lib/cn';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[96px] w-full resize-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[#FFFFFF] px-4 py-3 text-sm text-[var(--color-text)] transition-[background-color,border-color,box-shadow] outline-none placeholder:text-[var(--color-text-muted)]/70 focus:border-[var(--color-primary)] focus:ring-4 focus:ring-[rgba(23,23,23,0.05)] disabled:cursor-not-allowed disabled:opacity-50',
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
