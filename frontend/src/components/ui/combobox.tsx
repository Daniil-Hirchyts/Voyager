import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/shared/lib/cn';
import { VoyagerLoader } from '@/widgets/app-shell/logo';

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string | null;
  keywords?: string[];
}

interface ComboboxProps {
  value?: string | null;
  onValueChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  triggerClassName?: string;
  contentClassName?: string;
  clearLabel?: string;
  onClear?: () => void;
  onSearchChange?: (query: string) => void;
  isLoading?: boolean;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export function Combobox({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  id,
  disabled,
  invalid,
  triggerClassName,
  contentClassName,
  clearLabel,
  onClear,
  onSearchChange,
  isLoading,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );
  const filteredOptions = useMemo(() => {
    // When server-side search is active (onSearchChange provided), the parent
    // already fetches filtered options from the API — skip local re-filtering
    // which would incorrectly exclude results whose English label doesn't
    // contain the user's query (e.g. "italie" vs "Rome / FCO").
    if (onSearchChange) {
      return options;
    }
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) {
      return options;
    }
    return options.filter((option) =>
      [option.label, option.value, option.description ?? '', ...(option.keywords ?? [])]
        .map(normalize)
        .some((entry) => entry.includes(normalizedQuery)),
    );
  }, [options, query, onSearchChange]);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setQuery('');
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          disabled={disabled}
          className={cn(
            'h-11 w-full justify-between rounded-[10px] border-black/8 bg-white px-3 text-left text-sm font-normal hover:bg-white',
            invalid
              ? 'border-[var(--color-danger)] ring-4 ring-[rgba(196,95,79,0.12)]'
              : 'focus-visible:ring-4 focus-visible:ring-[rgba(26,22,21,0.06)]',
            triggerClassName,
          )}
        >
          <span
            className={cn(
              'truncate',
              selectedOption ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]',
            )}
          >
            {selectedOption?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-[var(--color-text-muted)] opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className={cn(
          'w-[var(--radix-popover-trigger-width)] min-w-[16rem] rounded-[12px] border-black/8 bg-white p-0 backdrop-blur-none',
          contentClassName,
        )}
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={(nextQuery) => {
              setQuery(nextQuery);
              onSearchChange?.(nextQuery);
            }}
            placeholder={searchPlaceholder}
          />
          <CommandList>
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-[var(--color-text-muted)]">
                <VoyagerLoader className="h-4 w-4" />
                Searching…
              </div>
            ) : (
              <CommandEmpty>{emptyText}</CommandEmpty>
            )}
            <CommandGroup>
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  keywords={option.keywords}
                  onSelect={() => {
                    onValueChange(option.value);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="items-start justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{option.label}</div>
                    {option.description ? (
                      <div className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                        {option.description}
                      </div>
                    ) : null}
                  </div>
                  <Check
                    className={cn(
                      'mt-0.5 size-4 shrink-0 text-[var(--color-text)]',
                      option.value === value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {onClear && value ? (
            <>
              <CommandSeparator />
              <div className="p-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 w-full justify-start rounded-[10px] px-3 text-sm font-medium"
                  onClick={() => {
                    onClear();
                    setOpen(false);
                    setQuery('');
                  }}
                >
                  {clearLabel ?? 'Clear selection'}
                </Button>
              </div>
            </>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
