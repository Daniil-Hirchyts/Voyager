import { useEffect, useRef, useState } from 'react';
import { Check, FileText, MapPin, Paperclip, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  WheelPicker,
  WheelPickerWrapper,
  type WheelPickerOption,
} from '@/components/wheel-picker/wheel-picker';
import { cn } from '@/shared/lib/cn';
import { VoyagerLoader } from '@/widgets/app-shell/logo';
import {
  candidateIdentity,
  formatAttachmentBytes,
  formatPlaceCaption,
  normalizePlaceSearchQuery,
  pendingAttachmentKey,
  splitTimeParts,
  normalizeTypedTime,
} from './activity-drawer.utils';
import type { PlaceCandidate } from './activity-drawer.types';

const TRAVEL_HOUR_OPTIONS: WheelPickerOption[] = Array.from({ length: 24 }, (_, index) => {
  const value = String(index).padStart(2, '0');
  return { value, label: value };
});

const TRAVEL_MINUTE_OPTIONS: WheelPickerOption[] = Array.from({ length: 60 }, (_, index) => {
  const value = String(index).padStart(2, '0');
  return { value, label: value };
});

export function PlaceSelector({
  inputId,
  query,
  selectedCandidate,
  onQueryChange,
  onSelect,
  autoFocus = false,
  searchPlaceholder,
  helperText,
  results = [],
  isSearching = false,
}: {
  inputId?: string;
  query: string;
  selectedCandidate?: PlaceCandidate | null;
  onQueryChange: (value: string) => void;
  onSelect: (candidate: PlaceCandidate) => void;
  autoFocus?: boolean;
  searchPlaceholder: string;
  helperText: string;
  results?: PlaceCandidate[];
  isSearching?: boolean;
}) {
  const normalizedQuery = normalizePlaceSearchQuery(query);
  const showResults = normalizedQuery.length >= 3;
  const showSelectedSummary = !normalizedQuery && Boolean(selectedCandidate);
  return (
    <div className="rounded-[16px] p-3">
      {' '}
      <div className="relative">
        {' '}
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />{' '}
        <Input
          id={inputId}
          autoFocus={autoFocus}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-11 rounded-[12px] border-[var(--color-border)] bg-white pl-10"
        />{' '}
      </div>{' '}
      {showSelectedSummary && selectedCandidate ? (
        <div className="mt-3 flex items-start gap-3 rounded-[12px] bg-white px-3 py-3">
          {' '}
          <div className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-[var(--color-secondary-surface)]">
            {' '}
            <MapPin className="h-4 w-4 text-[var(--color-text-muted)]" />{' '}
          </div>{' '}
          <div className="min-w-0 flex-1">
            {' '}
            <p className="truncate text-sm font-medium text-[var(--color-text)]">
              {' '}
              {selectedCandidate.name}{' '}
            </p>{' '}
            <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">
              {' '}
              {formatPlaceCaption(selectedCandidate)}{' '}
            </p>{' '}
          </div>{' '}
          <Check className="mt-0.5 h-4 w-4 text-[var(--color-text)]" />{' '}
        </div>
      ) : null}{' '}
      <ScrollArea className="mt-3 max-h-72">
        {' '}
        <div className="flex flex-col gap-1 pr-2">
          {' '}
          {!showResults ? (
            <div className="rounded-[12px] px-1 py-2 text-sm text-[var(--color-text-muted)]">
              {' '}
              {helperText}{' '}
            </div>
          ) : isSearching ? (
            <div className="flex items-center gap-2 rounded-[12px] px-3 py-3 text-sm text-[var(--color-text-muted)]">
              {' '}
              <VoyagerLoader className="h-4 w-4" /> Searching places...{' '}
            </div>
          ) : results.length ? (
            results.map((result) => {
              const isSelected =
                selectedCandidate != null &&
                candidateIdentity(selectedCandidate) === candidateIdentity(result);
              return (
                <button
                  key={candidateIdentity(result)}
                  type="button"
                  onClick={() => onSelect(result)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-[12px] border px-3 py-3 text-left transition-colors',
                    isSelected
                      ? 'border-[rgba(23,23,23,0.12)] bg-white'
                      : 'border-transparent hover:bg-white',
                  )}
                >
                  {' '}
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-[12px] bg-white">
                    {' '}
                    <MapPin className="h-4 w-4 text-[var(--color-text-muted)]" />{' '}
                  </div>{' '}
                  <div className="min-w-0 flex-1">
                    {' '}
                    <p className="truncate text-sm font-medium text-[var(--color-text)]">
                      {' '}
                      {result.name}{' '}
                    </p>{' '}
                    <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">
                      {' '}
                      {formatPlaceCaption(result)}{' '}
                    </p>{' '}
                  </div>{' '}
                  {isSelected ? (
                    <Check className="mt-0.5 h-4 w-4 text-[var(--color-text)]" />
                  ) : null}{' '}
                </button>
              );
            })
          ) : (
            <div className="rounded-[12px] px-3 py-3 text-sm text-[var(--color-text-muted)]">
              {' '}
              No places found yet. Try a simpler landmark or venue name.{' '}
            </div>
          )}{' '}
        </div>{' '}
      </ScrollArea>{' '}
    </div>
  );
}

