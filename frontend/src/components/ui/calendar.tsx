import * as React from 'react';
import { DayPicker } from 'react-day-picker';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { buttonVariants } from '@/components/ui/button';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  const isSingleMode = props.mode === 'single';

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('relative p-4', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-2',
        month: 'flex flex-col gap-4',
        month_caption: 'flex justify-center items-center h-9',
        caption_label: 'text-sm font-semibold text-[var(--color-text)]',
        nav: 'absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none',
        button_previous: cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'size-8 bg-transparent p-0 opacity-70 hover:opacity-100 pointer-events-auto',
        ),
        button_next: cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'size-8 bg-transparent p-0 opacity-70 hover:opacity-100 pointer-events-auto',
        ),
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday:
          'size-10 rounded-md text-center text-[0.74rem] font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]',
        // no gap between week rows so range bg is continuous across rows
        week: 'flex w-full',
        day: cn(
          'relative size-10 p-0 text-center text-sm focus-within:relative focus-within:z-20',
          !isSingleMode && [
            '[&:has([aria-selected])]:bg-[var(--color-secondary-surface)]',
            '[&:has(.day-range-start)]:rounded-l-xl',
            '[&:has(.day-range-end)]:rounded-r-xl',
            'first:[&:has([aria-selected])]:rounded-l-xl',
            'last:[&:has([aria-selected])]:rounded-r-xl',
          ],
        ),
        day_button: cn(
          'inline-flex size-10 aspect-square items-center justify-center rounded-full p-0 text-sm font-normal',
          'text-[var(--color-text)] transition-colors',
          'hover:bg-[var(--color-secondary-surface)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-blue)]/50',
          'disabled:pointer-events-none disabled:opacity-40',
          'aria-selected:opacity-100',
        ),
        range_start: 'day-range-start',
        range_end: 'day-range-end',
        selected:
          'bg-[var(--color-accent-blue)] text-white hover:bg-[var(--color-accent-blue)] hover:text-white focus:bg-[var(--color-accent-blue)] focus:text-white rounded-full',
        today:
          '[&>button]:rounded-full [&>button]: [&>button]:text-[var(--color-text)] [&>button]:font-semibold',
        outside:
          'day-outside text-[var(--color-text-muted)]/30 aria-selected:bg-[var(--color-secondary-surface)] aria-selected:text-[var(--color-text-muted)]/30',
        disabled: 'text-[var(--color-text-muted)]/30 opacity-50',
        range_middle:
          'aria-selected:bg-[var(--color-secondary-surface)] aria-selected:text-[var(--color-text)] rounded-none',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...rest }) =>
          orientation === 'left' ? (
            <ChevronLeft {...rest} className="h-4 w-4" />
          ) : (
            <ChevronRight {...rest} className="h-4 w-4" />
          ),
      }}
      {...props}
    />
  );
}
Calendar.displayName = 'Calendar';

export { Calendar };
