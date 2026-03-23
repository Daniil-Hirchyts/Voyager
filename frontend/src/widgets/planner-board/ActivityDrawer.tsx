import { useEffect, useMemo, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import {
  BedDouble,
  CarFront,
  Check,
  Footprints,
  Landmark,
  Plane,
  ShipWheel,
  Ticket,
  TrainFront,
  Utensils,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCreatePlace, useGooglePlaceSearch, usePlace } from '@/entities/place/queries';
import { Field, FieldContent, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useIsMobile } from '@/shared/hooks/use-mobile';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import { cn } from '@/shared/lib/cn';
import { CURRENCY_OPTIONS } from '@/shared/lib/currencies';
import TripAssetManager from '@/widgets/trip-assets';
import { VoyagerLoader } from '@/widgets/app-shell/logo';
import type {
  Activity,
  ActivityCategory,
  ActivityCreateInput,
  Place,
  PlaceCreateInput,
  PlannerActivity,
} from '@/shared/api/types';
import {
  PLANNER_CATEGORY_META,
  PLANNER_TRAVEL_MODE_OPTIONS,
  plannerCategoryLabel,
} from './categories';
import { activitySchema, INBOX_DAY_VALUE } from './activity-drawer.schema';
import type { ActivityFormValues, CreateFlow, Step } from './activity-drawer.schema';
import type { PlaceCandidate } from './activity-drawer.types';
import {
  activityToForm,
  autoResolveCandidate,
  candidateFromGooglePlace,
  candidateFromHotelDetails,
  candidateFromTravelDetails,
  candidateMatchesQuery,
  currentStepDescription,
  detailsRecord,
  emptyActivityForm,
  formatPlaceCaption,
  mergePendingAttachments,
  normalizePlaceSearchQuery,
  normalizeTravelMode,
  pendingAttachmentKey,
  plannerActivityCandidate,
} from './activity-drawer.utils';
import {
  PendingActivityAttachments,
  PlaceSelector,
  TravelTimeWheelPicker,
} from './ActivityDrawerPrimitives';

interface Props {
  tripId: string;
  open: boolean;
  activity?: Activity | PlannerActivity | null;
  defaultTripDayId?: string | null;
  defaultCategory?: ActivityCategory | null;
  defaultDayLabel?: string | null;
  dayOptions?: ComboboxOption[];
  onClose: () => void;
  onSave: (data: ActivityCreateInput, attachmentFiles?: File[]) => Promise<void>;
  isSaving?: boolean;
}

const CATEGORY_ICON: Record<ActivityCategory, typeof Landmark> = {
  visit: Landmark,
  eat: Utensils,
  activity: Ticket,
  hotel: BedDouble,
  travel: Plane,
};

const TRAVEL_MODE_ICON = {
  flight: Plane,
  train: TrainFront,
  car: CarFront,
  ferry: ShipWheel,
  walk: Footprints,
} as const;

export function ActivityDrawer({
  tripId,
  open,
  activity,
  defaultTripDayId = null,
  defaultCategory = null,
  defaultDayLabel = null,
  dayOptions = [],
  onClose,
  onSave,
  isSaving,
}: Props) {
  const isMobile = useIsMobile();
  const isCreate = !activity;
  const createFlow: CreateFlow = !isCreate
    ? 'itinerary'
    : defaultCategory === 'hotel'
      ? 'hotel'
      : defaultCategory === 'travel'
        ? 'travel'
        : 'itinerary';
  const minimumStep: Step = !isCreate || createFlow !== 'itinerary' ? 2 : 0;
  const initialCreateCategory: ActivityCategory =
    defaultCategory ??
    (createFlow === 'hotel' ? 'hotel' : createFlow === 'travel' ? 'travel' : 'visit');
  const existingDetails = useMemo(
    () => detailsRecord(activity?.category_details),
    [activity?.category_details],
  );
  const hotelDetailsCandidate = useMemo(
    () => candidateFromHotelDetails(existingDetails),
    [existingDetails],
  );
  const titleAutofillLockedRef = useRef(false);
  const isAutofillingTitleRef = useRef(false);
  const lastAutoTitleRef = useRef('');
  const [step, setStep] = useState<Step>(minimumStep);
  const [category, setCategory] = useState<ActivityCategory>(
    activity?.category ?? initialCreateCategory,
  );
  const [primaryQuery, setPrimaryQuery] = useState('');
  const [primaryCandidate, setPrimaryCandidate] = useState<PlaceCandidate | null>(null);
  const [originQuery, setOriginQuery] = useState('');
  const [destinationQuery, setDestinationQuery] = useState('');
  const [assignedTripDayId, setAssignedTripDayId] = useState<string | null>(
    activity?.trip_day_id ??
      (createFlow === 'travel' || createFlow === 'hotel' ? null : defaultTripDayId),
  );
  const [originCandidate, setOriginCandidate] = useState<PlaceCandidate | null>(null);
  const [destinationCandidate, setDestinationCandidate] = useState<PlaceCandidate | null>(null);
  const [pendingAttachmentFiles, setPendingAttachmentFiles] = useState<File[]>([]);
  const debouncedPrimaryQuery = useDebouncedValue(normalizePlaceSearchQuery(primaryQuery), 320);
  const debouncedOriginQuery = useDebouncedValue(normalizePlaceSearchQuery(originQuery), 320);
  const debouncedDestinationQuery = useDebouncedValue(
    normalizePlaceSearchQuery(destinationQuery),
    320,
  );
  const selectedPlaceId = activity?.place_id ?? null;
  const assignmentOptions = useMemo(
    () =>
      dayOptions.length
        ? dayOptions.map((option) =>
            option.value !== INBOX_DAY_VALUE || createFlow !== 'travel'
              ? option
              : {
                  ...option,
                  label: 'Not assigned',
                  description: 'Keep this travel segment separate until scheduled',
                },
          )
        : [
            {
              value: INBOX_DAY_VALUE,
              label: createFlow === 'travel' ? 'Not assigned' : 'Inbox',
              description:
                createFlow === 'travel'
                  ? 'Keep this travel segment separate until scheduled'
                  : 'Unassigned activity',
            },
          ],
    [createFlow, dayOptions],
  );
  const selectedAssignmentValue = assignedTripDayId ?? INBOX_DAY_VALUE;
  const assignedDayOption =
    assignmentOptions.find((option) => option.value === selectedAssignmentValue) ?? null;
  const currentDayLabel = assignedDayOption
    ? assignedDayOption.value === INBOX_DAY_VALUE || !assignedDayOption.description
      ? assignedDayOption.label
      : `${assignedDayOption.label} · ${assignedDayOption.description}`
    : (defaultDayLabel ?? 'Inbox');
  const visibleDayLabel = selectedAssignmentValue === INBOX_DAY_VALUE ? null : currentDayLabel;
  const { data: selectedPlace } = usePlace(selectedPlaceId);
  const selectedPlaceCandidate = useMemo(
    () => plannerActivityCandidate(selectedPlace as Place | null | undefined),
    [selectedPlace],
  );
  const primaryGoogleSearch = useGooglePlaceSearch(
    { q: debouncedPrimaryQuery, limit: 6, offset: 0 },
    open &&
      category !== 'travel' &&
      (step === 1 || category === 'hotel') &&
      debouncedPrimaryQuery.length >= 3,
  );
  const originGoogleSearch = useGooglePlaceSearch(
    { q: debouncedOriginQuery, limit: 6, offset: 0 },
    open && category === 'travel' && debouncedOriginQuery.length >= 3,
  );
  const destinationGoogleSearch = useGooglePlaceSearch(
    { q: debouncedDestinationQuery, limit: 6, offset: 0 },
    open && category === 'travel' && debouncedDestinationQuery.length >= 3,
  );
  const createPlaceMutation = useCreatePlace();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    watch,
    control,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<ActivityFormValues>({
    resolver: zodResolver(activitySchema),
    defaultValues: activity ? activityToForm(activity) : emptyActivityForm(),
  });
  const watchedAddressText = watch('address_text');
  const watchedTitle = watch('title');
  const watchedOriginText = watch('origin_text');
  const watchedDestinationText = watch('destination_text');

  const titleField = register('title', {
    onChange: () => {
      if (!isAutofillingTitleRef.current) {
        titleAutofillLockedRef.current = true;
        lastAutoTitleRef.current = '';
      }
    },
  });

  useEffect(() => {
    if (!open) return;

    reset(activity ? activityToForm(activity) : emptyActivityForm());
    titleAutofillLockedRef.current = Boolean(activity?.title?.trim());
    isAutofillingTitleRef.current = false;
    lastAutoTitleRef.current = activity?.title?.trim() ?? '';
    setPrimaryQuery('');
    setOriginQuery('');
    setDestinationQuery('');
    setPendingAttachmentFiles([]);
    setAssignedTripDayId(
      activity?.trip_day_id ??
        (createFlow === 'travel' || createFlow === 'hotel' ? null : (defaultTripDayId ?? null)),
    );

    if (activity) {
      setCategory(activity.category);
      setStep(2);
      setPrimaryCandidate(activity.category === 'hotel' ? hotelDetailsCandidate : null);
      setOriginCandidate(candidateFromTravelDetails(existingDetails, 'origin'));
      setDestinationCandidate(candidateFromTravelDetails(existingDetails, 'destination'));
      return;
    }

    setCategory(initialCreateCategory);
    setStep(minimumStep);
    setPrimaryCandidate(null);
    setOriginCandidate(null);
    setDestinationCandidate(null);
    setValue(
      'start_time',
      createFlow === 'travel' ? '09:00' : createFlow === 'hotel' ? '15:00' : '',
    );
    setValue('travel_mode', createFlow === 'travel' ? 'flight' : '');
  }, [
    activity,
    createFlow,
    defaultTripDayId,
    existingDetails,
    hotelDetailsCandidate,
    initialCreateCategory,
    minimumStep,
    open,
    reset,
  ]);

  const allowedCreateCategories = useMemo<ActivityCategory[]>(
    () => ['visit', 'eat', 'activity'],
    [],
  );

  const setTitleIfPristine = (nextTitle: string) => {
    const normalizedTitle = nextTitle.trim();
    const currentTitle = (getValues('title') ?? '').trim();
    if (
      !isCreate ||
      !normalizedTitle ||
      titleAutofillLockedRef.current ||
      (currentTitle && currentTitle !== lastAutoTitleRef.current)
    ) {
      return;
    }
    isAutofillingTitleRef.current = true;
    lastAutoTitleRef.current = normalizedTitle;
    setValue('title', normalizedTitle);
    queueMicrotask(() => {
      isAutofillingTitleRef.current = false;
    });
  };

  useEffect(() => {
    if (assignedTripDayId == null && category !== 'travel' && category !== 'hotel') {
      setValue('start_time', '');
    }
  }, [assignedTripDayId, category, setValue]);

  useEffect(() => {
    if (category === 'travel') {
      const origin = (watchedOriginText ?? '').trim();
      const destination = (watchedDestinationText ?? '').trim();
      if (origin && destination) {
        setTitleIfPristine(`${origin} to ${destination}`);
      }
    }
  }, [category, isCreate, watchedDestinationText, watchedOriginText]);

  useEffect(() => {
    if (!open || !activity) return;
    setPrimaryCandidate(selectedPlaceCandidate ?? hotelDetailsCandidate);
  }, [activity, hotelDetailsCandidate, open, selectedPlaceCandidate]);

  useEffect(() => {
    if (!open || activity || !selectedPlace) return;
    setPrimaryCandidate((current) => current ?? selectedPlaceCandidate);
  }, [activity, open, selectedPlace, selectedPlaceCandidate]);

  const persistPlaceCandidate = async (candidate: PlaceCandidate | null) => {
    if (!candidate) return null;
    if (candidate.saved_place_id) {
      return candidate.saved_place_id;
    }
    if (
      (candidate.source === 'manual_route' || candidate.source === 'manual_stay') &&
      !candidate.external_id &&
      candidate.lat == null &&
      candidate.lon == null
    ) {
      return null;
    }

    const payload: PlaceCreateInput = {
      source: candidate.source,
      external_id: candidate.external_id ?? null,
      name: candidate.name,
      category: candidate.category,
      address_text: candidate.address_text,
      lat: candidate.lat,
      lon: candidate.lon,
      metadata: candidate.metadata,
    };

    const created = await createPlaceMutation.mutateAsync({
      data: payload,
      idempotencyKey: crypto.randomUUID(),
    });

    return created.id;
  };

  const applyCandidateAutofill = (candidate: PlaceCandidate) => {
    setTitleIfPristine(candidate.name);
    if (candidate.description && !getValues('description')) {
      setValue('description', candidate.description);
    }
  };

  const onPrimaryCandidateSelect = (candidate: PlaceCandidate) => {
    setPrimaryCandidate(candidate);
    setPrimaryQuery(candidate.address_text ?? candidate.name);
    if (category === 'hotel') {
      setValue('hotel_name', candidate.name);
      setValue('address_text', candidate.address_text ?? '');
      setTitleIfPristine(candidate.name);
    } else {
      applyCandidateAutofill(candidate);
    }
    setStep(2);
  };

  const handleOriginCandidateSelect = (candidate: PlaceCandidate) => {
    setOriginCandidate(candidate);
    setOriginQuery(candidate.address_text ?? candidate.name);
    setValue('origin_text', candidate.address_text ?? candidate.name ?? '');
  };

  const handleDestinationCandidateSelect = (candidate: PlaceCandidate) => {
    setDestinationCandidate(candidate);
    setDestinationQuery(candidate.address_text ?? candidate.name);
    setValue('destination_text', candidate.address_text ?? candidate.name ?? '');
  };

  const primaryGoogleCandidates = useMemo(
    () => (primaryGoogleSearch.data?.items ?? []).map(candidateFromGooglePlace),
    [primaryGoogleSearch.data?.items],
  );
  const originGoogleCandidates = useMemo(
    () => (originGoogleSearch.data?.items ?? []).map(candidateFromGooglePlace),
    [originGoogleSearch.data?.items],
  );
  const destinationGoogleCandidates = useMemo(
    () => (destinationGoogleSearch.data?.items ?? []).map(candidateFromGooglePlace),
    [destinationGoogleSearch.data?.items],
  );
  const primarySearchResults = primaryGoogleCandidates;
  const originSearchResults = originGoogleCandidates;
  const destinationSearchResults = destinationGoogleCandidates;
  const resolvedPrimarySearchCandidate =
    primaryCandidate ?? autoResolveCandidate(primarySearchResults, primaryQuery);
  const resolvedOriginCandidate =
    originCandidate ?? autoResolveCandidate(originSearchResults, originQuery);
  const resolvedDestinationCandidate =
    destinationCandidate ?? autoResolveCandidate(destinationSearchResults, destinationQuery);
  const resolvedPrimaryCandidate = resolvedPrimarySearchCandidate ?? selectedPlaceCandidate;
  const finalOriginCandidate = originCandidate ?? resolvedOriginCandidate;
  const finalDestinationCandidate = destinationCandidate ?? resolvedDestinationCandidate;
  const isSearchingPrimary =
    debouncedPrimaryQuery !== normalizePlaceSearchQuery(primaryQuery) ||
    primaryGoogleSearch.isFetching;
  const isSearchingOrigin =
    debouncedOriginQuery !== normalizePlaceSearchQuery(originQuery) ||
    originGoogleSearch.isFetching;
  const isSearchingDestination =
    debouncedDestinationQuery !== normalizePlaceSearchQuery(destinationQuery) ||
    destinationGoogleSearch.isFetching;

  const canProceedFromSearch = Boolean(resolvedPrimaryCandidate);

  const handleNextStep = () => {
    if (step === 0) {
      setStep(1);
      return;
    }
    if (step === 1) {
      if (!canProceedFromSearch) {
        toast.error('Select a real place first.');
        return;
      }
      if (category !== 'travel' && resolvedPrimarySearchCandidate && !primaryCandidate) {
        setPrimaryCandidate(resolvedPrimarySearchCandidate);
        setPrimaryQuery(resolvedPrimarySearchCandidate.name);
      }
      if (
        (category === 'visit' || category === 'eat' || category === 'activity') &&
        resolvedPrimaryCandidate
      ) {
        applyCandidateAutofill(resolvedPrimaryCandidate);
      }
      if (category === 'hotel' && resolvedPrimaryCandidate) {
        if (!(getValues('hotel_name') ?? '').trim()) {
          setValue('hotel_name', resolvedPrimaryCandidate.name);
        }
        if (!(getValues('address_text') ?? '').trim()) {
          setValue('address_text', resolvedPrimaryCandidate.address_text ?? '');
        }
        setTitleIfPristine(resolvedPrimaryCandidate.name);
      }
      setStep(2);
    }
  };

  const handleBack = () => {
    setStep((current) => (current <= minimumStep ? current : ((current - 1) as Step)));
  };

  const handleCategorySelect = (value: ActivityCategory) => {
    setCategory(value);
    setPrimaryCandidate(null);
    setOriginCandidate(null);
    setDestinationCandidate(null);
    setPrimaryQuery('');
    setOriginQuery('');
    setDestinationQuery('');
    titleAutofillLockedRef.current = false;
    isAutofillingTitleRef.current = false;
    lastAutoTitleRef.current = '';
    setValue('title', '');
    setValue('description', '');
    setValue('origin_text', '');
    setValue('destination_text', '');
    setValue('travel_mode', value === 'travel' ? 'flight' : '');
    setValue('hotel_name', '');
    setValue('address_text', '');
    setValue('checkin_date', '');
    setValue('checkout_date', '');
    setValue('room_type', '');
    setStep(1);
  };

  const submitActivity = async (values: ActivityFormValues, attachmentFiles: File[] = []) => {
    clearErrors(['origin_text', 'destination_text', 'checkin_date', 'checkout_date']);

    const normalizedOriginText = (
      finalOriginCandidate?.address_text ??
      finalOriginCandidate?.name ??
      values.origin_text ??
      ''
    ).trim();
    const normalizedDestinationText = (
      finalDestinationCandidate?.address_text ??
      finalDestinationCandidate?.name ??
      values.destination_text ??
      ''
    ).trim();
    const normalizedAddressText = (values.address_text ?? '').trim();
    const normalizedTravelMode = (values.travel_mode ?? '').trim();
    const normalizedCheckinDate = (values.checkin_date ?? '').trim();
    const normalizedCheckoutDate = (values.checkout_date ?? '').trim();
    const normalizedTitle = (values.title ?? '').trim();

    let hasValidationError = false;

    if (category === 'travel') {
      if (!finalOriginCandidate || !normalizedOriginText) {
        setError('origin_text', {
          type: 'manual',
          message: 'Select an origin address',
        });
        hasValidationError = true;
      }
      if (!finalDestinationCandidate || !normalizedDestinationText) {
        setError('destination_text', {
          type: 'manual',
          message: 'Select a destination address',
        });
        hasValidationError = true;
      }
    }

    if (
      normalizedCheckinDate &&
      normalizedCheckoutDate &&
      new Date(normalizedCheckoutDate).getTime() < new Date(normalizedCheckinDate).getTime()
    ) {
      setError('checkout_date', {
        type: 'manual',
        message: 'Checkout must be on or after check-in',
      });
      hasValidationError = true;
    }

    if (hasValidationError) {
      toast.error('Fill the required fields before saving.');
      return;
    }

    try {
      const placeId =
        category === 'travel' ? null : await persistPlaceCandidate(resolvedPrimaryCandidate);
      const originPlaceId = await persistPlaceCandidate(finalOriginCandidate);
      const destinationPlaceId = await persistPlaceCandidate(finalDestinationCandidate);

      const categoryDetails: Record<string, unknown> =
        category === 'travel'
          ? {
              origin_text: normalizedOriginText || null,
              destination_text: normalizedDestinationText || null,
              travel_mode: normalizeTravelMode(normalizedTravelMode),
              origin_geo:
                finalOriginCandidate?.lat != null && finalOriginCandidate.lon != null
                  ? {
                      lat: finalOriginCandidate.lat,
                      lon: finalOriginCandidate.lon,
                    }
                  : null,
              destination_geo:
                finalDestinationCandidate?.lat != null && finalDestinationCandidate.lon != null
                  ? {
                      lat: finalDestinationCandidate.lat,
                      lon: finalDestinationCandidate.lon,
                    }
                  : null,
              origin_place_id: originPlaceId,
              destination_place_id: destinationPlaceId,
            }
          : category === 'hotel'
            ? {
                hotel_name: normalizedTitle || values.title,
                address_text:
                  normalizedAddressText || resolvedPrimaryCandidate?.address_text || null,
                latitude: resolvedPrimaryCandidate?.lat ?? null,
                longitude: resolvedPrimaryCandidate?.lon ?? null,
                place_id: placeId,
                checkin_date: normalizedCheckinDate || null,
                checkout_date: normalizedCheckoutDate || null,
                room_type: null,
              }
            : {
                address_text: resolvedPrimaryCandidate?.address_text ?? null,
                latitude: resolvedPrimaryCandidate?.lat ?? null,
                longitude: resolvedPrimaryCandidate?.lon ?? null,
                search_query: primaryQuery || null,
              };

      await onSave(
        {
          trip_day_id: assignedTripDayId,
          category,
          category_details: categoryDetails,
          title: values.title,
          description: values.description || null,
          start_time:
            category === 'travel' || category === 'hotel'
              ? values.start_time || null
              : assignedTripDayId == null
                ? null
                : values.start_time || null,
          duration_min: category === 'hotel' ? null : (values.duration_min ?? null),
          estimated_cost_amount: values.estimated_cost_amount ?? null,
          estimated_cost_currency: values.estimated_cost_currency || null,
          place_id: placeId,
          notes: values.notes || null,
          is_favorite: activity?.is_favorite ?? false,
          source: activity?.source ?? 'manual',
        },
        attachmentFiles,
      );
    } catch {
      toast.error('Failed to prepare the selected place');
    }
  };

  const activeStepDescription = currentStepDescription(step, category, isCreate, createFlow);
  const CurrentCategoryIcon = CATEGORY_ICON[category] ?? Landmark;
  const createTitle =
    createFlow === 'hotel'
      ? 'Create accommodation'
      : createFlow === 'travel'
        ? 'Create travel'
        : 'Create itinerary activity';
  const submitLabel = activity
    ? 'Save changes'
    : createFlow === 'hotel'
      ? 'Create accommodation'
      : createFlow === 'travel'
        ? 'Create travel'
        : 'Create itinerary activity';
  const selectedLocationTitle =
    category === 'travel'
      ? `${watchedOriginText?.trim() || resolvedOriginCandidate?.name || 'Origin'} to ${watchedDestinationText?.trim() || resolvedDestinationCandidate?.name || 'Destination'}`
      : category === 'hotel'
        ? watchedTitle?.trim() ||
          resolvedPrimaryCandidate?.name ||
          hotelDetailsCandidate?.name ||
          'No stay named yet'
        : (resolvedPrimaryCandidate?.name ?? 'No place selected');
  const selectedLocationDescription =
    category === 'travel'
      ? 'Fill in the route details for this segment.'
      : category === 'hotel'
        ? watchedAddressText?.trim() ||
          (resolvedPrimaryCandidate
            ? formatPlaceCaption(resolvedPrimaryCandidate)
            : hotelDetailsCandidate
              ? formatPlaceCaption(hotelDetailsCandidate)
              : 'Add the stay details and save it when you are ready.')
        : resolvedPrimaryCandidate
          ? formatPlaceCaption(resolvedPrimaryCandidate)
          : 'No place linked yet.';
  return (
    <Sheet open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
      {' '}
      <SheetContent
        side={isMobile ? 'bottom' : 'left'}
        className={
          isMobile
            ? 'flex h-[94dvh] flex-col overflow-hidden rounded-t-[24px] p-0 sm:max-w-none'
            : 'left-14 flex h-full w-[calc(100vw-56px)] max-w-[calc(100vw-56px)] flex-col overflow-hidden p-0 lg:w-[clamp(380px,46vw,500px)] lg:max-w-[clamp(380px,46vw,500px)]'
        }
      >
        {' '}
        <SheetHeader className="gap-2 border-b border-[var(--color-border)] px-5 py-5">
          {' '}
          <div className="flex items-start gap-3">
            {' '}
            <div className="min-w-0 flex-1">
              {' '}
              <div className="flex flex-wrap items-center gap-2">
                {' '}
                {visibleDayLabel ? (
                  <Badge variant="outline" className="tracking-[0.08em]">
                    {' '}
                    {visibleDayLabel}{' '}
                  </Badge>
                ) : null}{' '}
                {step > minimumStep ? (
                  <Badge
                    variant="outline"
                    className="inline-flex items-center gap-1.5 tracking-[0.08em]"
                  >
                    {' '}
                    <CurrentCategoryIcon className="h-3.5 w-3.5" />{' '}
                    {plannerCategoryLabel(category)}{' '}
                  </Badge>
                ) : null}{' '}
              </div>{' '}
              <SheetTitle className="mt-2 text-[1.32rem] font-semibold tracking-[-0.04em]">
                {' '}
                {activity ? `Edit ${plannerCategoryLabel(category)} activity` : createTitle}{' '}
              </SheetTitle>{' '}
              <SheetDescription className="mt-1 max-w-[31rem] text-sm leading-5">
                {' '}
                {activeStepDescription}{' '}
              </SheetDescription>{' '}
            </div>{' '}
          </div>{' '}
        </SheetHeader>{' '}
        <form
          onSubmit={handleSubmit((values) => submitActivity(values, pendingAttachmentFiles))}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {' '}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#F3F5F7] px-4 py-4">
            {' '}
            <div className="mx-auto flex w-full max-w-[32rem] flex-col gap-4">
              {' '}
              {step === 0 && isCreate && createFlow === 'itinerary' ? (
                <section className="flex flex-col gap-3">
                  {' '}
                  {allowedCreateCategories.map((value) => {
                    const meta = PLANNER_CATEGORY_META[value];
                    const Icon = CATEGORY_ICON[value];
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => handleCategorySelect(value)}
                        aria-pressed={category === value}
                        className={cn(
                          'group cursor-pointer rounded-[24px] px-5 py-5 text-left transition-all duration-300',
                          category === value
                            ? 'bg-[var(--color-primary)] text-white'
                            : 'bg-[rgba(240,240,240,0.8)] text-[var(--color-text)] hover:bg-[rgba(230,230,230,0.9)]',
                        )}
                      >
                        {' '}
                        <div className="flex items-center gap-4">
                          {' '}
                          <div className={cn(
                            "flex size-12 items-center justify-center rounded-[16px] transition-colors duration-300",
                            category === value ? "bg-white/20" : "bg-white"
                          )}>
                            {' '}
                            <Icon className={cn("h-6 w-6", category === value ? "text-white" : "text-[var(--color-text)]")} />{' '}
                          </div>{' '}
                          <div className="min-w-0 flex-1">
                            {' '}
                            <div className="flex items-center justify-between gap-3">
                              {' '}
                              <p className="text-base font-bold tracking-tight">
                                {' '}
                                {meta.label}{' '}
                              </p>{' '}
                              {category === value ? (
                                <Check className="h-5 w-5 text-white" />
                              ) : null}{' '}
                            </div>{' '}
                            <p className={cn(
                              "mt-1 text-sm leading-snug",
                              category === value ? "text-white/70" : "text-[var(--color-text-muted)]"
                            )}>
                              {' '}
                              {meta.description}{' '}
                            </p>{' '}
                          </div>{' '}
                        </div>{' '}
                      </button>
                    );
                  })}{' '}
                </section>
              ) : null}{' '}
              {step === 1 && createFlow === 'itinerary' ? (
                <section className="rounded-[18px] bg-white p-4">
                  {' '}
                  <div className="flex items-start justify-between gap-4">
                    {' '}
                    <p className="text-[0.72rem] font-medium tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                      {' '}
                      Place{' '}
                    </p>{' '}
                  </div>{' '}
                  <div className="mt-3">
                    {' '}
                    <PlaceSelector
                      inputId="activity-place-search"
                      query={primaryQuery}
                      selectedCandidate={resolvedPrimaryCandidate}
                      onQueryChange={(value) => {
                        setPrimaryQuery(value);
                        if (!candidateMatchesQuery(primaryCandidate, value)) {
                          setPrimaryCandidate(null);
                        }
                      }}
                      onSelect={onPrimaryCandidateSelect}
                      autoFocus
                      searchPlaceholder={`Search Google ${plannerCategoryLabel(category).toLowerCase()} places`}
                      helperText="Type at least 3 characters to search Google places by name or address."
                      results={primarySearchResults}
                      isSearching={isSearchingPrimary}
                    />
                  </div>
                </section>
              ) : null}
              {step === 2 ? (
                <div className="grid gap-3">
                  <section className="rounded-[18px] bg-white p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[0.72rem] font-medium tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                          {category === 'travel'
                            ? 'Travel'
                            : category === 'hotel'
                              ? 'Accommodation'
                              : 'Linked place'}
                        </p>
                        <p className="mt-2 text-base font-semibold text-[var(--color-text)]">
                          {selectedLocationTitle}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-[var(--color-text-muted)]">
                          {selectedLocationDescription}
                        </p>
                      </div>
                      <Badge variant="outline" className="tracking-[0.08em]">
                        {plannerCategoryLabel(category)}
                      </Badge>
                    </div>
                    {visibleDayLabel ? (
                      <p className="mt-3 text-sm text-[var(--color-text-muted)]">
                        {visibleDayLabel}
                      </p>
                    ) : null}
                  </section>

                  {category === 'travel' ? (
                    <section className="rounded-[18px] bg-white p-4">
                      <p className="text-[0.72rem] font-medium tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                        Travel details
                      </p>
                      <FieldGroup className="mt-3 gap-3">
                        <Field>
                          <FieldLabel htmlFor="travel-mode">Travel mode</FieldLabel>
                          <FieldContent>
                            <Controller
                              name="travel_mode"
                              control={control}
                              render={({ field }) => (
                                <Select
                                  value={normalizeTravelMode(field.value)}
                                  onValueChange={(value) =>
                                    field.onChange(normalizeTravelMode(value))
                                  }
                                >
                                  <SelectTrigger
                                    id="travel-mode"
                                    className="h-11 rounded-[12px] border-[var(--color-border)]"
                                  >
                                    <SelectValue placeholder="Select travel mode" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectGroup>
                                      {PLANNER_TRAVEL_MODE_OPTIONS.map((option) => {
                                        const Icon = TRAVEL_MODE_ICON[option.value];
                                        return (
                                          <SelectItem key={option.value} value={option.value}>
                                            <span className="inline-flex items-center gap-2">
                                              <Icon className="h-4 w-4" />
                                              <span>{option.label}</span>
                                            </span>
                                          </SelectItem>
                                        );
                                      })}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                              )}
                            />
                          </FieldContent>
                        </Field>

                        <Field data-invalid={Boolean(errors.origin_text)}>
                          <FieldLabel htmlFor="travel-origin-search">Origin address</FieldLabel>
                          <FieldContent>
                            <PlaceSelector
                              inputId="travel-origin-search"
                              query={originQuery}
                              selectedCandidate={finalOriginCandidate}
                              onQueryChange={(value) => {
                                setOriginQuery(value);
                                setValue('origin_text', value);
                                if (!candidateMatchesQuery(originCandidate, value)) {
                                  setOriginCandidate(null);
                                }
                              }}
                              onSelect={handleOriginCandidateSelect}
                              autoFocus
                              searchPlaceholder="Search departure address"
                              helperText="Search for a real departure address or station."
                              results={originSearchResults}
                              isSearching={isSearchingOrigin}
                            />
                          </FieldContent>
                          {errors.origin_text ? <FieldError errors={[errors.origin_text]} /> : null}
                        </Field>

                        <Field data-invalid={Boolean(errors.destination_text)}>
                          <FieldLabel htmlFor="travel-destination-search">
                            Destination address
                          </FieldLabel>
                          <FieldContent>
                            <PlaceSelector
                              inputId="travel-destination-search"
                              query={destinationQuery}
                              selectedCandidate={finalDestinationCandidate}
                              onQueryChange={(value) => {
                                setDestinationQuery(value);
                                setValue('destination_text', value);
                                if (!candidateMatchesQuery(destinationCandidate, value)) {
                                  setDestinationCandidate(null);
                                }
                              }}
                              onSelect={handleDestinationCandidateSelect}
                              searchPlaceholder="Search arrival address"
                              helperText="Search for a real arrival address or station."
                              results={destinationSearchResults}
                              isSearching={isSearchingDestination}
                            />
                          </FieldContent>
                          {errors.destination_text ? (
                            <FieldError errors={[errors.destination_text]} />
                          ) : null}
                        </Field>

                        <Controller
                          name="start_time"
                          control={control}
                          render={({ field, fieldState }) => (
                            <Field data-invalid={Boolean(fieldState.error)}>
                              <FieldLabel htmlFor="travel-start-time">Start time</FieldLabel>
                              <FieldContent>
                                <div id="travel-start-time">
                                  <TravelTimeWheelPicker
                                    value={field.value || '09:00'}
                                    onChange={field.onChange}
                                  />
                                </div>
                              </FieldContent>
                              {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
                            </Field>
                          )}
                        />
                      </FieldGroup>
                    </section>
                  ) : null}

                  {category === 'hotel' ? (
                    <section className="rounded-[18px] bg-white p-4">
                      <p className="text-[0.72rem] font-medium tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                        Accommodation details
                      </p>
                      <FieldGroup className="mt-3 gap-3">
                        <Field>
                          <FieldLabel htmlFor="hotel-address">Address</FieldLabel>
                          <FieldContent>
                            <PlaceSelector
                              inputId="hotel-address"
                              query={primaryQuery}
                              selectedCandidate={resolvedPrimaryCandidate}
                              onQueryChange={(value) => {
                                setPrimaryQuery(value);
                                setValue('address_text', value);
                                if (!candidateMatchesQuery(primaryCandidate, value)) {
                                  setPrimaryCandidate(null);
                                }
                              }}
                              onSelect={onPrimaryCandidateSelect}
                              searchPlaceholder="Search hotel or stay address"
                              helperText="Search for a real hotel, apartment, or accommodation address."
                              results={primarySearchResults}
                              isSearching={isSearchingPrimary}
                            />
                          </FieldContent>
                        </Field>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <Controller
                            name="checkin_date"
                            control={control}
                            render={({ field, fieldState }) => (
                              <Field data-invalid={Boolean(fieldState.error)}>
                                <FieldLabel htmlFor="hotel-checkin">Check-in date</FieldLabel>
                                <FieldContent>
                                  <DatePicker
                                    id="hotel-checkin"
                                    value={field.value ?? ''}
                                    onChange={field.onChange}
                                    invalid={Boolean(fieldState.error)}
                                    placeholder="Choose check-in date"
                                    className="h-11 rounded-[12px] border-[var(--color-border)] bg-white"
                                  />
                                </FieldContent>
                                {fieldState.error ? (
                                  <FieldError errors={[fieldState.error]} />
                                ) : null}
                              </Field>
                            )}
                          />

                          <Controller
                            name="checkout_date"
                            control={control}
                            render={({ field, fieldState }) => (
                              <Field data-invalid={Boolean(fieldState.error)}>
                                <FieldLabel htmlFor="hotel-checkout">Checkout date</FieldLabel>
                                <FieldContent>
                                  <DatePicker
                                    id="hotel-checkout"
                                    value={field.value ?? ''}
                                    onChange={field.onChange}
                                    invalid={Boolean(fieldState.error)}
                                    placeholder="Choose checkout date"
                                    className="h-11 rounded-[12px] border-[var(--color-border)] bg-white"
                                  />
                                </FieldContent>
                                {fieldState.error ? (
                                  <FieldError errors={[fieldState.error]} />
                                ) : null}
                              </Field>
                            )}
                          />
                        </div>

                        <Controller
                          name="start_time"
                          control={control}
                          render={({ field, fieldState }) => (
                            <Field data-invalid={Boolean(fieldState.error)}>
                              <FieldLabel htmlFor="hotel-start-time">Check-in time</FieldLabel>
                              <FieldContent>
                                <div id="hotel-start-time">
                                  <TravelTimeWheelPicker
                                    value={field.value || '15:00'}
                                    onChange={field.onChange}
                                    inputAriaLabel="Type check-in time"
                                  />
                                </div>
                              </FieldContent>
                              {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
                            </Field>
                          )}
                        />
                      </FieldGroup>
                    </section>
                  ) : null}

                  <section className="rounded-[18px] bg-white p-4">
                    <p className="text-[0.72rem] font-medium tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                      Activity details
                    </p>
                    <FieldGroup className="mt-3 gap-3">
                      {category !== 'travel' && category !== 'hotel' ? (
                        <Field>
                          <FieldLabel htmlFor="activity-day">Assigned day</FieldLabel>
                          <FieldContent>
                            <Combobox
                              id="activity-day"
                              value={selectedAssignmentValue}
                              onValueChange={(value) =>
                                setAssignedTripDayId(value === INBOX_DAY_VALUE ? null : value)
                              }
                              options={assignmentOptions}
                              placeholder="Select day"
                              searchPlaceholder="Search day"
                              emptyText="No days found"
                              triggerClassName="border-[var(--color-border)]"
                            />
                          </FieldContent>
                        </Field>
                      ) : null}

                      <Field data-invalid={Boolean(errors.title)}>
                        <FieldLabel htmlFor="activity-title">Title</FieldLabel>
                        <FieldContent>
                          <Input
                            id="activity-title"
                            placeholder="Name this activity"
                            aria-invalid={Boolean(errors.title)}
                            className="h-11 rounded-[12px] border-[var(--color-border)] bg-white"
                            {...titleField}
                          />
                        </FieldContent>
                        {errors.title ? <FieldError errors={[errors.title]} /> : null}
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="activity-description">Description</FieldLabel>
                        <FieldContent>
                          <Textarea
                            id="activity-description"
                            rows={5}
                            placeholder="What should this activity include?"
                            className="rounded-[12px] border-[var(--color-border)] bg-white"
                            {...register('description')}
                          />
                        </FieldContent>
                      </Field>

                      <div className="grid gap-3 sm:grid-row-2">
                        {category !== 'travel' && category !== 'hotel' ? (
                          <Controller
                            name="start_time"
                            control={control}
                            render={({ field, fieldState }) => (
                              <Field data-invalid={Boolean(fieldState.error)}>
                                <FieldLabel htmlFor="activity-start-time">Start time</FieldLabel>
                                <FieldContent>
                                  <div id="activity-start-time">
                                    <TravelTimeWheelPicker
                                      value={field.value || '09:00'}
                                      onChange={field.onChange}
                                      inputAriaLabel="Type start time"
                                    />
                                  </div>
                                </FieldContent>
                                {fieldState.error ? (
                                  <FieldError errors={[fieldState.error]} />
                                ) : null}
                              </Field>
                            )}
                          />
                        ) : null}
                        {category !== 'hotel' ? (
                          <Field data-invalid={Boolean(errors.duration_min)}>
                            <FieldLabel htmlFor="activity-duration">Duration (min)</FieldLabel>
                            <FieldContent>
                              <Controller
                                name="duration_min"
                                control={control}
                                render={({ field }) => (
                                  <Input
                                    id="activity-duration"
                                    type="number"
                                    min={0}
                                    max={1000000}
                                    className="h-11 rounded-[12px] border-[var(--color-border)] bg-white"
                                    value={field.value ?? ''}
                                    onChange={(event) =>
                                      field.onChange(
                                        event.target.value
                                          ? Number(event.target.value)
                                          : Number.NaN,
                                      )
                                    }
                                  />
                                )}
                              />
                            </FieldContent>
                            {errors.duration_min ? (
                              <FieldError errors={[errors.duration_min]} />
                            ) : null}
                          </Field>
                        ) : null}
                      </div>

                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9.5rem]">
                        <Field data-invalid={Boolean(errors.estimated_cost_amount)}>
                          <FieldLabel htmlFor="activity-cost">Estimated cost</FieldLabel>
                          <FieldContent>
                            <Controller
                              name="estimated_cost_amount"
                              control={control}
                              render={({ field }) => (
                                <Input
                                  id="activity-cost"
                                  type="number"
                                  min={0}
                                  max={1000000000}
                                  step="0.01"
                                  className="h-11 rounded-[12px] border-[var(--color-border)] bg-white"
                                  value={field.value ?? ''}
                                  onChange={(event) =>
                                    field.onChange(
                                      event.target.value ? Number(event.target.value) : Number.NaN,
                                    )
                                  }
                                />
                              )}
                            />
                          </FieldContent>
                          {errors.estimated_cost_amount ? (
                            <FieldError errors={[errors.estimated_cost_amount]} />
                          ) : null}
                        </Field>

                        <Controller
                          name="estimated_cost_currency"
                          control={control}
                          render={({ field, fieldState }) => (
                            <Field data-invalid={Boolean(fieldState.error)}>
                              <FieldLabel htmlFor="activity-currency">Currency</FieldLabel>
                              <FieldContent>
                                <Combobox
                                  id="activity-currency"
                                  value={field.value ?? 'EUR'}
                                  onValueChange={field.onChange}
                                  options={CURRENCY_OPTIONS}
                                  placeholder="Select currency"
                                  searchPlaceholder="Search currency"
                                  emptyText="No currencies found"
                                  invalid={Boolean(fieldState.error)}
                                  triggerClassName="border-[var(--color-border)]"
                                />
                              </FieldContent>
                              {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
                            </Field>
                          )}
                        />
                      </div>

                      <Field>
                        <FieldLabel htmlFor="activity-notes">Notes</FieldLabel>
                        <FieldContent>
                          <Textarea
                            id="activity-notes"
                            rows={4}
                            placeholder="Operational notes, booking reminders, logistics..."
                            className="rounded-[12px] border-[var(--color-border)] bg-white"
                            {...register('notes')}
                          />
                        </FieldContent>
                      </Field>
                    </FieldGroup>
                  </section>

                  {isCreate ? (
                    <PendingActivityAttachments
                      files={pendingAttachmentFiles}
                      onAddFiles={(nextFiles) =>
                        setPendingAttachmentFiles((currentFiles) =>
                          mergePendingAttachments(currentFiles, nextFiles),
                        )
                      }
                      onRemoveFile={(fileKey) =>
                        setPendingAttachmentFiles((currentFiles) =>
                          currentFiles.filter((file) => pendingAttachmentKey(file) !== fileKey),
                        )
                      }
                    />
                  ) : activity ? (
                    <TripAssetManager
                      tripId={tripId}
                      activityId={activity.id}
                      title="Attachments"
                      description="Add receipts, reservation PDFs, screenshots, and extra photos that belong to this activity."
                      className=""
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          <SheetFooter className="border-t border-[var(--color-border)] px-4 py-3">
            <div className="flex w-full items-center justify-end gap-2">
              {step === minimumStep ? (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-[12px]"
                  onClick={onClose}
                >
                  Cancel
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-[12px]"
                  onClick={handleBack}
                >
                  Back
                </Button>
              )}

              {step > 0 ? (
                step < 2 ? (
                  <Button
                    key="continue-step"
                    type="button"
                    className="rounded-[12px]"
                    onClick={(event) => {
                      event.preventDefault();
                      handleNextStep();
                    }}
                  >
                    Continue to activity details
                  </Button>
                ) : (
                  <Button
                    key="submit-step"
                    type="submit"
                    className="rounded-[12px]"
                    disabled={isSaving || createPlaceMutation.isPending}
                  >
                    {isSaving || createPlaceMutation.isPending ? (
                      <VoyagerLoader className="h-4 w-4" />
                    ) : null}
                    {submitLabel}
                  </Button>
                )
              ) : null}
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
