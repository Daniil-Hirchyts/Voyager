import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { differenceInCalendarDays, format, isValid, parse, parseISO } from 'date-fns';
import {
  ArrowLeft,
  ArrowRight,
  CalendarIcon,
  CalendarRange,
  CheckCircle2,
  MapPin,
  Search,
  Settings2,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { AnimatedMoney, AnimatedNumber } from '@/components/ui/animated-number';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Field, FieldContent, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  createPlace,
  getGooglePlaceDetail,
  type DestinationAutocompleteItem,
} from '@/entities/place/api';
import {
  buildPlaceCreateInputFromDestinationSuggestion,
  isBackendPlaceId,
} from '@/entities/place/destination';
import { useDestinationAutocomplete } from '@/entities/place/queries';
import { createTrip, patchTripCoverPreference } from '@/entities/trip/api';
import { tripKeys } from '@/entities/trip/queries';
import { isApiError } from '@/shared/api/client';
import { CURRENCY_OPTIONS } from '@/shared/lib/currencies';
import { cn } from '@/shared/lib/cn';
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { VoyagerLoader } from '@/widgets/app-shell/logo';
import {
  VoyagerMap,
  VoyagerMarker,
  MapPanTo,
  type LatLngPoint,
} from '@/shared/layouts/google-maps';

// ─── Schema ───────────────────────────────────────────────────────────────────

const TRIP_TYPES = [
  'leisure',
  'business',
  'adventure',
  'cultural',
  'family',
  'romantic',
  'solo',
  'group',
] as const;

const schema = z
  .object({
    destination_text: z.string().min(1, 'Destination is required').max(200),
    start_date: z.string().min(1, 'Start date is required'),
    end_date: z.string().min(1, 'End date is required'),
    budget_amount: z
      .union([
        z
          .number()
          .positive('Budget must be a positive number')
          .max(1000000000, 'Budget is too large'),
        z.nan(),
      ])
      .optional()
      .transform((v) => (v === undefined || Number.isNaN(v) ? undefined : v)),
    budget_currency: z.string().default('USD'),
    trip_type: z
      .enum(['leisure', 'business', 'adventure', 'cultural', 'family', 'romantic', 'solo', 'group'])
      .default('leisure'),
  })
  .refine(
    (data) => {
      if (data.start_date && data.end_date) {
        return new Date(data.end_date) >= new Date(data.start_date);
      }
      return true;
    },
    { message: 'End date must be after start date', path: ['end_date'] },
  );

type FormValues = z.infer<typeof schema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toTitleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseFormDate(v: string | undefined) {
  if (!v) return null;
  const p = parseISO(v);
  return isValid(p) ? p : null;
}

// ─── Single date picker ───────────────────────────────────────────────────────

function SingleDatePicker({
  id,
  label,
  value,
  onChange,
  invalid,
  fromDate,
}: {
  id?: string;
  label: string;
  value?: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  fromDate?: Date;
}) {
  const [open, setOpen] = useState(false);

  const selected = useMemo(() => {
    if (!value) return undefined;
    const d = parse(value, 'yyyy-MM-dd', new Date());
    return isValid(d) ? d : undefined;
  }, [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-invalid={invalid}
          className={cn(
            'flex w-full flex-col items-start gap-1 rounded-[var(--radius)] border px-4 py-3 text-left transition-colors',
            invalid
              ? 'border-[var(--color-danger)]/50 bg-[var(--color-danger)]/5'
              : open
                ? 'border-[var(--color-primary)]/50 bg-white'
                : 'border-[var(--color-border-strong)] bg-white hover:border-[var(--color-primary)]/40 hover:bg-[var(--color-bg-soft)]',
            'focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:outline-none',
          )}
        >
          <span className="text-[0.62rem] font-semibold tracking-[0.18em] text-[var(--color-text-muted)]/70 uppercase">
            {label}
          </span>
          <div className="flex items-center gap-2">
            <CalendarIcon className="size-3.5 shrink-0 text-[var(--color-text-muted)]" />
            <span
              className={cn(
                'text-[0.9rem] font-semibold',
                selected ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]/50',
              )}
            >
              {selected ? format(selected, 'MMM d, yyyy') : 'Pick a date'}
            </span>
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-auto rounded-[var(--radius)] border border-[var(--color-border-strong)] bg-white p-0"
        style={{ zIndex: 200 }}
      >
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(day) => {
            onChange(day ? format(day, 'yyyy-MM-dd') : '');
            setOpen(false);
          }}
          defaultMonth={selected ?? fromDate}
          fromDate={fromDate}
        />
      </PopoverContent>
    </Popover>
  );
}

