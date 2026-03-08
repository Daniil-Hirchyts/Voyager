import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Search } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useDestinationAutocomplete } from '@/entities/place/queries'
import { createTrip } from '@/entities/trip/api'
import { tripKeys } from '@/entities/trip/queries'
import { isApiError } from '@/shared/api/client'
import { cn } from '@/shared/lib/cn'
import { WorkspacePage } from '@/shared/layouts/workspace-shell'
import { useAppShellHeaderActions } from '@/widgets/app-shell'

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'] as const
const TRIP_TYPES = [
  'leisure',
  'business',
  'adventure',
  'cultural',
  'family',
  'romantic',
  'solo',
  'group',
] as const

const PREFERENCE_PATTERNS = [
  { label: 'food', matchers: [/\bfood\b/i, /\brestaurants?\b/i, /\bdining\b/i] },
  { label: 'street food', matchers: [/\bstreet food\b/i, /\bfood stalls?\b/i] },
  { label: 'coffee', matchers: [/\bcoffee\b/i, /\bcafes?\b/i] },
  { label: 'museums', matchers: [/\bmuseums?\b/i, /\bgalleries?\b/i] },
  { label: 'history', matchers: [/\bhistory\b/i, /\bhistoric(?:al)?\b/i, /\bheritage\b/i] },
  { label: 'architecture', matchers: [/\barchitecture\b/i, /\bdesign\b/i] },
  { label: 'walkable neighborhoods', matchers: [/\bwalkable\b/i, /\bon foot\b/i] },
  { label: 'nightlife', matchers: [/\bnightlife\b/i, /\bbars?\b/i, /\bclubs?\b/i] },
  { label: 'local markets', matchers: [/\bmarkets?\b/i, /\bbazaars?\b/i] },
  { label: 'shopping', matchers: [/\bshopping\b/i, /\boutlets?\b/i, /\bboutiques?\b/i] },
  { label: 'nature', matchers: [/\bnature\b/i, /\bparks?\b/i, /\bgardens?\b/i] },
  { label: 'hiking', matchers: [/\bhiking\b/i, /\btrails?\b/i, /\btrekking\b/i] },
  { label: 'beaches', matchers: [/\bbeaches?\b/i, /\bcoast(?:al)?\b/i] },
  { label: 'wellness', matchers: [/\bwellness\b/i, /\bspa\b/i, /\brelax(?:ing|ation)?\b/i] },
  { label: 'luxury stays', matchers: [/\bluxury\b/i, /\bboutique hotel\b/i] },
  { label: 'budget friendly', matchers: [/\bbudget\b/i, /\baffordable\b/i] },
  { label: 'family friendly', matchers: [/\bfamily\b/i, /\bkid(?:s)?\b/i, /\bchildren\b/i] },
  { label: 'romantic spots', matchers: [/\bromantic\b/i, /\bcouples?\b/i] },
  { label: 'quiet stays', matchers: [/\bquiet\b/i, /\bcalm\b/i, /\bpeaceful\b/i] },
  { label: 'public transit', matchers: [/\bmetro\b/i, /\bpublic transit\b/i, /\btrain access\b/i] },
  { label: 'photography', matchers: [/\bphoto(?:graphy)?\b/i, /\bscenic\b/i] },
] as const

const schema = z
  .object({
    title: z.string().min(1, 'Trip title is required').max(200, 'Title must be under 200 characters'),
    destination_text: z.string().min(1, 'Destination is required').max(200),
    start_date: z.string().min(1, 'Start date is required'),
    end_date: z.string().min(1, 'End date is required'),
    budget_amount: z
      .union([z.number().positive('Budget must be a positive number'), z.nan()])
      .optional()
      .transform((value) => (value === undefined || Number.isNaN(value) ? undefined : value)),
    budget_currency: z.string().default('USD'),
    trip_type: z
      .enum(['leisure', 'business', 'adventure', 'cultural', 'family', 'romantic', 'solo', 'group'])
      .default('leisure'),
    preferences: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.start_date && data.end_date) {
        return new Date(data.end_date) >= new Date(data.start_date)
      }

      return true
    },
    { message: 'End date must be after start date', path: ['end_date'] },
  )

type FormValues = z.infer<typeof schema>

