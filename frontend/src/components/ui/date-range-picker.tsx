'use client';

import * as React from 'react';
import { differenceInCalendarDays, format, isValid, parse } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { type DateRange } from 'react-day-picker';
import { useIsMobile } from '@/shared/hooks/use-mobile';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface DateRangePickerProps {
  startDate?: string;
  endDate?: string;
  onChange?: (value: { startDate: string; endDate: string }) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  id?: string;
}

function parseDate(value?: string) {
  if (!value) {
    return undefined;
  }

  const parsed = parse(value, 'yyyy-MM-dd', new Date());
  return isValid(parsed) ? parsed : undefined;
}

export function DateRangePicker({
  startDate,
  endDate,
  onChange,
  placeholder = 'Pick a date range',
  disabled,
  invalid = false,
  className,
  id,
}: DateRangePickerProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);

  const selected = React.useMemo<DateRange | undefined>(() => {
    const from = parseDate(startDate);
    const to = parseDate(endDate);

    if (!from && !to) {
      return undefined;
    }

    return { from, to };
  }, [endDate, startDate]);

  const rangeLabel = React.useMemo(() => {
    if (selected?.from && selected.to) {
      return `${format(selected.from, 'LLL dd, y')} - ${format(selected.to, 'LLL dd, y')}`;
    }

    if (selected?.from) {
      return format(selected.from, 'LLL dd, y');
    }

    return placeholder;
  }, [placeholder, selected]);

  const durationLabel = React.useMemo(() => {
    if (!selected?.from || !selected.to) {
      return null;
    }

    const totalDays = differenceInCalendarDays(selected.to, selected.from) + 1;
    return `${totalDays} day${totalDays === 1 ? '' : 's'}`;
  }, [selected]);

  const handleSelect = (nextRange: DateRange | undefined) => {
    const nextStartDate = nextRange?.from ? format(nextRange.from, 'yyyy-MM-dd') : '';
    const nextEndDate = nextRange?.to ? format(nextRange.to, 'yyyy-MM-dd') : '';

    onChange?.({
      startDate: nextStartDate,
      endDate: nextEndDate,
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-invalid={invalid}
          data-invalid={invalid ? true : undefined}
          className={cn(
            'h-auto w-full justify-start rounded-[22px] border border-white/80 bg-white/88 px-4 py-3 text-left backdrop-blur-sm transition-colors hover:bg-white',
            'data-[state=open]:border-[var(--color-primary)] data-[state=open]:bg-white',
            invalid && 'border-[var(--color-danger)] ring-4 ring-[rgba(255,81,14,0.12)]',
            className,
          )}
        >
          <CalendarIcon
            className="mt-0.5 text-[var(--color-text-muted)]"
            data-icon="inline-start"
          />
          <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col items-start gap-1">
              <span
                className={cn(
                  'truncate text-sm font-medium text-[var(--color-text)]',
                  !selected?.from && 'text-[var(--color-text-muted)]/75',
                )}
              >
                {rangeLabel}
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">
                {selected?.from && selected.to
                  ? 'Tap any date to refine the window'
                  : 'Select departure and return in one calendar'}
              </span>
            </div>
            {durationLabel ? (
              <span className="rounded-full border border-[var(--color-primary)]/24 bg-[var(--color-primary)]/10 px-3 py-1 text-[0.68rem] font-semibold tracking-[0.16em] text-[var(--color-primary)] uppercase">
                {durationLabel}
              </span>
            ) : null}
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={10}
        className="w-auto rounded-[24px] border border-white/80 bg-[rgba(255,255,255,0.96)] p-0"
      >
        <Calendar
          mode="range"
          numberOfMonths={isMobile ? 1 : 2}
          defaultMonth={selected?.from}
          selected={selected}
          onSelect={handleSelect}
        />
      </PopoverContent>
    </Popover>
  );
}