export function TravelTimeWheelPicker({
  value,
  onChange,
  inputAriaLabel = 'Type start time',
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  inputAriaLabel?: string;
}) {
  const { hour, minute } = splitTimeParts(value);
  const normalizedValue = `${hour}:${minute}`;
  const [draftValue, setDraftValue] = useState(normalizedValue);
  const [isInputFocused, setIsInputFocused] = useState(false);

  useEffect(() => {
    if (!isInputFocused) {
      setDraftValue(normalizedValue);
    }
  }, [isInputFocused, normalizedValue]);

  const commitTypedValue = (rawValue: string = draftValue) => {
    const nextValue = normalizeTypedTime(rawValue);
    if (nextValue) {
      setDraftValue(nextValue);
      if (nextValue !== normalizedValue) {
        onChange(nextValue);
      }
      return;
    }
    setDraftValue(normalizedValue);
  };

  return (
    <div className="rounded-[16px] p-3">
      {' '}
      <div className="">
        {' '}
        <p className="text-[0.64rem] font-medium tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
          {' '}
          Selected time{' '}
        </p>{' '}
        <Input
          type="text"
          inputMode="numeric"
          aria-label={inputAriaLabel}
          value={draftValue}
          onFocus={() => setIsInputFocused(true)}
          onChange={(event) => setDraftValue(event.target.value)}
          onBlur={(event) => {
            setIsInputFocused(false);
            commitTypedValue(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') {
              return;
            }
            event.preventDefault();
            event.currentTarget.blur();
          }}
          className="mt-1 h-auto border-0 bg-transparent px-0 py-0 text-[1.05rem] font-semibold tracking-[0.08em] tabular-nums text-[var(--color-text)] shadow-none focus:border-transparent focus:ring-0"
        />{' '}
      </div>{' '}
      <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-[12px] bg-white ">
        {' '}
        <WheelPickerWrapper className="w-full rounded-[12px] px-1 shadow-none">
          {' '}
          <WheelPicker
            value={hour}
            options={TRAVEL_HOUR_OPTIONS}
            onValueChange={(nextHour) => onChange(`${String(nextHour)}:${minute}`)}
            infinite
            optionItemHeight={30}
            visibleCount={7}
            classNames={{
              optionItem: 'text-[0.78rem] font-medium text-[var(--color-text-muted)]',
              highlightWrapper: 'rounded-[10px] bg-white text-[var(--color-text)] ring-0',
              highlightItem:
                'text-[0.9rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]',
            }}
          />{' '}
        </WheelPickerWrapper>{' '}
        <span className="text-base leading-none font-semibold text-[var(--color-text-muted)]">:</span>{' '}
        <WheelPickerWrapper className="w-full rounded-[12px] px-1 shadow-none">
          {' '}
          <WheelPicker
            value={minute}
            options={TRAVEL_MINUTE_OPTIONS}
            onValueChange={(nextMinute) => onChange(`${hour}:${String(nextMinute)}`)}
            infinite
            optionItemHeight={30}
            visibleCount={7}
            classNames={{
              optionItem: 'text-[0.78rem] font-medium text-[var(--color-text-muted)]',
              highlightWrapper: 'rounded-[10px] bg-white text-[var(--color-text)] ring-0',
              highlightItem:
                'text-[0.9rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]',
            }}
          />{' '}
        </WheelPickerWrapper>{' '}
      </div>{' '}
    </div>
  );
}

