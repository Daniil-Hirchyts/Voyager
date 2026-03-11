import { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import {
  BedDouble,
  Check,
  ChevronLeft,
  Landmark,
  Loader2,
  MapPin,
  Plane,
  Search,
  Ticket,
  Utensils,
} from "lucide-react";
import { toast } from "sonner";
import {
  useCreatePlace,
  useGooglePlaceSearch,
  usePlace,
} from "@/entities/place/queries";
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { TimePicker } from "@/components/ui/time-picker";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import { cn } from "@/shared/lib/cn";
import { CURRENCY_OPTIONS } from "@/shared/lib/currencies";
import type {
  Activity,
  ActivityCategory,
  ActivityCreateInput,
  Place,
  PlaceCreateInput,
  GooglePlaceCandidate,
  PlannerActivity,
} from "@/shared/api/types";
import { PLANNER_CATEGORY_META, plannerCategoryLabel } from "./categories";

const activitySchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  description: z.string().optional(),
  start_time: z.string().optional(),
  duration_min: z
    .union([z.number().int().positive(), z.nan()])
    .optional()
    .transform((value) =>
      value == null || Number.isNaN(value) ? undefined : value,
    ),
  estimated_cost_amount: z
    .union([z.number().nonnegative(), z.nan()])
    .optional()
    .transform((value) =>
      value == null || Number.isNaN(value) ? undefined : value,
    ),
  estimated_cost_currency: z.string().optional(),
  notes: z.string().optional(),
  origin_text: z.string().optional(),
  destination_text: z.string().optional(),
  travel_mode: z.string().optional(),
  hotel_name: z.string().optional(),
  address_text: z.string().optional(),
  checkin_date: z.string().optional(),
  checkout_date: z.string().optional(),
  room_type: z.string().optional(),
});

type ActivityFormValues = z.infer<typeof activitySchema>;
type Step = 0 | 1 | 2;
const INBOX_DAY_VALUE = "__inbox__";

type PlaceCandidate = {
  source: string;
  external_id?: string | null;
  saved_place_id?: string | null;
  name: string;
  category: string | null;
  address_text: string | null;
  lat: number | null;
  lon: number | null;
  metadata: Record<string, unknown>;
  description?: string | null;
};

interface Props {
  open: boolean;
  activity?: Activity | PlannerActivity | null;
  defaultTripDayId?: string | null;
  defaultDayLabel?: string | null;
  dayOptions?: ComboboxOption[];
  onClose: () => void;
  onSave: (data: ActivityCreateInput) => Promise<void>;
  isSaving?: boolean;
}

const CATEGORY_ICON: Record<ActivityCategory, typeof Landmark> = {
  visit: Landmark,
  eat: Utensils,
  activity: Ticket,
  hotel: BedDouble,
  travel: Plane,
};

function currentStepDescription(
  step: Step,
  category: ActivityCategory,
  isCreate: boolean,
) {
  if (!isCreate) {
    return "Edit the activity details and any manual hotel or travel fields.";
  }
  if (step === 0) {
    return "Pick the type of activity you want to add.";
  }
  if (step === 1) {
    if (category === "travel") {
      return "Optionally search route endpoints, then confirm the route details manually.";
    }
    if (category === "hotel") {
      return "Optionally search a hotel or address, then confirm the stay details manually.";
    }
    return "Search and link a place.";
  }
  return "Review the details and save the activity.";
}

function detailsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function activityToForm(
  activity: Activity | PlannerActivity,
): ActivityFormValues {
  const details = detailsRecord(activity.category_details);
  return {
    title: activity.title,
    description: activity.description ?? undefined,
    start_time: activity.start_time ?? undefined,
    duration_min: activity.duration_min ?? undefined,
    estimated_cost_amount:
      activity.estimated_cost_amount != null
        ? Number(activity.estimated_cost_amount)
        : undefined,
    estimated_cost_currency: activity.estimated_cost_currency ?? "EUR",
    notes: activity.notes ?? undefined,
    origin_text:
      typeof details.origin_text === "string"
        ? details.origin_text
        : undefined,
    destination_text:
      typeof details.destination_text === "string"
        ? details.destination_text
        : undefined,
    travel_mode:
      typeof details.travel_mode === "string"
        ? details.travel_mode
        : undefined,
    hotel_name:
      typeof details.hotel_name === "string" ? details.hotel_name : undefined,
    address_text:
      typeof details.address_text === "string"
        ? details.address_text
        : undefined,
    checkin_date:
      typeof details.checkin_date === "string"
        ? details.checkin_date
        : undefined,
    checkout_date:
      typeof details.checkout_date === "string"
        ? details.checkout_date
        : undefined,
    room_type:
      typeof details.room_type === "string" ? details.room_type : undefined,
  };
}

function emptyActivityForm(): ActivityFormValues {
  return {
    title: "",
    description: "",
    start_time: "",
    duration_min: undefined,
    estimated_cost_amount: undefined,
    estimated_cost_currency: "EUR",
    notes: "",
    origin_text: "",
    destination_text: "",
    travel_mode: "",
    hotel_name: "",
    address_text: "",
    checkin_date: "",
    checkout_date: "",
    room_type: "",
  };
}

function plannerActivityCandidate(
  place: Place | null | undefined,
): PlaceCandidate | null {
  if (!place) return null;
  return {
    source: place.source,
    external_id: place.external_id,
    saved_place_id: place.id,
    name: place.name,
    category: place.category,
    address_text: place.address_text,
    lat: place.lat,
    lon: place.lon,
    metadata: place.metadata ?? {},
  };
}