type DestinationSuggestion = {
  id: string
  value: string
}

const controlClassName =
  'h-10 rounded-[10px] border-[rgba(0,0,0,0.08)] bg-white px-3.5 text-sm shadow-none placeholder:text-[var(--color-text-muted)]/80 focus:border-[rgba(0,0,0,0.12)] focus:ring-4 focus:ring-[rgba(26,22,21,0.06)]'
const invalidFieldClassName =
  'aria-invalid:border-[var(--color-danger)] aria-invalid:ring-4 aria-invalid:ring-[rgba(196,95,79,0.12)]'
const sectionClassName = 'rounded-[12px] border border-black/8 bg-[var(--color-secondary-surface)] p-5'
const sectionTitleClassName = 'text-[0.96rem] font-medium text-[var(--color-text)]'
const fieldLabelClassName =
  'text-[0.78rem] font-medium normal-case tracking-normal text-[var(--color-text-muted)]'

function toTitleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function normalizePreferenceSegment(segment: string) {
  return segment
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(
      /^(?:i|we)(?:'d| would| are| am| want| wants| need| needs| love| loves| enjoy| enjoys| prefer| prefers)?\s+/i,
      '',
    )
    .replace(
      /^(?:looking for|interested in|focused on|things like|a mix of|mix of|please include|please add|ideally|mostly)\s+/i,
      '',
    )
    .replace(/\b(?:please|maybe|some|very|really|pretty|quite|trip|travel|itinerary)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parsePreferences(text?: string) {
  if (!text?.trim()) {
    return []
  }

  const detected = new Set<string>()

  for (const pattern of PREFERENCE_PATTERNS) {
    if (pattern.matchers.some((matcher) => matcher.test(text))) {
      detected.add(pattern.label)
    }
  }

  const candidateSegments = text
    .replace(/\n+/g, ', ')
    .replace(/[;|•]+/g, ', ')
    .replace(/\s+(?:and|plus|with|including|along with|as well as)\s+/gi, ', ')
    .replace(/\.\s+/g, ', ')
    .split(',')
    .map((segment) => normalizePreferenceSegment(segment))
    .filter(Boolean)

  for (const segment of candidateSegments) {
    const cleaned = segment
      .replace(/^(?:good|great|nice|more|less)\s+/i, '')
      .replace(/\b(?:near|around|close to|next to|nearby)\b.*$/i, '')
      .replace(/\b(?:for us|for me|to explore|to stay in)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()

    if (!cleaned || cleaned.length < 3) {
      continue
    }

    if (cleaned.split(' ').length > 5) {
      continue
    }

    detected.add(cleaned)
  }

  return Array.from(detected).slice(0, 8)
}

export default function TripCreatePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [destinationOpen, setDestinationOpen] = useState(false)
  const destinationBlurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      destination_text: '',
      start_date: '',
      end_date: '',
      budget_currency: 'USD',
      trip_type: 'leisure',
      preferences: '',
    },
  })

  const destinationText = useWatch({ control: form.control, name: 'destination_text' }) ?? ''
  const preferencesText = useWatch({ control: form.control, name: 'preferences' }) ?? ''
  const deferredDestinationQuery = useDeferredValue(destinationText.trim())

  const destinationSearch = useDestinationAutocomplete(
    { q: deferredDestinationQuery, limit: 8, offset: 0 },
    deferredDestinationQuery.length >= 2,
  )

  const destinationSuggestions = useMemo<DestinationSuggestion[]>(() => {
    return (destinationSearch.data?.items ?? [])
      .map((item) => ({
        id: item.id,
        value: item.label,
      }))
      .slice(0, 6)
  }, [destinationSearch.data?.items])

  const parsedPreferences = useMemo(() => parsePreferences(preferencesText), [preferencesText])
  const hasPreferenceInput = preferencesText.trim().length > 0
  const showDestinationPopover = destinationOpen && deferredDestinationQuery.length >= 2
  const isDestinationLoading = deferredDestinationQuery.length >= 2 && destinationSearch.isFetching

  useEffect(() => {
    return () => {
      if (destinationBlurTimeoutRef.current) {
        clearTimeout(destinationBlurTimeoutRef.current)
      }
    }
  }, [])

  const mutation = useMutation({
    mutationFn: (data: FormValues) => {
      const payload = {
        title: data.title,
        destination_text: data.destination_text,
        start_date: data.start_date,
        end_date: data.end_date,
        budget_amount: data.budget_amount ?? null,
        budget_currency: data.budget_currency,
        trip_type: data.trip_type as FormValues['trip_type'],
        preferences: parsePreferences(data.preferences),
      }

      return createTrip(payload, idempotencyKey)
    },
    onSuccess: (trip) => {
      queryClient.invalidateQueries({ queryKey: tripKeys.all })
      navigate(`/app/trips/${trip.id}`)
      toast.success('Trip created successfully')
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 429) {
        toast.error('Too many requests. Please wait a moment before trying again.')
      } else if (isApiError(error) && error.status === 409) {
        toast.info('Trip already created. Redirecting…')
      } else {
        toast.error('Failed to create trip. Please try again.')
      }
    },
  })

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = form

  const isWorking = isSubmitting || mutation.isPending

  const openDestinationSuggestions = () => {
    if (destinationBlurTimeoutRef.current) {
      clearTimeout(destinationBlurTimeoutRef.current)
    }

    setDestinationOpen(true)
  }

  const scheduleDestinationSuggestionsClose = () => {
    if (destinationBlurTimeoutRef.current) {
      clearTimeout(destinationBlurTimeoutRef.current)
    }

    destinationBlurTimeoutRef.current = setTimeout(() => {
      setDestinationOpen(false)
    }, 140)
  }

  const headerActions = useMemo(
    () => (
      <>
        <Button
          asChild
          variant="ghost"
          className="h-8 rounded-[8px] px-3 text-[0.84rem] font-medium text-[var(--color-text-muted)] hover:bg-black/4 hover:text-[var(--color-text)]"
        >
          <Link to="/app/trips">Cancel</Link>
        </Button>
        <Button
          type="submit"
          form="trip-create-form"
          disabled={isWorking}
          className="h-8 rounded-[8px] px-3.5 text-[0.84rem] font-medium shadow-none hover:shadow-none"
        >
          {isWorking ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
          Create trip
        </Button>
      </>
    ),
    [isWorking],
  )
  const hasShellHeaderActions = useAppShellHeaderActions(headerActions)

  return (
    <WorkspacePage className="max-w-none gap-4">
      <form
        id="trip-create-form"
        onSubmit={handleSubmit((data) => mutation.mutate(data))}
        className="grid gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(18rem,0.82fr)]"
      >
        <section className={sectionClassName}>
          <div className="mb-4">
            <h2 className={sectionTitleClassName}>Trip details</h2>
          </div>

          <FieldGroup className="gap-4">
            <FieldGroup className="gap-4 lg:grid lg:grid-cols-2">
              <Field data-invalid={!!errors.title} className="gap-2">
                <FieldLabel htmlFor="title" className={fieldLabelClassName}>
                  Trip title *
                </FieldLabel>
                <FieldContent>
                  <Input
                    id="title"
                    placeholder="Tokyo Adventure 2026"
                    aria-invalid={!!errors.title}
                    className={cn(controlClassName, invalidFieldClassName)}
                    {...register('title')}
                  />
                  <FieldError errors={[errors.title]} />
                </FieldContent>
              </Field>

              <Controller
                control={control}
                name="destination_text"
                render={({ field, fieldState }) => (
                  <Field data-invalid={!!fieldState.error} className="gap-2">
                    <FieldLabel htmlFor="destination_text" className={fieldLabelClassName}>
                      Destination *
                    </FieldLabel>
                    <FieldContent>
                      <Popover open={showDestinationPopover} onOpenChange={setDestinationOpen}>
                        <PopoverAnchor asChild>
                          <div className="relative">
                            <Input
                              {...field}
                              id="destination_text"
                              placeholder="Paris, France"
                              aria-invalid={!!fieldState.error}
                              className={cn(controlClassName, 'pr-10', invalidFieldClassName)}
                              onFocus={openDestinationSuggestions}
                              onBlur={scheduleDestinationSuggestionsClose}
                              onChange={(event) => {
                                field.onChange(event.target.value)
                                openDestinationSuggestions()
                              }}
                            />
                            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                              {isDestinationLoading ? (
                                <Loader2 className="size-4 animate-spin text-[var(--color-text-muted)]" />
                              ) : (
                                <Search className="size-4 text-[var(--color-text-muted)]" />
                              )}
                            </div>
                          </div>
                        </PopoverAnchor>

                        <PopoverContent
                          align="start"
                          sideOffset={8}
                          onOpenAutoFocus={(event) => event.preventDefault()}
                          className="w-[min(28rem,calc(100vw-2rem))] rounded-[12px] border-[rgba(0,0,0,0.08)] bg-white p-1.5 shadow-[0_16px_36px_-28px_rgba(26,22,21,0.35)] backdrop-blur-none"
                        >
                          <ScrollArea className="max-h-64">
                            <div className="flex flex-col gap-1">
                              {destinationSuggestions.length > 0 ? (
                                destinationSuggestions.map((suggestion) => (
                                  <Button
                                    key={suggestion.id}
                                    type="button"
                                    variant="ghost"
                                    className="h-10 w-full justify-start rounded-[8px] px-3 text-left text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-secondary-surface)]"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => {
                                      setValue('destination_text', suggestion.value, {
                                        shouldDirty: true,
                                        shouldValidate: true,
                                      })
                                      setDestinationOpen(false)
                                    }}
                                  >
                                    {suggestion.value}
                                  </Button>
                                ))
                              ) : (
                                <div className="rounded-[8px] px-3 py-2.5 text-sm text-[var(--color-text-muted)]">
                                  No matches found
                                </div>
                              )}
                            </div>
                          </ScrollArea>
                        </PopoverContent>
                      </Popover>
                      <FieldError errors={[fieldState.error]} />
                    </FieldContent>
                  </Field>
                )}
              />
            </FieldGroup>

            <FieldGroup className="gap-4 lg:grid lg:grid-cols-2">
              <Controller
                control={control}
                name="start_date"
                render={({ field, fieldState }) => (
                  <Field data-invalid={!!fieldState.error} className="gap-2">
                    <FieldLabel htmlFor="start-date" className={fieldLabelClassName}>
                      Start date *
                    </FieldLabel>
                    <FieldContent>
                      <DatePicker
                        id="start-date"
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Select start date"
                        invalid={!!fieldState.error}
                        className={cn(controlClassName, 'justify-between px-3.5')}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </FieldContent>
                  </Field>
                )}
              />

              <Controller
                control={control}
                name="end_date"
                render={({ field, fieldState }) => (
                  <Field data-invalid={!!fieldState.error} className="gap-2">
                    <FieldLabel htmlFor="end-date" className={fieldLabelClassName}>
                      End date *
                    </FieldLabel>
                    <FieldContent>
                      <DatePicker
                        id="end-date"
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Select end date"
                        invalid={!!fieldState.error}
                        className={cn(controlClassName, 'justify-between px-3.5')}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </FieldContent>
                  </Field>
                )}
              />
            </FieldGroup>
          </FieldGroup>
        </section>

        <section className={sectionClassName}>
          <div className="mb-4">
            <h2 className={sectionTitleClassName}>Budget and type</h2>
          </div>

          <FieldGroup className="gap-4">
            <Field data-invalid={!!errors.budget_amount} className="gap-2">
              <FieldLabel htmlFor="budget_amount" className={fieldLabelClassName}>
                Budget
              </FieldLabel>
              <FieldContent>
                <Input
                  id="budget_amount"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  placeholder="5000"
                  aria-invalid={!!errors.budget_amount}
                  className={cn(controlClassName, invalidFieldClassName)}
                  {...register('budget_amount', { valueAsNumber: true })}
                />
                <FieldError errors={[errors.budget_amount]} />
              </FieldContent>
            </Field>

            <Controller
              control={control}
              name="budget_currency"
              render={({ field, fieldState }) => (
                <Field data-invalid={!!fieldState.error} className="gap-2">
                  <FieldLabel htmlFor="budget-currency" className={fieldLabelClassName}>
                    Currency
                  </FieldLabel>
                  <FieldContent>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger
                        id="budget-currency"
                        aria-invalid={!!fieldState.error}
                        className={cn(controlClassName, invalidFieldClassName)}
                      >
                        <SelectValue placeholder="Select currency" />
                      </SelectTrigger>
                      <SelectContent className="rounded-[12px] border-[rgba(0,0,0,0.08)] bg-white shadow-[0_16px_36px_-28px_rgba(26,22,21,0.35)] backdrop-blur-none">
                        <SelectGroup>
                          {CURRENCIES.map((currency) => (
                            <SelectItem
                              key={currency}
                              value={currency}
                              className="rounded-[8px] text-sm font-normal"
                            >
                              {currency}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldError errors={[fieldState.error]} />
                  </FieldContent>
                </Field>
              )}
            />

            <Controller
              control={control}
              name="trip_type"
              render={({ field, fieldState }) => (
                <Field data-invalid={!!fieldState.error} className="gap-2">
                  <FieldLabel htmlFor="trip-type" className={fieldLabelClassName}>
                    Trip type
                  </FieldLabel>
                  <FieldContent>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger
                        id="trip-type"
                        aria-invalid={!!fieldState.error}
                        className={cn(controlClassName, invalidFieldClassName)}
                      >
                        <SelectValue placeholder="Select trip type" />
                      </SelectTrigger>
                      <SelectContent className="rounded-[12px] border-[rgba(0,0,0,0.08)] bg-white shadow-[0_16px_36px_-28px_rgba(26,22,21,0.35)] backdrop-blur-none">
                        <SelectGroup>
                          {TRIP_TYPES.map((tripType) => (
                            <SelectItem
                              key={tripType}
                              value={tripType}
                              className="rounded-[8px] text-sm font-normal"
                            >
                              {toTitleCase(tripType)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldError errors={[fieldState.error]} />
                  </FieldContent>
                </Field>
              )}
            />
          </FieldGroup>
        </section>

        <section className={cn(sectionClassName, 'xl:col-span-2')}>
          <div className="mb-4">
            <h2 className={sectionTitleClassName}>Preferences</h2>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
            <Field data-invalid={!!errors.preferences} className="gap-2">
              <FieldLabel htmlFor="preferences" className="sr-only">
                Preferences
              </FieldLabel>
              <FieldContent>
                <Textarea
                  id="preferences"
                  rows={7}
                  placeholder="Museums, good coffee, walkable neighborhoods, quiet hotel"
                  aria-invalid={!!errors.preferences}
                  className={cn(
                    'min-h-44 rounded-[10px] border-[rgba(0,0,0,0.08)] bg-white px-3.5 py-3 text-sm shadow-none placeholder:text-[var(--color-text-muted)]/80 focus:border-[rgba(0,0,0,0.12)] focus:ring-4 focus:ring-[rgba(26,22,21,0.06)]',
                    invalidFieldClassName,
                  )}
                  {...register('preferences')}
                />
                <FieldError errors={[errors.preferences]} />
              </FieldContent>
            </Field>

            <div className="rounded-[10px] border border-black/8 bg-white p-3.5">
              <div className="text-[0.78rem] font-medium normal-case tracking-normal text-[var(--color-text-muted)]">
                Parsed preferences
              </div>

              {hasPreferenceInput && parsedPreferences.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {parsedPreferences.map((preference) => (
                    <span
                      key={preference}
                      className="rounded-full border border-[rgba(0,0,0,0.08)] bg-[var(--color-secondary-surface)] px-2.5 py-1 text-sm text-[var(--color-text)]"
                    >
                      {preference}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-[var(--color-text-muted)]">
                  Structured preferences will appear here.
                </p>
              )}
            </div>
          </div>

          {!hasShellHeaderActions ? (
            <div className="mt-4 flex items-center justify-end gap-2 border-t border-black/8 pt-4">
              <Button
                asChild
                variant="ghost"
                className="h-10 rounded-[8px] px-3.5 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                <Link to="/app/trips">Cancel</Link>
              </Button>
              <Button
                type="submit"
                disabled={isWorking}
                className="h-10 rounded-[8px] px-4 text-sm font-medium shadow-none hover:shadow-none"
              >
                {isWorking ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
                Create trip
              </Button>
            </div>
          ) : null}
        </section>
      </form>
    </WorkspacePage>
  )
}