// ─── Light Currency Select ────────────────────────────────────────────────────

function CurrencySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const selected = CURRENCY_OPTIONS.find((o) => o.value === value);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        id="budget-currency"
        aria-label="Currency"
        className="h-12 w-[7.5rem] shrink-0 rounded-[var(--radius)] border-[var(--color-border-strong)] bg-white text-[var(--color-text)] hover:bg-[var(--color-bg-soft)]"
      >
        <span className="text-sm font-medium">{selected?.label ?? value}</span>
      </SelectTrigger>
      <SelectContent className="max-h-56 overflow-y-auto rounded-[var(--radius)] border border-[var(--color-border-strong)] bg-white">
        <SelectGroup>
          {CURRENCY_OPTIONS.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="cursor-pointer rounded-xl text-sm text-[var(--color-text)] focus:bg-[var(--color-bg-soft)]"
            >
              {option.label}
              {option.description ? ` ${option.description}` : ''}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

// ─── Map click geocoding ───────────────────────────────────────────────────────

function buildItemFromGeocodeResult(
  latLng: google.maps.LatLng,
  results: google.maps.GeocoderResult[],
): DestinationAutocompleteItem | null {
  const lat = latLng.lat();
  const lng = latLng.lng();

  // Prefer a result whose own type is a recognisable city-level entity
  const CITY_TYPES = ['locality', 'postal_town', 'sublocality'];
  const REGION_TYPES = ['administrative_area_level_2', 'administrative_area_level_1'];

  const best =
    results.find((r) => r.types.some((t) => CITY_TYPES.includes(t))) ??
    results.find((r) => r.types.some((t) => REGION_TYPES.includes(t)));

  if (!best) return null;

  let name: string | null = null;
  let region: string | null = null;
  let country: string | null = null;

  for (const comp of best.address_components) {
    if (
      !name &&
      comp.types.some((t) =>
        ['locality', 'postal_town', 'sublocality_level_1', 'administrative_area_level_2'].includes(
          t,
        ),
      )
    )
      name = comp.long_name;
    if (!region && comp.types.includes('administrative_area_level_1')) region = comp.long_name;
    if (!country && comp.types.includes('country')) country = comp.long_name;
  }

  if (!name) return null;

  const label = [name, country].filter(Boolean).join(', ');

  return {
    id: `map:${lat.toFixed(6)},${lng.toFixed(6)}`,
    label,
    name,
    region: region ?? null,
    country: country ?? null,
    lat,
    lon: lng,
    address_text: best.formatted_address ?? null,
    category: null,
    timezone: null,
  };
}

function MapClickPickerEffect({
  enabled,
  onLocationPicked,
}: {
  enabled: boolean;
  onLocationPicked: (item: DestinationAutocompleteItem) => void;
}) {
  const geocodingLib = useMapsLibrary('geocoding');
  const map = useMap();

  useEffect(() => {
    if (!enabled || !map || !geocodingLib) return;
    const geocoder = new geocodingLib.Geocoder();
    const listener = map.addListener('click', (e: google.maps.MapMouseEvent) => {
      e.stop();
      const latLng = e.latLng;
      if (!latLng) return;
      geocoder.geocode({ location: latLng }, (results, status) => {
        if (status === 'OK' && results && results.length > 0) {
          const item = buildItemFromGeocodeResult(latLng, results);
          if (item) {
            onLocationPicked(item);
          } else {
            toast.info('Click on a city or town to set the destination.');
          }
        } else {
          toast.info('No location found here. Try clicking on a city.');
        }
      });
    });
    return () => listener.remove();
  }, [enabled, map, geocodingLib, onLocationPicked]);

  return null;
}

// ─── Steps ────────────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, icon: MapPin },
  { id: 2, icon: CalendarRange },
  { id: 3, icon: Settings2 },
] as const;

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TripCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [step, setStep] = useState(1);
  const [animating, setAnimating] = useState(false);
  const [animDir, setAnimDir] = useState<'fwd' | 'back'>('fwd');
  const [destinationOpen, setDestinationOpen] = useState(false);
  const [selectedDestinationSuggestion, setSelectedDestinationSuggestion] =
    useState<DestinationAutocompleteItem | null>(null);
  const destinationBlurRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      destination_text: '',
      start_date: '',
      end_date: '',
      budget_currency: 'USD',
      trip_type: 'leisure',
    },
  });

  const {
    register,
    control,
    handleSubmit,
    setValue,
    trigger,
    formState: { errors, isSubmitting },
  } = form;

  const destinationText = useWatch({ control, name: 'destination_text' }) ?? '';
  const startDateValue = useWatch({ control, name: 'start_date' }) ?? '';
  const endDateValue = useWatch({ control, name: 'end_date' }) ?? '';
  const budgetAmount = useWatch({ control, name: 'budget_amount' });
  const budgetCurrency = useWatch({ control, name: 'budget_currency' }) ?? 'USD';
  const tripType = useWatch({ control, name: 'trip_type' }) ?? 'leisure';

  const deferredQuery = useDeferredValue(destinationText.trim());

  const destinationSearch = useDestinationAutocomplete(
    { q: deferredQuery, limit: 8, offset: 0 },
    deferredQuery.length >= 2,
  );

  const suggestions = useMemo(
    () => (destinationSearch.data?.items ?? []).slice(0, 6),
    [destinationSearch.data?.items],
  );
  const showSuggestions = destinationOpen && deferredQuery.length >= 2;
  const isFetchingDest = deferredQuery.length >= 2 && destinationSearch.isFetching;

  const parsedStart = useMemo(() => parseFormDate(startDateValue), [startDateValue]);
  const parsedEnd = useMemo(() => parseFormDate(endDateValue), [endDateValue]);
  const tripDays = useMemo(() => {
    if (!parsedStart || !parsedEnd) return null;
    return differenceInCalendarDays(parsedEnd, parsedStart) + 1;
  }, [parsedEnd, parsedStart]);

  const mapCenter = useMemo((): LatLngPoint | null => {
    if (selectedDestinationSuggestion?.lat != null && selectedDestinationSuggestion?.lon != null)
      return { lat: selectedDestinationSuggestion.lat, lng: selectedDestinationSuggestion.lon };
    return null;
  }, [selectedDestinationSuggestion]);

  const handleMapLocationPicked = useCallback(
    (item: DestinationAutocompleteItem) => {
      setSelectedDestinationSuggestion(item);
      setValue('destination_text', item.label, { shouldDirty: true, shouldValidate: true });
    },
    [setValue],
  );
  const hasBudgetAmount = typeof budgetAmount === 'number' && Number.isFinite(budgetAmount);

  const dateRangeSummary = useMemo(() => {
    if (parsedStart && parsedEnd)
      return `${format(parsedStart, 'MMM d')} – ${format(parsedEnd, 'MMM d, yyyy')}`;
    if (parsedStart) return format(parsedStart, 'MMM d, yyyy');
    return null;
  }, [parsedEnd, parsedStart]);

  useEffect(
    () => () => {
      if (destinationBlurRef.current) clearTimeout(destinationBlurRef.current);
    },
    [],
  );

  const mutation = useMutation({
    mutationFn: (data: FormValues) =>
      createTrip(
        {
          destination_text: data.destination_text,
          start_date: data.start_date,
          end_date: data.end_date,
          budget_amount: data.budget_amount ?? null,
          budget_currency: data.budget_currency,
          trip_type: data.trip_type as FormValues['trip_type'],
          route_travel_mode: 'WALK',
        },
        idempotencyKey,
      ),
    onSuccess: async (trip) => {
      let destinationPlaceId: string | null = null;
      let fallbackImageUrl: string | null = null;
      if (selectedDestinationSuggestion) {
        try {
          const place = await createPlace(
            buildPlaceCreateInputFromDestinationSuggestion(selectedDestinationSuggestion),
            crypto.randomUUID(),
          );
          destinationPlaceId = place.id;
        } catch {
          destinationPlaceId = null;
        }

        if (!isBackendPlaceId(selectedDestinationSuggestion.id)) {
          try {
            const detail = await getGooglePlaceDetail(selectedDestinationSuggestion.id);
            fallbackImageUrl = detail.photos?.[0]?.image_url ?? null;
          } catch {
            fallbackImageUrl = null;
          }
        }
      }

      await patchTripCoverPreference(trip.id, {
        placeId: destinationPlaceId,
        placeLabel:
          selectedDestinationSuggestion?.label ?? form.getValues('destination_text') ?? null,
        placeLat: selectedDestinationSuggestion?.lat ?? null,
        placeLng: selectedDestinationSuggestion?.lon ?? null,
        photoId: null,
        fallbackImageUrl,
      });
      queryClient.invalidateQueries({ queryKey: tripKeys.all });
      const plannerSearchParams = new URLSearchParams();
      if (destinationPlaceId) {
        plannerSearchParams.set('placeId', destinationPlaceId);
      }
      if (
        selectedDestinationSuggestion?.lat != null &&
        selectedDestinationSuggestion?.lon != null
      ) {
        plannerSearchParams.set('lat', String(selectedDestinationSuggestion.lat));
        plannerSearchParams.set('lng', String(selectedDestinationSuggestion.lon));
      }
      const plannerPath = plannerSearchParams.size
        ? `/app/trips/${trip.id}/plan?${plannerSearchParams.toString()}`
        : `/app/trips/${trip.id}/plan`;
      navigate(plannerPath);
      toast.success('Trip created successfully');
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 429)
        toast.error('Too many requests — please wait.');
      else if (isApiError(error) && error.status === 409)
        toast.info('Trip already created — redirecting…');
      else toast.error('Failed to create trip. Please try again.');
    },
  });

  const isWorking = isSubmitting || mutation.isPending;

  const openSuggestions = useCallback(() => {
    if (destinationBlurRef.current) clearTimeout(destinationBlurRef.current);
    setDestinationOpen(true);
  }, []);

  const scheduleSuggestionsClose = useCallback(() => {
    if (destinationBlurRef.current) clearTimeout(destinationBlurRef.current);
    destinationBlurRef.current = setTimeout(() => setDestinationOpen(false), 150);
  }, []);

  const goToStep = useCallback(
    async (next: number) => {
      if (animating) return;
      if (next > step) {
        if (step === 1) {
          const textOk = await trigger('destination_text');
          if (!textOk) return;
          if (!selectedDestinationSuggestion) {
            toast.error('Please select a destination from the suggestions list.');
            return;
          }
        }
        if (step === 2) {
          const a = await trigger('start_date');
          const b = await trigger('end_date');
          if (!a || !b) return;
        }
      }
      setAnimDir(next > step ? 'fwd' : 'back');
      setAnimating(true);
      setTimeout(() => {
        setStep(next);
        setAnimating(false);
      }, 230);
    },
    [animating, step, trigger, selectedDestinationSuggestion],
  );

  return (
    <div className="flex h-dvh flex-col-reverse overflow-hidden bg-white md:flex-row">
      {/* ── Wizard panel (LEFT on desktop, BOTTOM on mobile) ── */}
      <div className="relative z-10 flex h-[72%] shrink-0 flex-col overflow-hidden md:h-full md:w-[440px] md:border-r md:border-[var(--color-border-strong)]">
        {/* Panel background */}
        <div className="absolute inset-0 bg-white" />

        <div className="relative flex h-full flex-col overflow-hidden px-6 py-5 md:px-8 md:py-7">
          {/* Top bar */}
          <div className="mb-6 flex shrink-0 items-center justify-between">
            <button
              type="button"
              onClick={() => navigate('/app/trips')}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[0.76rem] font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-soft)] hover:text-[var(--color-text)] focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:outline-none"
            >
              ×&nbsp;Cancel
            </button>
            {/* Step dots */}
            <div className="flex items-center gap-2">
              {STEPS.map((s) => (
                <div
                  key={s.id}
                  className={cn(
                    'rounded-full transition-all duration-300',
                    step === s.id
                      ? 'h-[6px] w-5 bg-[var(--color-text)]'
                      : step > s.id
                        ? 'h-[6px] w-[6px] bg-[var(--color-text-muted)]/50'
                        : 'h-[6px] w-[6px] bg-[var(--color-text-muted)]/20',
                  )}
                />
              ))}
            </div>
          </div>

          {/* Step content */}
          <div
            className={cn(
              'flex min-h-0 flex-1 flex-col overflow-y-auto transition-all duration-[230ms]',
              animating && animDir === 'fwd'
                ? '-translate-x-3 opacity-0'
                : animating && animDir === 'back'
                  ? 'translate-x-3 opacity-0'
                  : 'translate-x-0 opacity-100',
            )}
            style={{ willChange: 'transform, opacity' }}
          >
            <form
              id="trip-create-form"
              onSubmit={handleSubmit((data) => mutation.mutate(data))}
              className="flex flex-1 flex-col gap-5"
            >
              {/* ── Headings ── */}
              {step === 1 && (
                <StepHeading
                  step={1}
                  title="Where are you going?"
                  subtitle="A city, region, or landmark."
                />
              )}
              {step === 2 && (
                <StepHeading
                  step={2}
                  title="When will you travel?"
                  subtitle="Pick your start and end dates."
                />
              )}
              {step === 3 && (
                <StepHeading
                  step={3}
                  title="Final details"
                  subtitle="Optional — edit anytime later."
                />
              )}

              {/* ══ Step 1 — always in DOM for tests ══ */}
              <div
                className={
                  step !== 1 ? 'pointer-events-none sr-only absolute' : 'flex flex-col gap-4'
                }
              >
                <Controller
                  control={control}
                  name="destination_text"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error} className="gap-2">
                      <FieldLabel
                        htmlFor="destination_text"
                        className="text-[0.67rem] font-semibold tracking-[0.22em] text-[var(--color-text-muted)] uppercase"
                      >
                        Destination *
                      </FieldLabel>
                      <FieldContent>
                        <Popover open={showSuggestions} onOpenChange={setDestinationOpen}>
                          <PopoverAnchor asChild>
                            <div
                              className={cn(
                                'relative rounded-[calc(var(--radius)+2px)] p-[2px] transition-colors',
                                fieldState.error
                                  ? 'bg-[rgba(255,81,14,0.16)]'
                                  : 'focus-within:bg-[rgba(23,23,23,0.02)]',
                              )}
                            >
                              <Input
                                {...field}
                                id="destination_text"
                                placeholder="Paris, Tokyo, Bali…"
                                aria-label="Destination"
                                aria-invalid={!!fieldState.error}
                                autoComplete="off"
                                className={cn(
                                  'h-12 rounded-[var(--radius)] border-[var(--color-border-strong)] bg-white px-4 pr-11 text-[0.93rem] font-medium text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/50',
                                  '',
                                  'hover:border-[var(--color-primary)]/40 hover:bg-[var(--color-bg-soft)]',
                                  'focus-visible:border-[var(--color-primary)]/55 focus-visible:ring-0',
                                  'aria-invalid:border-[var(--color-danger)]/50',
                                )}
                                onFocus={openSuggestions}
                                onBlur={scheduleSuggestionsClose}
                                onChange={(e) => {
                                  if (selectedDestinationSuggestion?.label !== e.target.value)
                                    setSelectedDestinationSuggestion(null);
                                  field.onChange(e.target.value);
                                  openSuggestions();
                                }}
                              />
                              <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center">
                                {isFetchingDest ? (
                                  <VoyagerLoader className="size-4 text-[var(--color-text-muted)]/50" />
                                ) : (
                                  <Search className="size-4 text-[var(--color-text-muted)]/50" />
                                )}
                              </div>
                            </div>
                          </PopoverAnchor>
                          <PopoverContent
                            align="start"
                            sideOffset={6}
                            onOpenAutoFocus={(e) => e.preventDefault()}
                            className="w-[min(var(--radix-popper-anchor-width),calc(100vw-2rem))] min-w-0 rounded-[var(--radius)] border border-[var(--color-border-strong)] bg-white p-1.5"
                            style={{ zIndex: 200 }}
                          >
                            <div className="flex flex-col gap-0.5">
                              {suggestions.length > 0 ? (
                                suggestions.map((s) => {
                                  const meta = [s.region, s.country].filter(Boolean).join(' · ');
                                  return (
                                    <Button
                                      key={s.id}
                                      type="button"
                                      variant="ghost"
                                      aria-label={s.label}
                                      className="h-auto w-full min-w-0 flex-col items-start gap-0.5 rounded-xl px-3 py-2.5 text-left hover:bg-[var(--color-bg-soft)]"
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => {
                                        setValue('destination_text', s.label, {
                                          shouldDirty: true,
                                          shouldValidate: true,
                                        });
                                        setSelectedDestinationSuggestion(s);
                                        setDestinationOpen(false);
                                      }}
                                    >
                                      <span className="w-full truncate text-[0.88rem] font-semibold text-[var(--color-text)]">
                                        {s.label}
                                      </span>
                                      <span className="w-full truncate text-[0.72rem] text-[var(--color-text-muted)]">
                                        {meta || 'Place'}
                                      </span>
                                    </Button>
                                  );
                                })
                              ) : (
                                <div className="px-3 py-2.5 text-sm text-[var(--color-text-muted)]">
                                  {deferredQuery.length >= 2 && !isFetchingDest
                                    ? 'No matches found'
                                    : 'Searching…'}
                                </div>
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                        <FieldError errors={[fieldState.error]} />
                      </FieldContent>
                    </Field>
                  )}
                />

                {selectedDestinationSuggestion && (
                  <div className="animate-in fade-in slide-in-from-bottom-1 flex items-center gap-3 rounded-[var(--radius)] border border-[var(--color-border-strong)] bg-[var(--color-bg-soft)] px-4 py-3 duration-250">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)]/15">
                      <MapPin className="size-3.5 text-[var(--color-primary-foreground)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.84rem] font-semibold text-[var(--color-text)]">
                        {selectedDestinationSuggestion.name ?? selectedDestinationSuggestion.label}
                      </p>
                      <p className="truncate text-[0.7rem] text-[var(--color-text-muted)]">
                        {[
                          selectedDestinationSuggestion.region,
                          selectedDestinationSuggestion.country,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-[var(--color-success)]/10 px-2.5 py-0.5 text-[0.62rem] font-semibold tracking-wide text-[var(--color-success)]">
                      Located
                    </span>
                  </div>
                )}
              </div>

              {/* ══ Step 2 — always in DOM ══ */}
              <div
                className={
                  step !== 2 ? 'pointer-events-none sr-only absolute' : 'flex flex-col gap-4'
                }
              >
                {/* Hidden inputs keep date values in the form payload */}
                <input
                  type="text"
                  className="sr-only"
                  {...register('start_date')}
                  aria-label="Select start date"
                  onChange={(e) => {
                    register('start_date').onChange(e);
                    setValue('start_date', e.target.value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }}
                />
                <input
                  type="text"
                  className="sr-only"
                  {...register('end_date')}
                  aria-label="Select end date"
                  onChange={(e) => {
                    register('end_date').onChange(e);
                    setValue('end_date', e.target.value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }}
                />

                <div className="flex gap-3">
                  <Field data-invalid={!!errors.start_date} className="flex-1 gap-2">
                    <FieldContent>
                      <SingleDatePicker
                        id="trip-start-date"
                        label="Departure"
                        value={startDateValue}
                        invalid={!!errors.start_date}
                        onChange={(v) =>
                          setValue('start_date', v, { shouldDirty: true, shouldValidate: true })
                        }
                      />
                      <FieldError errors={[errors.start_date]} />
                    </FieldContent>
                  </Field>
                  <Field data-invalid={!!errors.end_date} className="flex-1 gap-2">
                    <FieldContent>
                      <SingleDatePicker
                        id="trip-end-date"
                        label="Return"
                        value={endDateValue}
                        invalid={!!errors.end_date}
                        fromDate={parsedStart ?? undefined}
                        onChange={(v) =>
                          setValue('end_date', v, { shouldDirty: true, shouldValidate: true })
                        }
                      />
                      <FieldError errors={[errors.end_date]} />
                    </FieldContent>
                  </Field>
                </div>

                {tripDays !== null && (
                  <div className="animate-in fade-in slide-in-from-bottom-1 flex gap-3 duration-250">
                    <div className="flex-1 rounded-[var(--radius)] border border-[var(--color-border-strong)] bg-[var(--color-bg-soft)] px-4 py-3.5">
                      <p className="mb-1.5 text-[0.62rem] font-semibold tracking-[0.18em] text-[var(--color-text-muted)]/60 uppercase">
                        Duration
                      </p>
                      <p className="text-[1.35rem] leading-none font-bold tracking-[-0.04em] text-[var(--color-text)]">
                        <AnimatedNumber value={tripDays} />{' '}
                        <span className="text-[0.88rem] font-medium text-[var(--color-text-muted)]">
                          {tripDays === 1 ? 'day' : 'days'}
                        </span>
                      </p>
                    </div>
                    {dateRangeSummary && (
                      <div className="flex-1 rounded-[var(--radius)] border border-[var(--color-border-strong)] bg-[var(--color-bg-soft)] px-4 py-3.5">
                        <p className="mb-1.5 text-[0.62rem] font-semibold tracking-[0.18em] text-[var(--color-text-muted)]/60 uppercase">
                          Window
                        </p>
                        <p className="mt-0.5 text-[0.88rem] leading-snug font-semibold text-[var(--color-text)]">
                          {dateRangeSummary}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ══ Step 3 — always in DOM ══ */}
              <div
                className={
                  step !== 3 ? 'pointer-events-none sr-only absolute' : 'flex flex-col gap-5'
                }
              >
                {/* Budget */}
                <Field data-invalid={!!errors.budget_amount} className="gap-2">
                  <FieldLabel
                    htmlFor="budget_amount"
                    className="text-[0.67rem] font-semibold tracking-[0.22em] text-[var(--color-text-muted)] uppercase"
                  >
                    Budget
                  </FieldLabel>
                  <FieldContent>
                    <div className="flex items-center gap-2">
                      <Input
                        id="budget_amount"
                        type="number"
                        min="0"
                        max="1000000000"
                        step="any"
                        inputMode="decimal"
                        placeholder="5 000"
                        aria-label="Budget"
                        aria-invalid={!!errors.budget_amount}
                        className={cn(
                          'h-12 flex-1 rounded-[var(--radius)] border-[var(--color-border-strong)] bg-white px-4 text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/50',
                          '',
                          'hover:border-[var(--color-primary)]/40',
                          'focus-visible:border-[var(--color-primary)]/50 focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/20',
                          'aria-invalid:border-[var(--color-danger)]/50',
                          '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
                        )}
                        {...register('budget_amount', { valueAsNumber: true })}
                      />
                      <label htmlFor="budget-currency" className="sr-only">
                        Currency
                      </label>
                      <Controller
                        control={control}
                        name="budget_currency"
                        render={({ field }) => (
                          <CurrencySelect value={field.value} onChange={field.onChange} />
                        )}
                      />
                    </div>
                    <FieldError errors={[errors.budget_amount]} />
                  </FieldContent>
                </Field>

                {/* Trip type */}
                <Controller
                  control={control}
                  name="trip_type"
                  render={({ field }) => (
                    <Field className="gap-2">
                      <FieldLabel
                        htmlFor="trip-type"
                        className="text-[0.67rem] font-semibold tracking-[0.22em] text-[var(--color-text-muted)] uppercase"
                      >
                        Trip type
                      </FieldLabel>
                      <FieldContent>
                        <div className="grid grid-cols-4 gap-1.5">
                          {TRIP_TYPES.map((type) => (
                            <button
                              key={type}
                              type="button"
                              onClick={() => field.onChange(type)}
                              className={cn(
                                'h-9 rounded-xl text-[0.73rem] font-semibold transition-all duration-200',
                                field.value === type
                                  ? 'bg-[var(--color-text)] text-white'
                                  : 'border border-[var(--color-border-strong)] bg-[var(--color-bg-soft)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-deep)]/40 hover:text-[var(--color-text)]',
                              )}
                            >
                              {toTitleCase(type)}
                            </button>
                          ))}
                        </div>
                        {/* Accessible select for tests */}
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger
                            id="trip-type"
                            aria-label="Trip type"
                            className="pointer-events-none mt-1 h-[1px] w-full overflow-hidden border-0 p-0 opacity-0 focus:ring-0"
                            tabIndex={-1}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-[var(--radius)] border border-[var(--color-border-strong)] bg-white">
                            <SelectGroup>
                              {TRIP_TYPES.map((type) => (
                                <SelectItem
                                  key={type}
                                  value={type}
                                  className="cursor-pointer rounded-xl text-sm text-[var(--color-text)] focus:bg-[var(--color-bg-soft)]"
                                >
                                  {toTitleCase(type)}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </FieldContent>
                    </Field>
                  )}
                />

                {/* Summary: budget + style */}
                <div className="flex gap-3 rounded-[var(--radius)] border border-[var(--color-border-strong)] bg-[var(--color-bg-soft)] px-4 py-4">
                  <div className="flex-1">
                    <p className="mb-1 text-[0.6rem] font-semibold tracking-[0.18em] text-[var(--color-text-muted)]/60 uppercase">
                      Budget
                    </p>
                    <p className="text-[0.86rem] font-semibold text-[var(--color-text)]">
                      {hasBudgetAmount ? (
                        <AnimatedMoney value={budgetAmount} currency={budgetCurrency} />
                      ) : (
                        'Open budget'
                      )}
                    </p>
                  </div>
                  <div className="flex-1 text-right">
                    <p className="mb-1 text-[0.6rem] font-semibold tracking-[0.18em] text-[var(--color-text-muted)]/60 uppercase">
                      Style
                    </p>
                    <p className="text-[0.86rem] font-semibold text-[var(--color-text)]">
                      {toTitleCase(tripType)}
                    </p>
                  </div>
                </div>
              </div>
            </form>
          </div>

          {/* ── Nav footer ── */}
          <div className="mt-3 flex shrink-0 items-center justify-between gap-3 border-t border-[var(--color-border-strong)] pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => goToStep(step - 1)}
              className={cn(
                'h-10 gap-1.5 rounded-full px-4 text-[0.85rem] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-bg-soft)] hover:text-[var(--color-text)]',
                step <= 1 && 'pointer-events-none invisible',
              )}
            >
              <ArrowLeft className="size-3.5" />
              Back
            </Button>

            <div className="relative flex items-center">
              <Button
                type="button"
                onClick={() => goToStep(step + 1)}
                className={cn(
                  'h-10 gap-1.5 rounded-full bg-[var(--color-cta)] px-5 text-[0.88rem] font-semibold text-[var(--color-cta-foreground)] hover:opacity-85',
                  step >= 3 && 'pointer-events-none invisible absolute right-0',
                )}
              >
                Continue
                <ArrowRight className="size-3.5" />
              </Button>
              <Button
                type="submit"
                form="trip-create-form"
                disabled={isWorking}
                className={cn(
                  'h-10 gap-1.5 rounded-full bg-[var(--color-cta)] px-5 text-[0.88rem] font-semibold text-[var(--color-cta-foreground)] hover:opacity-85',
                  step < 3 && 'pointer-events-none invisible absolute right-0',
                )}
              >
                {isWorking ? (
                  <VoyagerLoader className="size-3.5" />
                ) : (
                  <CheckCircle2 className="size-3.5" />
                )}
                Create trip
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Map (RIGHT on desktop, TOP on mobile) ── */}
      <div className="relative h-[28%] overflow-hidden md:h-full md:flex-1">
        <VoyagerMap
          defaultCenter={{ lat: 20, lng: 10 }}
          defaultZoom={3}
          minZoom={3}
          restriction={{
            latLngBounds: { north: 85, south: -85, west: -179.99, east: 179.99 },
            strictBounds: true,
          }}
          style={{ width: '100%', height: '100%' }}
          className="absolute inset-0"
        >
          <MapPanTo point={mapCenter} zoom={9} />
          <MapClickPickerEffect enabled={step === 1} onLocationPicked={handleMapLocationPicked} />
          {mapCenter && (
            <VoyagerMarker
              key={`destination-${mapCenter.lat}-${mapCenter.lng}`}
              position={mapCenter}
              title={selectedDestinationSuggestion?.label ?? ''}
            />
          )}
        </VoyagerMap>
        {/* Tap-to-set hint — only on step 1 before a destination is chosen */}
        {step === 1 && !selectedDestinationSuggestion && (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
            <div className="flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5 text-[0.72rem] font-medium text-white backdrop-blur-sm">
              <MapPin className="size-3 shrink-0" />
              Click the map to set destination
            </div>
          </div>
        )}
        {/* Left edge fade towards wizard panel */}
        <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-12 bg-gradient-to-r from-white/20 to-transparent md:block" />
        {/* Bottom fade on mobile */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white/60 to-transparent md:hidden" />
      </div>
    </div>
  );
}

// ─── Step heading sub-component ───────────────────────────────────────────────

function StepHeading({ step, title, subtitle }: { step: number; title: string; subtitle: string }) {
  return (
    <div className="mb-1 shrink-0">
      <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--color-primary)]/15 px-2.5 py-0.5">
        <span className="text-[0.62rem] font-semibold tracking-[0.24em] text-[var(--color-primary-foreground)]/70 uppercase">
          Step {step} of {STEPS.length}
        </span>
      </div>
      <h1 className="mb-1.5 text-[1.9rem] leading-[1.03] font-bold tracking-[-0.05em] text-[var(--color-text)] md:text-[2.25rem]">
        {title}
      </h1>
      <p className="text-[0.84rem] leading-relaxed text-[var(--color-text-muted)]">{subtitle}</p>
    </div>
  );
}
