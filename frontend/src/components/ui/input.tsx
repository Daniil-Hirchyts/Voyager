import * as React from 'react';
import { cn } from '@/shared/lib/cn';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-11 w-full rounded-[var(--radius-default)] border border-[var(--color-border)] bg-[#FFFFFF] px-4 py-2 text-sm text-[var(--color-text)] transition-[background-color,border-color,box-shadow] outline-none file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-[var(--color-text-muted)]/70 focus:border-[var(--color-primary)] focus:ring-4 focus:ring-[rgba(23,23,23,0.05)] disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
