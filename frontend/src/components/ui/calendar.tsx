import * as React from 'react'
import { DayPicker } from 'react-day-picker'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { buttonVariants } from '@/components/ui/button'

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
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
        month_grid: 'w-full border-collapse space-x-1',
        weekdays: 'flex',
        weekday: 'w-9 rounded-md text-center text-[0.74rem] font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]',
        week: 'flex w-full mt-2',
        day: cn(
          'relative p-0 text-center text-sm focus-within:relative focus-within:z-20',
          '[&:has([aria-selected])]:bg-[rgba(114,174,230,0.12)]',
          '[&:has([aria-selected].day-range-end)]:rounded-r-md',
          'first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md',
        ),
        day_button: cn(
          buttonVariants({ variant: 'ghost' }),
          'size-9 rounded-[14px] p-0 font-normal aria-selected:opacity-100',
        ),
        range_start: 'day-range-start',
        range_end: 'day-range-end',
        selected:
          'bg-[var(--color-cta)] text-white hover:bg-[#2a2422] hover:text-white focus:bg-[var(--color-cta)] focus:text-white rounded-[14px]',
        today: 'bg-[rgba(114,174,230,0.12)] text-[var(--color-text)] rounded-[14px]',
        outside:
          'day-outside text-[var(--color-text-muted)]/40 aria-selected:bg-[rgba(114,174,230,0.12)] aria-selected:text-[var(--color-text-muted)]/40',
        disabled: 'text-[var(--color-text-muted)]/30 opacity-50',
        range_middle:
          'aria-selected:bg-[rgba(114,174,230,0.12)] aria-selected:text-[var(--color-text)] rounded-none',
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
  )
}
Calendar.displayName = 'Calendar'

export { Calendar }