function candidateFromTravelDetails(
  details: Record<string, unknown>,
  prefix: "origin" | "destination",
): PlaceCandidate | null {
  const text =
    typeof details[`${prefix}_text`] === "string"
      ? String(details[`${prefix}_text`])
      : null;
  const geo =
    details[`${prefix}_geo`] && typeof details[`${prefix}_geo`] === "object"
      ? (details[`${prefix}_geo`] as Record<string, unknown>)
      : {};
  const lat = Number(geo.lat);
  const lon = Number(geo.lon);

  if (!text && (!Number.isFinite(lat) || !Number.isFinite(lon))) {
    return null;
  }

  return {
    source: "manual_route",
    saved_place_id:
      typeof details[`${prefix}_place_id`] === "string"
        ? String(details[`${prefix}_place_id`])
        : null,
    name: text ?? (prefix === "origin" ? "Origin" : "Destination"),
    category: prefix,
    address_text: text,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    metadata: {},
  };
}

function candidateFromGooglePlace(place: GooglePlaceCandidate): PlaceCandidate {
  return {
    source: "google_places",
    external_id: place.place_id,
    name: place.name,
    category: place.category,
    address_text: place.address_text,
    lat: place.lat,
    lon: place.lon,
    metadata: place.metadata ?? {},
  };
}

function formatPlaceCaption(candidate: PlaceCandidate | null) {
  if (!candidate) return "No place selected yet";
  return candidate.address_text || candidate.category || candidate.name;
}

function normalizePlaceSearchQuery(value: string) {
  return value.replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
}

function candidateIdentity(candidate: PlaceCandidate) {
  const normalizedName = normalizePlaceSearchQuery(
    candidate.name,
  ).toLowerCase();
  const normalizedAddress = normalizePlaceSearchQuery(
    candidate.address_text ?? "",
  ).toLowerCase();

  if (normalizedName && normalizedAddress) {
    return `text:${normalizedName}:${normalizedAddress}`;
  }
  if (candidate.external_id) {
    return `external:${candidate.source}:${candidate.external_id}`;
  }
  if (candidate.saved_place_id) {
    return `saved:${candidate.saved_place_id}`;
  }
  if (candidate.lat != null && candidate.lon != null && normalizedName) {
    return `geo:${normalizedName}:${candidate.lat.toFixed(5)}:${candidate.lon.toFixed(5)}`;
  }
  return `text:${normalizedName}:${normalizedAddress}`;
}

function candidateMatchesQuery(
  candidate: PlaceCandidate | null,
  query: string,
) {
  if (!candidate) return false;
  const normalizedQuery = normalizePlaceSearchQuery(query).toLowerCase();
  if (!normalizedQuery) return true;

  const haystacks = [
    candidate.name,
    candidate.address_text ?? "",
    candidate.category ?? "",
  ]
    .map((value) => normalizePlaceSearchQuery(value).toLowerCase())
    .filter(Boolean);

  return haystacks.some((value) => value.includes(normalizedQuery));
}

function autoResolveCandidate(candidates: PlaceCandidate[], query: string) {
  const normalizedQuery = normalizePlaceSearchQuery(query).toLowerCase();
  if (normalizedQuery.length < 3) {
    return null;
  }

  const exactMatch =
    candidates.find((candidate) =>
      [candidate.name, candidate.address_text ?? ""]
        .map((value) => normalizePlaceSearchQuery(value).toLowerCase())
        .some((value) => value === normalizedQuery),
    ) ?? null;

  return exactMatch ?? candidates[0] ?? null;
}

