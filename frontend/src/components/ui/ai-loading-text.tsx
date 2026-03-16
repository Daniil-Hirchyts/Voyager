'use client';

import type { JSX } from 'react';
import { TextShimmerWave } from '@/components/ui/text-shimmer-wave';
import { cn } from '@/shared/lib/cn';

interface AiLoadingTextProps {
  children: string;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
  size?: 'sm' | 'md';
  announce?: boolean;
}

const SIZE_CLASS_NAMES: Record<NonNullable<AiLoadingTextProps['size']>, string> = {
  sm: 'text-[0.78rem]',
  md: 'text-sm',
};

export function AiLoadingText({
  children,
  className,
  as = 'span',
  size = 'sm',
  announce = false,
}: AiLoadingTextProps) {
  return (
    <span
      className={cn('inline-flex min-w-0 items-center', className)}
      role={announce ? 'status' : undefined}
      aria-live={announce ? 'polite' : undefined}
    >
      <span className="sr-only">{children}</span>
      <span aria-hidden="true" className="min-w-0">
        <TextShimmerWave
          as={as}
          className={cn(
            'font-medium tracking-[-0.01em]',
            SIZE_CLASS_NAMES[size],
            '[--base-color:var(--color-text-muted)] [--base-gradient-color:var(--color-primary)]',
          )}
          duration={1}
          spread={1.15}
          zDistance={1}
          xDistance={1}
          yDistance={-0.5}
          scaleDistance={1.04}
          rotateYDistance={8}
        >
          {children}
        </TextShimmerWave>
      </span>
    </span>
  );
}
