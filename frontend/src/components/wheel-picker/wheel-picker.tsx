import '@ncdai/react-wheel-picker/style.css';

import * as WheelPickerPrimitive from '@ncdai/react-wheel-picker';
import type { ComponentProps } from 'react';

import { cn } from '@/shared/lib/cn';

type WheelPickerValue = WheelPickerPrimitive.WheelPickerValue;

type WheelPickerOption<T extends WheelPickerValue = string> =
  WheelPickerPrimitive.WheelPickerOption<T>;

type WheelPickerClassNames = WheelPickerPrimitive.WheelPickerClassNames;

function WheelPickerWrapper({
  className,
  ...props
}: ComponentProps<typeof WheelPickerPrimitive.WheelPickerWrapper>) {
  return (
    <WheelPickerPrimitive.WheelPickerWrapper
      className={cn(
        '-xs w-56 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white px-1 shadow-[var(--shadow-md)]',
        '*:data-rwp:first:*:data-rwp-highlight-wrapper:rounded-s-md',
        '*:data-rwp:last:*:data-rwp-highlight-wrapper:rounded-e-md',
        className,
      )}
      {...props}
    />
  );
}

function WheelPicker<T extends WheelPickerValue = string>({
  classNames,
  ...props
}: WheelPickerPrimitive.WheelPickerProps<T>) {
  return (
    <WheelPickerPrimitive.WheelPicker
      classNames={{
        optionItem: cn(
          'text-[var(--color-text-muted)] data-disabled:opacity-40',
          classNames?.optionItem,
        ),
        highlightWrapper: cn(
          'bg-[var(--color-secondary-surface)] text-[var(--color-text)]',
          'data-rwp-focused:ring-2 data-rwp-focused:ring-zinc-300 data-rwp-focused:ring-inset dark:data-rwp-focused:ring-zinc-600',
          classNames?.highlightWrapper,
        ),
        highlightItem: cn('data-disabled:opacity-40', classNames?.highlightItem),
      }}
      {...props}
    />
  );
}

export { WheelPicker, WheelPickerWrapper };
export type { WheelPickerClassNames, WheelPickerOption };
