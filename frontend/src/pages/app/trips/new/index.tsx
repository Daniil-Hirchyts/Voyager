import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Search } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { useDestinationAutocomplete } from '@/entities/place/queries'
import { createTrip } from '@/entities/trip/api'
import { tripKeys } from '@/entities/trip/queries'
import { isApiError } from '@/shared/api/client'
import { cn } from '@/shared/lib/cn'
import { WorkspaceHeader, WorkspacePage } from '@/shared/layouts/workspace-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'

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
  'h-12 rounded-[20px] border-[var(--color-border-strong)] bg-white/76 px-4 text-[0.98rem] shadow-[inset_0_1px_0_rgba(255,255,255,0.94)]'
const invalidFieldClassName =
  'aria-invalid:border-[var(--color-danger)] aria-invalid:ring-4 aria-invalid:ring-[rgba(196,95,79,0.12)]'

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

  return (
    <WorkspacePage className="max-w-6xl">
      <Button
        asChild
        variant="ghost"
        className="w-fit px-0 text-[var(--color-text-muted)] hover:bg-transparent hover:text-[var(--color-text)]"
      >
        <Link to="/app/trips">
          <ArrowLeft data-icon="inline-start" />
          Back to trips
        </Link>
      </Button>

      <WorkspaceHeader
        eyebrow="Trip builder"
        title="New Trip"
        description="Define the trip once, then let Voyager generate a workspace-ready itinerary around the details you care about."
      />

      <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="flex flex-col">
        <Card variant="solid" className="overflow-hidden border-white/60 shadow-[0_32px_80px_-48px_rgba(32,56,83,0.25)]">
          <CardHeader className="border-b border-white/55 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(245,249,253,0.92))]">
            <CardTitle className="text-[2rem] tracking-tight">Trip details</CardTitle>
          </CardHeader>

          <CardContent className="pt-6">
            <FieldGroup className="gap-8">
              <div className="flex items-center gap-3">
                <Badge variant="neutral">Basics</Badge>
                <Separator className="flex-1 bg-white/55" />
              </div>

              <FieldGroup className="gap-4 lg:grid lg:grid-cols-2">
                <Field data-invalid={!!errors.title} className="gap-3">
                  <FieldLabel htmlFor="title">Trip Title *</FieldLabel>
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
                    <Field data-invalid={!!fieldState.error} className="gap-3">
                      <FieldLabel htmlFor="destination_text">Destination *</FieldLabel>
                      <FieldContent>
                        <Popover open={showDestinationPopover} onOpenChange={setDestinationOpen}>
                          <PopoverAnchor asChild>
                            <div className="relative">
                              <Input
                                {...field}
                                id="destination_text"
                                placeholder="Paris, France"
                                aria-invalid={!!fieldState.error}
                                className={cn(controlClassName, 'pr-12', invalidFieldClassName)}
                                onFocus={openDestinationSuggestions}
                                onBlur={scheduleDestinationSuggestionsClose}
                                onChange={(event) => {
                                  field.onChange(event.target.value)
                                  openDestinationSuggestions()
                                }}
                              />
                              <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center">
                                {isDestinationLoading ? (
                                  <Loader2 className="animate-spin text-[var(--color-text-muted)]" />
                                ) : (
                                  <Search className="text-[var(--color-text-muted)]" />
                                )}
                              </div>
                            </div>
                          </PopoverAnchor>

                          <PopoverContent
                            align="start"
                            sideOffset={10}
                            onOpenAutoFocus={(event) => event.preventDefault()}
                            className="w-[min(30rem,calc(100vw-2.5rem))] rounded-[24px] border-[var(--color-border-strong)] p-2"
                          >
                            <ScrollArea className="max-h-72">
                              <div className="flex flex-col gap-1">
                                {destinationSuggestions.length > 0 ? (
                                  destinationSuggestions.map((suggestion) => (
                                    <Button
                                      key={suggestion.id}
                                      type="button"
                                      variant="ghost"
                                      className="h-auto w-full justify-start rounded-[16px] px-3 py-3 text-left text-sm font-semibold hover:bg-[rgba(114,174,230,0.12)]"
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
                                  <div className="rounded-[16px] px-3 py-4 text-sm text-[var(--color-text-muted)]">
                                    No matches
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
                    <Field data-invalid={!!fieldState.error} className="gap-3">
                      <FieldLabel htmlFor="start-date">Start Date *</FieldLabel>
                      <FieldContent>
                        <DatePicker
                          id="start-date"
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="Select start date"
                          invalid={!!fieldState.error}
                          className={cn(controlClassName, 'justify-between px-4')}
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
                    <Field data-invalid={!!fieldState.error} className="gap-3">
                      <FieldLabel htmlFor="end-date">End Date *</FieldLabel>
                      <FieldContent>
                        <DatePicker
                          id="end-date"
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="Select end date"
                          invalid={!!fieldState.error}
                          className={cn(controlClassName, 'justify-between px-4')}
                        />
                        <FieldError errors={[fieldState.error]} />
                      </FieldContent>
                    </Field>
                  )}
                />
              </FieldGroup>

              <div className="flex items-center gap-3">
                <Badge variant="neutral">Profile</Badge>
                <Separator className="flex-1 bg-white/55" />
              </div>

              <FieldGroup className="gap-4 xl:grid xl:grid-cols-[1.1fr_0.7fr_0.85fr]">
                <Field data-invalid={!!errors.budget_amount} className="gap-3">
                  <FieldLabel htmlFor="budget_amount">Budget</FieldLabel>
                  <FieldContent>
                    <Input
                      id="budget_amount"
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      placeholder="5000"
                      aria-invalid={!!errors.budget_amount}
                      className={cn(controlClassName, 'text-lg tracking-tight', invalidFieldClassName)}
                      {...register('budget_amount', { valueAsNumber: true })}
                    />
                    <FieldError errors={[errors.budget_amount]} />
                  </FieldContent>
                </Field>

                <Controller
                  control={control}
                  name="budget_currency"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error} className="gap-3">
                      <FieldLabel htmlFor="budget-currency">Currency</FieldLabel>
                      <FieldContent>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger
                            id="budget-currency"
                            aria-invalid={!!fieldState.error}
                            className={cn(controlClassName, invalidFieldClassName)}
                          >
                            <SelectValue placeholder="Select currency" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {CURRENCIES.map((currency) => (
                                <SelectItem key={currency} value={currency}>
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
                    <Field data-invalid={!!fieldState.error} className="gap-3">
                      <FieldLabel htmlFor="trip-type">Trip Type</FieldLabel>
                      <FieldContent>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger
                            id="trip-type"
                            aria-invalid={!!fieldState.error}
                            className={cn(controlClassName, invalidFieldClassName)}
                          >
                            <SelectValue placeholder="Select trip type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {TRIP_TYPES.map((tripType) => (
                                <SelectItem key={tripType} value={tripType}>
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

              <div className="flex items-center gap-3">
                <Badge variant="neutral">Preferences</Badge>
                <Separator className="flex-1 bg-white/55" />
              </div>

              <Field data-invalid={!!errors.preferences} className="gap-3">
                <FieldLabel htmlFor="preferences">Preferences</FieldLabel>
                <FieldContent>
                  <Textarea
                    id="preferences"
                    rows={5}
                    placeholder="food museums walkable neighborhoods"
                    aria-invalid={!!errors.preferences}
                    className={cn(
                      'min-h-36 rounded-[24px] bg-white/76 p-4 text-[0.98rem] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]',
                      invalidFieldClassName,
                    )}
                    {...register('preferences')}
                  />

                  <div className="rounded-[24px] border border-dashed border-[var(--color-border-strong)] bg-white/62 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-[var(--color-text)]">Detected</span>
                      <Badge variant="neutral">
                        {parsedPreferences.length}
                      </Badge>
                    </div>

                    {parsedPreferences.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {parsedPreferences.map((preference) => (
                          <Badge
                            key={preference}
                            variant="secondary"
                            className="rounded-full px-3 py-1 text-sm normal-case tracking-normal"
                          >
                            {preference}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-[var(--color-text-muted)]">None</div>
                    )}
                  </div>

                  <FieldError errors={[errors.preferences]} />
                </FieldContent>
              </Field>
            </FieldGroup>
          </CardContent>

          <CardFooter className="flex items-center justify-end gap-3 border-t border-white/55 bg-[rgba(255,255,255,0.52)] pt-5">
            <Button asChild variant="ghost" className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
              <Link to="/app/trips">Cancel</Link>
            </Button>
            <Button type="submit" disabled={isWorking} className="h-12 min-w-40 rounded-[18px] px-6 text-base">
              {isWorking ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
              Create Trip
            </Button>
          </CardFooter>
        </Card>
      </form>
    </WorkspacePage>
  )
}