export function PendingActivityAttachments({
  files,
  onAddFiles,
  onRemoveFile,
}: {
  files: File[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (fileKey: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <section className="rounded-[18px] bg-white p-4">
      {' '}
      <div className="flex items-start justify-between gap-4">
        {' '}
        <div>
          {' '}
          <p className="text-[0.72rem] font-medium tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
            {' '}
            Attachments{' '}
          </p>{' '}
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
            {' '}
            Add files now and they will be linked to this activity right after save.{' '}
          </p>{' '}
        </div>{' '}
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-full border-[var(--color-border)] px-3 text-[0.76rem] font-semibold"
          onClick={() => inputRef.current?.click()}
        >
          {' '}
          <Paperclip className="mr-1.5 h-3.5 w-3.5" /> Join file{' '}
        </Button>{' '}
      </div>{' '}
      <input
        ref={inputRef}
        type="file"
        multiple
        aria-label="Attach files to activity"
        className="sr-only"
        onChange={(event) => {
          const selectedFiles = event.target.files ? Array.from(event.target.files) : [];
          if (selectedFiles.length > 0) {
            onAddFiles(selectedFiles);
          }
          event.target.value = '';
        }}
      />{' '}
      {files.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2">
          {' '}
          {files.map((file) => {
            const fileKey = pendingAttachmentKey(file);
            return (
              <div
                key={fileKey}
                className="flex items-center gap-3 rounded-[14px] bg-[#F3F5F7] px-3 py-2.5"
              >
                {' '}
                <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-white">
                  {' '}
                  <FileText className="h-4 w-4 text-[var(--color-text-muted)]" />{' '}
                </div>{' '}
                <div className="min-w-0 flex-1">
                  {' '}
                  <p className="truncate text-sm font-semibold text-[var(--color-text)]">
                    {' '}
                    {file.name}{' '}
                  </p>{' '}
                  <p className="mt-0.5 text-[0.72rem] text-[var(--color-text-muted)]">
                    {' '}
                    {formatAttachmentBytes(file.size)}{' '}
                  </p>{' '}
                </div>{' '}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-full text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-text)]"
                  onClick={() => onRemoveFile(fileKey)}
                  aria-label={`Remove ${file.name}`}
                >
                  {' '}
                  <Trash2 className="h-4 w-4" />{' '}
                </Button>{' '}
              </div>
            );
          })}{' '}
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-center rounded-[16px] border border-dashed border-[var(--color-border)] bg-[var(--color-secondary-surface)] px-4 py-6 text-center">
          {' '}
          <div>
            {' '}
            <p className="text-sm font-medium text-[var(--color-text-muted)]">
              {' '}
              No files linked yet{' '}
            </p>{' '}
            <p className="mt-1 text-[0.72rem] text-[var(--color-text-muted)]">
              {' '}
              Add tickets, PDFs, screenshots, or booking confirmations.{' '}
            </p>{' '}
          </div>{' '}
        </div>
      )}{' '}
    </section>
  );
}