function PlaceSelector({
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
    <div className="rounded-[16px] border border-black/8 bg-[var(--color-secondary-surface)] p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <Input
          autoFocus={autoFocus}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-11 rounded-[12px] border-black/8 bg-white pl-10 shadow-none"
        />
      </div>

      {showSelectedSummary && selectedCandidate ? (
        <div className="mt-3 flex items-start gap-3 rounded-[12px] border border-black/8 bg-white px-3 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-secondary-surface)]">
            <MapPin className="h-4 w-4 text-[var(--color-text-muted)]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[var(--color-text)]">
              {selectedCandidate.name}
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">
              {formatPlaceCaption(selectedCandidate)}
            </p>
          </div>
          <Check className="mt-0.5 h-4 w-4 text-[var(--color-text)]" />
        </div>
      ) : null}

      <ScrollArea className="mt-3 max-h-72">
        <div className="flex flex-col gap-1 pr-2">
          {!showResults ? (
            <div className="rounded-[12px] px-1 py-2 text-sm text-[var(--color-text-muted)]">
              {helperText}
            </div>
          ) : isSearching ? (
            <div className="flex items-center gap-2 rounded-[12px] px-3 py-3 text-sm text-[var(--color-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching places...
            </div>
          ) : results.length ? (
            results.map((result) => {
              const isSelected =
                selectedCandidate != null &&
                candidateIdentity(selectedCandidate) ===
                  candidateIdentity(result);
              return (
                <button
                  key={candidateIdentity(result)}
                  type="button"
                  onClick={() => onSelect(result)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-[12px] border px-3 py-3 text-left transition-colors",
                    isSelected
                      ? "border-[rgba(26,22,21,0.12)] bg-white"
                      : "border-transparent hover:bg-white",
                  )}
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]">
                    <MapPin className="h-4 w-4 text-[var(--color-text-muted)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--color-text)]">
                      {result.name}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">
                      {formatPlaceCaption(result)}
                    </p>
                  </div>
                  {isSelected ? (
                    <Check className="mt-0.5 h-4 w-4 text-[var(--color-text)]" />
                  ) : null}
                </button>
              );
            })
          ) : (
            <div className="rounded-[12px] px-3 py-3 text-sm text-[var(--color-text-muted)]">
              No places found yet. Try a simpler landmark or venue name.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export function ActivityDrawer({
  open,
  activity,
  defaultTripDayId = null,
  defaultDayLabel = null,
  dayOptions = [],
  onClose,
  onSave,
  isSaving,
}: Props) {
  const isMobile = useIsMobile();
  const isCreate = !activity;
  const existingDetails = useMemo(
    () => detailsRecord(activity?.category_details),
    [activity?.category_details],
  );
  const titleAutofillLockedRef = useRef(false);
  const isAutofillingTitleRef = useRef(false);
  const lastAutoTitleRef = useRef("");
  const [step, setStep] = useState<Step>(isCreate ? 0 : 2);
  const [category, setCategory] = useState<ActivityCategory>(
    activity?.category ?? "visit",
  );
  const [primaryQuery, setPrimaryQuery] = useState("");
  const [primaryCandidate, setPrimaryCandidate] =
    useState<PlaceCandidate | null>(null);
  const [originQuery, setOriginQuery] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [assignedTripDayId, setAssignedTripDayId] = useState<string | null>(
    activity?.trip_day_id ?? defaultTripDayId,
  );
  const [originCandidate, setOriginCandidate] = useState<PlaceCandidate | null>(
    null,
  );
  const [destinationCandidate, setDestinationCandidate] =
    useState<PlaceCandidate | null>(null);
  const debouncedPrimaryQuery = useDebouncedValue(
    normalizePlaceSearchQuery(primaryQuery),
    320,
  );
  const debouncedOriginQuery = useDebouncedValue(
    normalizePlaceSearchQuery(originQuery),
    320,
  );
  const debouncedDestinationQuery = useDebouncedValue(
    normalizePlaceSearchQuery(destinationQuery),
    320,
  );

  const selectedPlaceId = activity?.place_id ?? null;
  const assignmentOptions = useMemo(
    () =>
      dayOptions.length
        ? dayOptions
        : [
            {
              value: INBOX_DAY_VALUE,
              label: "Inbox",
              description: "Unassigned activity",
            },
          ],
    [dayOptions],
  );
  const selectedAssignmentValue = assignedTripDayId ?? INBOX_DAY_VALUE;
  const assignedDayOption =
    assignmentOptions.find(
      (option) => option.value === selectedAssignmentValue,
    ) ?? null;
  const currentDayLabel = assignedDayOption
    ? assignedDayOption.value === INBOX_DAY_VALUE ||
      !assignedDayOption.description
      ? assignedDayOption.label
      : `${assignedDayOption.label} · ${assignedDayOption.description}`
    : (defaultDayLabel ?? "Inbox");
  const { data: selectedPlace } = usePlace(selectedPlaceId);
  const selectedPlaceCandidate = useMemo(
    () => plannerActivityCandidate(selectedPlace),
    [selectedPlace],
  );
  const primaryGoogleSearch = useGooglePlaceSearch(
    { q: debouncedPrimaryQuery, limit: 6, offset: 0 },
    open &&
      step === 1 &&
      category !== "travel" &&
      debouncedPrimaryQuery.length >= 3,
  );
  const originGoogleSearch = useGooglePlaceSearch(
    { q: debouncedOriginQuery, limit: 6, offset: 0 },
    open &&
      step === 1 &&
      category === "travel" &&
      debouncedOriginQuery.length >= 3,
  );
  const destinationGoogleSearch = useGooglePlaceSearch(
    { q: debouncedDestinationQuery, limit: 6, offset: 0 },
    open &&
      step === 1 &&
      category === "travel" &&
      debouncedDestinationQuery.length >= 3,
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
  const watchedHotelName = watch("hotel_name");
  const watchedAddressText = watch("address_text");
  const watchedOriginText = watch("origin_text");
  const watchedDestinationText = watch("destination_text");

  const titleField = register("title", {
    onChange: () => {
      if (!isAutofillingTitleRef.current) {
        titleAutofillLockedRef.current = true;
        lastAutoTitleRef.current = "";
      }
    },
  });

  useEffect(() => {
    if (!open) return;

    reset(activity ? activityToForm(activity) : emptyActivityForm());
    titleAutofillLockedRef.current = Boolean(activity?.title?.trim());
    isAutofillingTitleRef.current = false;
    lastAutoTitleRef.current = activity?.title?.trim() ?? "";
    setPrimaryQuery("");
    setOriginQuery("");
    setDestinationQuery("");
    setAssignedTripDayId(activity?.trip_day_id ?? defaultTripDayId ?? null);

    if (activity) {
      setCategory(activity.category);
      setStep(2);
      setPrimaryCandidate(null);
      setOriginCandidate(candidateFromTravelDetails(existingDetails, "origin"));
      setDestinationCandidate(
        candidateFromTravelDetails(existingDetails, "destination"),
      );
      return;
    }

    setCategory("visit");
    setStep(0);
    setPrimaryCandidate(null);
    setOriginCandidate(null);
    setDestinationCandidate(null);
  }, [activity, existingDetails, open, reset]);

  const setTitleIfPristine = (nextTitle: string) => {
    const normalizedTitle = nextTitle.trim();
    const currentTitle = (getValues("title") ?? "").trim();
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
    setValue("title", normalizedTitle);
    queueMicrotask(() => {
      isAutofillingTitleRef.current = false;
    });
  };

  useEffect(() => {
    if (assignedTripDayId == null) {
      setValue("start_time", "");
    }
  }, [assignedTripDayId, setValue]);

  useEffect(() => {
    if (category === "hotel") {
      setTitleIfPristine(watchedHotelName ?? "");
      return;
    }
    if (category === "travel") {
      const origin = (watchedOriginText ?? "").trim();
      const destination = (watchedDestinationText ?? "").trim();
      if (origin && destination) {
        setTitleIfPristine(`${origin} to ${destination}`);
      }
    }
  }, [
    category,
    isCreate,
    watchedDestinationText,
    watchedHotelName,
    watchedOriginText,
  ]);

  useEffect(() => {
    if (!open || !activity) return;
    setPrimaryCandidate(selectedPlaceCandidate);
  }, [activity, open, selectedPlaceCandidate]);

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
      candidate.source === "manual_route" &&
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
    if (candidate.description && !getValues("description")) {
      setValue("description", candidate.description);
    }
  };

  const onPrimaryCandidateSelect = (candidate: PlaceCandidate) => {
    setPrimaryCandidate(candidate);
    setPrimaryQuery(candidate.name);
    if (category === "hotel") {
      setValue("hotel_name", candidate.name);
      setValue("address_text", candidate.address_text ?? "");
      setTitleIfPristine(candidate.name);
    } else {
      applyCandidateAutofill(candidate);
    }
    setStep(2);
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
    () =>
      (destinationGoogleSearch.data?.items ?? []).map(candidateFromGooglePlace),
    [destinationGoogleSearch.data?.items],
  );
  const primarySearchResults = primaryGoogleCandidates;
  const originSearchResults = originGoogleCandidates;
  const destinationSearchResults = destinationGoogleCandidates;
  const resolvedPrimarySearchCandidate =
    primaryCandidate ??
    autoResolveCandidate(primarySearchResults, primaryQuery);
  const resolvedOriginCandidate =
    originCandidate ?? autoResolveCandidate(originSearchResults, originQuery);
  const resolvedDestinationCandidate =
    destinationCandidate ??
    autoResolveCandidate(destinationSearchResults, destinationQuery);
  const resolvedPrimaryCandidate =
    resolvedPrimarySearchCandidate ?? selectedPlaceCandidate;
  const isSearchingPrimary =
    debouncedPrimaryQuery !== normalizePlaceSearchQuery(primaryQuery) ||
    primaryGoogleSearch.isFetching;
  const isSearchingOrigin =
    debouncedOriginQuery !== normalizePlaceSearchQuery(originQuery) ||
    originGoogleSearch.isFetching;
  const isSearchingDestination =
    debouncedDestinationQuery !== normalizePlaceSearchQuery(destinationQuery) ||
    destinationGoogleSearch.isFetching;

  const canProceedFromSearch =
    category === "travel" || category === "hotel"
      ? true
      : Boolean(resolvedPrimaryCandidate);

  const handleNextStep = () => {
    if (step === 0) {
      setStep(1);
      return;
    }
    if (step === 1) {
      if (!canProceedFromSearch) {
        toast.error(
          "Select a real place first.",
        );
        return;
      }
      if (
        category !== "travel" &&
        resolvedPrimarySearchCandidate &&
        !primaryCandidate
      ) {
        setPrimaryCandidate(resolvedPrimarySearchCandidate);
        setPrimaryQuery(resolvedPrimarySearchCandidate.name);
      }
      if (category === "travel") {
        if (resolvedOriginCandidate && !originCandidate) {
          setOriginCandidate(resolvedOriginCandidate);
          setOriginQuery(resolvedOriginCandidate.name);
          if (!(getValues("origin_text") ?? "").trim()) {
            setValue(
              "origin_text",
              resolvedOriginCandidate.name ??
                resolvedOriginCandidate.address_text ??
                "",
            );
          }
        }
        if (resolvedDestinationCandidate && !destinationCandidate) {
          setDestinationCandidate(resolvedDestinationCandidate);
          setDestinationQuery(resolvedDestinationCandidate.name);
          if (!(getValues("destination_text") ?? "").trim()) {
            setValue(
              "destination_text",
              resolvedDestinationCandidate.name ??
                resolvedDestinationCandidate.address_text ??
                "",
            );
          }
        }
      }
      if (
        (category === "visit" ||
          category === "eat" ||
          category === "activity") &&
        resolvedPrimaryCandidate
      ) {
        applyCandidateAutofill(resolvedPrimaryCandidate);
      }
      if (category === "hotel" && resolvedPrimaryCandidate) {
        if (!(getValues("hotel_name") ?? "").trim()) {
          setValue("hotel_name", resolvedPrimaryCandidate.name);
        }
        if (!(getValues("address_text") ?? "").trim()) {
          setValue(
            "address_text",
            resolvedPrimaryCandidate.address_text ?? "",
          );
        }
        setTitleIfPristine(resolvedPrimaryCandidate.name);
      }
      setStep(2);
    }
  };

  const handleBack = () => {
    setStep((current) => (current === 0 ? 0 : ((current - 1) as Step)));
  };

  const handleCategorySelect = (value: ActivityCategory) => {
    setCategory(value);
    setPrimaryCandidate(null);
    setOriginCandidate(null);
    setDestinationCandidate(null);
    setPrimaryQuery("");
    setOriginQuery("");
    setDestinationQuery("");
    titleAutofillLockedRef.current = false;
    isAutofillingTitleRef.current = false;
    lastAutoTitleRef.current = "";
    setValue("title", "");
    setValue("description", "");
    setValue("origin_text", "");
    setValue("destination_text", "");
    setValue("travel_mode", "");
    setValue("hotel_name", "");
    setValue("address_text", "");
    setValue("checkin_date", "");
    setValue("checkout_date", "");
    setValue("room_type", "");
    setStep(1);
  };

  const submitActivity = async (values: ActivityFormValues) => {
    clearErrors([
      "origin_text",
      "destination_text",
      "hotel_name",
      "checkin_date",
      "checkout_date",
    ]);

    const normalizedOriginText = (values.origin_text ?? "").trim();
    const normalizedDestinationText = (values.destination_text ?? "").trim();
    const normalizedHotelName = (values.hotel_name ?? "").trim();
    const normalizedAddressText = (values.address_text ?? "").trim();
    const normalizedTravelMode = (values.travel_mode ?? "").trim();
    const normalizedCheckinDate = (values.checkin_date ?? "").trim();
    const normalizedCheckoutDate = (values.checkout_date ?? "").trim();
    const normalizedRoomType = (values.room_type ?? "").trim();

    let hasValidationError = false;

    if (category === "travel") {
      if (!normalizedOriginText) {
        setError("origin_text", {
          type: "manual",
          message: "Origin is required",
        });
        hasValidationError = true;
      }
      if (!normalizedDestinationText) {
        setError("destination_text", {
          type: "manual",
          message: "Destination is required",
        });
        hasValidationError = true;
      }
    }

    if (category === "hotel" && !normalizedHotelName) {
      setError("hotel_name", {
        type: "manual",
        message: "Hotel name is required",
      });
      hasValidationError = true;
    }

    if (
      normalizedCheckinDate &&
      normalizedCheckoutDate &&
      new Date(normalizedCheckoutDate).getTime() <
        new Date(normalizedCheckinDate).getTime()
    ) {
      setError("checkout_date", {
        type: "manual",
        message: "Checkout must be on or after check-in",
      });
      hasValidationError = true;
    }

    if (hasValidationError) {
      toast.error("Fill the required fields before saving.");
      return;
    }

    try {
      const placeId =
        category === "travel"
          ? null
          : await persistPlaceCandidate(resolvedPrimaryCandidate);
      const originPlaceId = await persistPlaceCandidate(
        resolvedOriginCandidate,
      );
      const destinationPlaceId = await persistPlaceCandidate(
        resolvedDestinationCandidate,
      );

      const categoryDetails: Record<string, unknown> =
        category === "travel"
          ? {
              origin_text: normalizedOriginText || null,
              destination_text: normalizedDestinationText || null,
              travel_mode: normalizedTravelMode || null,
              origin_geo:
                resolvedOriginCandidate?.lat != null &&
                resolvedOriginCandidate.lon != null
                  ? {
                      lat: resolvedOriginCandidate.lat,
                      lon: resolvedOriginCandidate.lon,
                    }
                  : null,
              destination_geo:
                resolvedDestinationCandidate?.lat != null &&
                resolvedDestinationCandidate.lon != null
                  ? {
                      lat: resolvedDestinationCandidate.lat,
                      lon: resolvedDestinationCandidate.lon,
                    }
                  : null,
              origin_place_id: originPlaceId,
              destination_place_id: destinationPlaceId,
            }
          : category === "hotel"
            ? {
                hotel_name: normalizedHotelName || values.title,
                address_text:
                  normalizedAddressText ||
                  resolvedPrimaryCandidate?.address_text ||
                  null,
                latitude: resolvedPrimaryCandidate?.lat ?? null,
                longitude: resolvedPrimaryCandidate?.lon ?? null,
                place_id: placeId,
                checkin_date: normalizedCheckinDate || null,
                checkout_date: normalizedCheckoutDate || null,
                room_type: normalizedRoomType || null,
              }
            : {
                address_text: resolvedPrimaryCandidate?.address_text ?? null,
                latitude: resolvedPrimaryCandidate?.lat ?? null,
                longitude: resolvedPrimaryCandidate?.lon ?? null,
                search_query: primaryQuery || null,
              };

      await onSave({
        trip_day_id: assignedTripDayId,
        category,
        category_details: categoryDetails,
        title: values.title,
        description: values.description || null,
        start_time:
          assignedTripDayId == null ? null : values.start_time || null,
        duration_min: values.duration_min ?? null,
        estimated_cost_amount: values.estimated_cost_amount ?? null,
        estimated_cost_currency: values.estimated_cost_currency || null,
        place_id: placeId,
        notes: values.notes || null,
        is_favorite: activity?.is_favorite ?? false,
        source: activity?.source ?? "manual",
      });
    } catch {
      toast.error("Failed to prepare the selected place");
    }
  };

  const activeStepDescription = currentStepDescription(
    step,
    category,
    isCreate,
  );
  const CurrentCategoryIcon = CATEGORY_ICON[category] ?? Landmark;
  const selectedLocationTitle =
    category === "travel"
      ? `${watchedOriginText?.trim() || resolvedOriginCandidate?.name || "Origin"} to ${watchedDestinationText?.trim() || resolvedDestinationCandidate?.name || "Destination"}`
      : category === "hotel"
        ? (watchedHotelName?.trim() || resolvedPrimaryCandidate?.name || "No stay named yet")
        : (resolvedPrimaryCandidate?.name ?? "No place selected");
  const selectedLocationDescription =
    category === "travel"
      ? "Coordinates are stored when a searched place helper is selected."
      : category === "hotel"
        ? (watchedAddressText?.trim() ||
            (resolvedPrimaryCandidate
              ? formatPlaceCaption(resolvedPrimaryCandidate)
              : "No address linked yet."))
        : resolvedPrimaryCandidate
          ? formatPlaceCaption(resolvedPrimaryCandidate)
          : "No place linked yet.";

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}
    >
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={
          isMobile
            ? "flex h-[94dvh] flex-col overflow-hidden rounded-t-[18px] border-x-0 border-b-0 bg-[#f6f7f8] p-0 sm:max-w-none"
            : "flex h-full w-full max-w-[36rem] flex-col overflow-hidden bg-[#f6f7f8] p-0 sm:max-w-[36rem]"
        }
      >
        <SheetHeader className="gap-2 border-b border-black/8 bg-[#f6f7f8] px-5 py-5">
          <div className="flex items-start gap-3">
            {step > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-0.5 size-8 rounded-[10px]"
                onClick={handleBack}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {currentDayLabel ? (
                  <Badge variant="outline" className="tracking-[0.08em]">
                    {currentDayLabel}
                  </Badge>
                ) : null}
                {step > 0 ? (
                  <Badge
                    variant="outline"
                    className="inline-flex items-center gap-1.5 tracking-[0.08em]"
                  >
                    <CurrentCategoryIcon className="h-3.5 w-3.5" />
                    {plannerCategoryLabel(category)}
                  </Badge>
                ) : null}
              </div>
              <SheetTitle className="mt-2 text-[1.32rem] font-semibold tracking-[-0.04em]">
                {activity
                  ? `Edit ${plannerCategoryLabel(category)} activity`
                  : "Create activity"}
              </SheetTitle>
              <SheetDescription className="mt-1 max-w-[31rem] text-sm leading-5">
                {activeStepDescription}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <form
          onSubmit={handleSubmit(submitActivity)}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
            <div className="mx-auto flex w-full max-w-[32rem] flex-col gap-4">
              {step === 0 ? (
                <section className="grid gap-2.5 md:grid-cols-2">
                  {(
                    Object.keys(PLANNER_CATEGORY_META) as ActivityCategory[]
                  ).map((value) => {
                    const meta = PLANNER_CATEGORY_META[value];
                    const Icon = CATEGORY_ICON[value];
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => handleCategorySelect(value)}
                        aria-pressed={category === value}
                        className={cn(
                          "cursor-pointer rounded-[18px] border bg-white px-4 py-4 text-left shadow-[0_16px_40px_-34px_rgba(26,22,21,0.4)] transition-colors",
                          category === value
                            ? "border-[rgba(26,22,21,0.14)] bg-[var(--color-secondary-surface)]"
                            : "border-black/8 hover:border-black/12 hover:bg-[var(--color-secondary-surface)]",
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex size-10 items-center justify-center rounded-[12px] bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]">
                            <Icon className="h-5 w-5 text-[var(--color-text)]" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-[var(--color-text)]">
                                {meta.label}
                              </p>
                              {category === value ? (
                                <Check className="h-4 w-4 text-[var(--color-text)]" />
                              ) : null}
                            </div>
                            <p className="mt-1 text-sm leading-6 text-[var(--color-text-muted)]">
                              {meta.description}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </section>
              ) : null}

              {step === 1 && category !== "travel" ? (
                <section className="rounded-[18px] border border-black/8 bg-white p-4 shadow-[0_16px_40px_-34px_rgba(26,22,21,0.4)]">
                  <div className="flex items-start justify-between gap-4">
                    <p className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                      {category === "hotel" ? "Stay helper" : "Place"}
                    </p>
                  </div>

                  {category === "hotel" ? (
                    <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
                      Search is optional here. Use it to prefill the hotel name and
                      address, then review everything manually in the next step.
                    </p>
                  ) : null}

                  <div className="mt-3">
                    <PlaceSelector
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
                      searchPlaceholder={
                        category === "hotel"
                          ? "Search Google hotels or address"
                          : `Search Google ${plannerCategoryLabel(category).toLowerCase()} places`
                      }
                      helperText="Type at least 3 characters to search Google places by name or address."
                      results={primarySearchResults}
                      isSearching={isSearchingPrimary}
                    />
                  </div>
                </section>
              ) : null}

              {step === 1 && category === "travel" ? (
                <section className="rounded-[18px] border border-black/8 bg-white p-4 shadow-[0_16px_40px_-34px_rgba(26,22,21,0.4)]">
                  <div className="flex items-start justify-between gap-4">
                    <p className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                      Route helper
                    </p>
                  </div>

                  <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
                    Search is optional here. Use Google place results to prefill
                    route endpoints and capture coordinates where available.
                  </p>

                  <div className="mt-3 grid gap-3">
                    <div>
                      <p className="mb-2 text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                        Origin
                      </p>
                      <PlaceSelector
                        query={originQuery}
                        selectedCandidate={originCandidate}
                        onQueryChange={(value) => {
                          setOriginQuery(value);
                          if (!candidateMatchesQuery(originCandidate, value)) {
                            setOriginCandidate(null);
                          }
                        }}
                        onSelect={(candidate) => {
                          setOriginCandidate(candidate);
                          setOriginQuery(candidate.name);
                          setValue(
                            "origin_text",
                            candidate.name ?? candidate.address_text ?? "",
                          );
                        }}
                        autoFocus
                        searchPlaceholder="Search departure point"
                        helperText="Type at least 3 characters to search Google places."
                        results={originSearchResults}
                        isSearching={isSearchingOrigin}
                      />
                    </div>

                    <div>
                      <p className="mb-2 text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                        Destination
                      </p>
                      <PlaceSelector
                        query={destinationQuery}
                        selectedCandidate={destinationCandidate}
                        onQueryChange={(value) => {
                          setDestinationQuery(value);
                          if (
                            !candidateMatchesQuery(destinationCandidate, value)
                          ) {
                            setDestinationCandidate(null);
                          }
                        }}
                        onSelect={(candidate) => {
                          setDestinationCandidate(candidate);
                          setDestinationQuery(candidate.name);
                          setValue(
                            "destination_text",
                            candidate.name ?? candidate.address_text ?? "",
                          );
                        }}
                        searchPlaceholder="Search arrival point"
                        helperText="Type at least 3 characters to search Google places."
                        results={destinationSearchResults}
                        isSearching={isSearchingDestination}
                      />
                    </div>
                  </div>
                </section>
              ) : null}

              {step === 2 ? (
                <div className="grid gap-3">
                  <section className="rounded-[18px] border border-black/8 bg-white p-4 shadow-[0_16px_40px_-34px_rgba(26,22,21,0.4)]">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                          {category === "travel"
                            ? "Route helper"
                            : category === "hotel"
                              ? "Stay helper"
                              : "Linked place"}
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
                    <p className="mt-3 text-sm text-[var(--color-text-muted)]">
                      {currentDayLabel}
                    </p>
                  </section>

                  {category === "travel" ? (
                    <section className="rounded-[18px] border border-black/8 bg-white p-4 shadow-[0_16px_40px_-34px_rgba(26,22,21,0.4)]">
                      <p className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                        Travel details
                      </p>
                      <FieldGroup className="mt-3 gap-3">
                        <Field data-invalid={Boolean(errors.origin_text)}>
                          <FieldLabel htmlFor="travel-origin">
                            Origin
                          </FieldLabel>
                          <FieldContent>
                            <Input
                              id="travel-origin"
                              placeholder="Enter the departure point"
                              aria-invalid={Boolean(errors.origin_text)}
                              className="h-11 rounded-[10px] border-black/8 bg-white"
                              {...register("origin_text")}
                            />
                          </FieldContent>
                          {errors.origin_text ? (
                            <FieldError errors={[errors.origin_text]} />
                          ) : null}
                        </Field>

                        <Field data-invalid={Boolean(errors.destination_text)}>
                          <FieldLabel htmlFor="travel-destination">
                            Destination
                          </FieldLabel>
                          <FieldContent>
                            <Input
                              id="travel-destination"
                              placeholder="Enter the arrival point"
                              aria-invalid={Boolean(errors.destination_text)}
                              className="h-11 rounded-[10px] border-black/8 bg-white"
                              {...register("destination_text")}
                            />
                          </FieldContent>
                          {errors.destination_text ? (
                            <FieldError errors={[errors.destination_text]} />
                          ) : null}
                        </Field>

                        <Field>
                          <FieldLabel htmlFor="travel-mode">
                            Travel mode
                          </FieldLabel>
                          <FieldContent>
                            <Input
                              id="travel-mode"
                              placeholder="Flight, train, ferry, taxi..."
                              className="h-11 rounded-[10px] border-black/8 bg-white"
                              {...register("travel_mode")}
                            />
                          </FieldContent>
                        </Field>
                      </FieldGroup>
                    </section>
                  ) : null}

                  {category === "hotel" ? (
                    <section className="rounded-[18px] border border-black/8 bg-white p-4 shadow-[0_16px_40px_-34px_rgba(26,22,21,0.4)]">
                      <p className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                        Stay details
                      </p>
                      <FieldGroup className="mt-3 gap-3">
                        <Field data-invalid={Boolean(errors.hotel_name)}>
                          <FieldLabel htmlFor="hotel-name">
                            Hotel name
                          </FieldLabel>
                          <FieldContent>
                            <Input
                              id="hotel-name"
                              placeholder="Enter the hotel or stay name"
                              aria-invalid={Boolean(errors.hotel_name)}
                              className="h-11 rounded-[10px] border-black/8 bg-white"
                              {...register("hotel_name")}
                            />
                          </FieldContent>
                          {errors.hotel_name ? (
                            <FieldError errors={[errors.hotel_name]} />
                          ) : null}
                        </Field>

                        <Field>
                          <FieldLabel htmlFor="hotel-address">
                            Address
                          </FieldLabel>
                          <FieldContent>
                            <Textarea
                              id="hotel-address"
                              rows={3}
                              placeholder="Street address, area, or meeting point"
                              className="rounded-[10px] border-black/8 bg-white"
                              {...register("address_text")}
                            />
                          </FieldContent>
                        </Field>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field data-invalid={Boolean(errors.checkin_date)}>
                            <FieldLabel htmlFor="hotel-checkin">
                              Check-in date
                            </FieldLabel>
                            <FieldContent>
                              <Input
                                id="hotel-checkin"
                                type="date"
                                aria-invalid={Boolean(errors.checkin_date)}
                                className="h-11 rounded-[10px] border-black/8 bg-white"
                                {...register("checkin_date")}
                              />
                            </FieldContent>
                            {errors.checkin_date ? (
                              <FieldError errors={[errors.checkin_date]} />
                            ) : null}
                          </Field>

                          <Field data-invalid={Boolean(errors.checkout_date)}>
                            <FieldLabel htmlFor="hotel-checkout">
                              Checkout date
                            </FieldLabel>
                            <FieldContent>
                              <Input
                                id="hotel-checkout"
                                type="date"
                                aria-invalid={Boolean(errors.checkout_date)}
                                className="h-11 rounded-[10px] border-black/8 bg-white"
                                {...register("checkout_date")}
                              />
                            </FieldContent>
                            {errors.checkout_date ? (
                              <FieldError errors={[errors.checkout_date]} />
                            ) : null}
                          </Field>
                        </div>

                        <Field>
                          <FieldLabel htmlFor="hotel-room-type">
                            Room type
                          </FieldLabel>
                          <FieldContent>
                            <Input
                              id="hotel-room-type"
                              placeholder="Standard room, suite, apartment..."
                              className="h-11 rounded-[10px] border-black/8 bg-white"
                              {...register("room_type")}
                            />
                          </FieldContent>
                        </Field>
                      </FieldGroup>
                    </section>
                  ) : null}

                  <section className="rounded-[18px] border border-black/8 bg-white p-4 shadow-[0_16px_40px_-34px_rgba(26,22,21,0.4)]">
                    <p className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                      Activity details
                    </p>
                    <FieldGroup className="mt-3 gap-3">
                      <Field>
                        <FieldLabel htmlFor="activity-day">
                          Assigned day
                        </FieldLabel>
                        <FieldContent>
                          <Combobox
                            id="activity-day"
                            value={selectedAssignmentValue}
                            onValueChange={(value) =>
                              setAssignedTripDayId(
                                value === INBOX_DAY_VALUE ? null : value,
                              )
                            }
                            options={assignmentOptions}
                            placeholder="Select day"
                            searchPlaceholder="Search day"
                            emptyText="No days found"
                            triggerClassName="border-black/8"
                          />
                        </FieldContent>
                      </Field>

                      <Field data-invalid={Boolean(errors.title)}>
                        <FieldLabel htmlFor="activity-title">Title</FieldLabel>
                        <FieldContent>
                          <Input
                            id="activity-title"
                            placeholder="Name this activity"
                            aria-invalid={Boolean(errors.title)}
                            className="h-11 rounded-[10px] border-black/8 bg-white"
                            {...titleField}
                          />
                        </FieldContent>
                        {errors.title ? (
                          <FieldError errors={[errors.title]} />
                        ) : null}
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="activity-description">
                          Description
                        </FieldLabel>
                        <FieldContent>
                          <Textarea
                            id="activity-description"
                            rows={5}
                            placeholder="What should this activity include?"
                            className="rounded-[10px] border-black/8 bg-white"
                            {...register("description")}
                          />
                        </FieldContent>
                      </Field>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <Controller
                          name="start_time"
                          control={control}
                          render={({ field, fieldState }) => (
                            <Field data-invalid={Boolean(fieldState.error)}>
                              <FieldLabel htmlFor="activity-start-time">
                                Start time
                              </FieldLabel>
                              <FieldContent>
                                <TimePicker
                                  id="activity-start-time"
                                  value={field.value ?? ""}
                                  onChange={field.onChange}
                                  invalid={Boolean(fieldState.error)}
                                  triggerClassName="border-black/8"
                                />
                              </FieldContent>
                              {fieldState.error ? (
                                <FieldError errors={[fieldState.error]} />
                              ) : null}
                            </Field>
                          )}
                        />

                        <Field data-invalid={Boolean(errors.duration_min)}>
                          <FieldLabel htmlFor="activity-duration">
                            Duration (min)
                          </FieldLabel>
                          <FieldContent>
                            <Controller
                              name="duration_min"
                              control={control}
                              render={({ field }) => (
                                <Input
                                  id="activity-duration"
                                  type="number"
                                  min={0}
                                  className="h-11 rounded-[10px] border-black/8 bg-white"
                                  value={field.value ?? ""}
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
                      </div>

                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9.5rem]">
                        <Field
                          data-invalid={Boolean(errors.estimated_cost_amount)}
                        >
                          <FieldLabel htmlFor="activity-cost">
                            Estimated cost
                          </FieldLabel>
                          <FieldContent>
                            <Controller
                              name="estimated_cost_amount"
                              control={control}
                              render={({ field }) => (
                                <Input
                                  id="activity-cost"
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  className="h-11 rounded-[10px] border-black/8 bg-white"
                                  value={field.value ?? ""}
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
                          {errors.estimated_cost_amount ? (
                            <FieldError
                              errors={[errors.estimated_cost_amount]}
                            />
                          ) : null}
                        </Field>

                        <Controller
                          name="estimated_cost_currency"
                          control={control}
                          render={({ field, fieldState }) => (
                            <Field data-invalid={Boolean(fieldState.error)}>
                              <FieldLabel htmlFor="activity-currency">
                                Currency
                              </FieldLabel>
                              <FieldContent>
                                <Combobox
                                  id="activity-currency"
                                  value={field.value ?? "EUR"}
                                  onValueChange={field.onChange}
                                  options={CURRENCY_OPTIONS}
                                  placeholder="Select currency"
                                  searchPlaceholder="Search currency"
                                  emptyText="No currencies found"
                                  invalid={Boolean(fieldState.error)}
                                  triggerClassName="border-black/8"
                                />
                              </FieldContent>
                              {fieldState.error ? (
                                <FieldError errors={[fieldState.error]} />
                              ) : null}
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
                            className="rounded-[10px] border-black/8 bg-white"
                            {...register("notes")}
                          />
                        </FieldContent>
                      </Field>
                    </FieldGroup>
                  </section>
                </div>
              ) : null}
            </div>
          </div>

          <SheetFooter className="border-t border-black/8 bg-white px-4 py-3">
            <div className="flex w-full items-center justify-end gap-2">
              {step === 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-[10px]"
                  onClick={onClose}
                >
                  Cancel
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-[10px]"
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
                    className="rounded-[10px]"
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
                    className="rounded-[10px]"
                    disabled={isSaving || createPlaceMutation.isPending}
                  >
                    {isSaving || createPlaceMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    {activity ? "Save changes" : "Create activity"}
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
