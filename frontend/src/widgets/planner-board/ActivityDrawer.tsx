import { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import {
  BedDouble,
  CarFront,
  Check,
  FileText,
  Footprints,
  Landmark,
  MapPin,
  Paperclip,
  Plane,
  Search,
  ShipWheel,
  Ticket,
  Trash2,
  TrainFront,
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
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  WheelPicker,
  WheelPickerWrapper,
  type WheelPickerOption,
} from "@/components/wheel-picker/wheel-picker";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import { cn } from "@/shared/lib/cn";
import { CURRENCY_OPTIONS } from "@/shared/lib/currencies";
import TripAssetManager from "@/widgets/trip-assets";
import { VoyagerLoader } from '@/widgets/app-shell/logo'
import type {
  Activity,
  ActivityCategory,
  ActivityCreateInput,
  Place,
  PlaceCreateInput,
  GooglePlaceCandidate,
  PlannerActivity,
} from "@/shared/api/types";
import {
  PLANNER_CATEGORY_META,
  PLANNER_TRAVEL_MODE_OPTIONS,
  plannerCategoryLabel,
} from "./categories";

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
type CreateFlow = "itinerary" | "hotel" | "travel";
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

const TRAVEL_HOUR_OPTIONS: WheelPickerOption[] = Array.from(
  { length: 24 },
  (_, index) => {
    const value = String(index).padStart(2, "0");
    return { value, label: value };
  },
);

const TRAVEL_MINUTE_OPTIONS: WheelPickerOption[] = Array.from(
  { length: 60 },
  (_, index) => {
    const value = String(index).padStart(2, "0");
    return { value, label: value };
  },
);

function normalizeTravelMode(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "flight" ||
    normalized === "train" ||
    normalized === "car" ||
    normalized === "ferry" ||
    normalized === "walk"
  ) {
    return normalized;
  }
  if (normalized === "drive" || normalized === "driving" || normalized === "taxi") {
    return "car";
  }
  if (normalized === "rail" || normalized === "transit") {
    return "train";
  }
  if (normalized === "walking") {
    return "walk";
  }
  return "flight";
}

function splitTimeParts(value: string | null | undefined) {
  const [rawHour = "09", rawMinute = "00"] = (value ?? "").slice(0, 5).split(":");
  const hour = /^\d{2}$/.test(rawHour) ? rawHour : "09";
  const minute = /^\d{2}$/.test(rawMinute) ? rawMinute : "00";
  return { hour, minute };
}

function formatAttachmentBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function pendingAttachmentKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function mergePendingAttachments(currentFiles: File[], nextFiles: File[]) {
  const seen = new Set(currentFiles.map(pendingAttachmentKey));
  const additions = nextFiles.filter((file) => {
    const key = pendingAttachmentKey(file);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  return [...currentFiles, ...additions];
}

function currentStepDescription(
  step: Step,
  category: ActivityCategory,
  isCreate: boolean,
  createFlow: CreateFlow,
) {
  if (!isCreate) {
    return "Edit the saved details for this planner item.";
  }
  if (createFlow === "travel") {
    return "Add the route details for this travel segment.";
  }
  if (createFlow === "hotel") {
    return "Add the stay details for this accommodation item.";
  }
  if (step === 0) {
    return "Choose the itinerary activity type.";
  }
  if (step === 1) {
    return `Search and link a ${plannerCategoryLabel(category).toLowerCase()} place.`;
  }
  return "Review the itinerary details and save the activity.";
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
      normalizeTravelMode(details.travel_mode),
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
    travel_mode: "flight",
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

function candidateFromHotelDetails(
  details: Record<string, unknown>,
): PlaceCandidate | null {
  const hotelName =
    typeof details.hotel_name === "string" ? String(details.hotel_name) : null;
  const addressText =
    typeof details.address_text === "string"
      ? String(details.address_text)
      : null;
  const lat = Number(details.latitude);
  const lon = Number(details.longitude);

  if (!hotelName && !addressText && (!Number.isFinite(lat) || !Number.isFinite(lon))) {
    return null;
  }

  return {
    source: "manual_stay",
    saved_place_id:
      typeof details.place_id === "string" ? String(details.place_id) : null,
    name: hotelName ?? addressText ?? "Accommodation",
    category: "hotel",
    address_text: addressText,
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
    <div className="rounded-[16px] border border-black/8 bg-[var(--color-secondary-surface)] p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <Input
          id={inputId}
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
              <VoyagerLoader className="h-4 w-4 " />
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

function TravelTimeWheelPicker({
  value,
  onChange,
  inputAriaLabel = "Type start time",
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  inputAriaLabel?: string;
}) {
  const { hour, minute } = splitTimeParts(value);
  const normalizedValue = `${hour}:${minute}`;

  return (
    <div className="flex flex-col gap-2 rounded-[14px] bg-[var(--color-secondary-surface)] px-2.5 py-2.5">
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <p className="text-[0.68rem] font-medium uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
            Type time
          </p>
          <p className="text-[0.72rem] text-[var(--color-text-muted)]">
            Faster than scrolling
          </p>
        </div>
        <Input
          type="time"
          step={60}
          aria-label={inputAriaLabel}
          value={normalizedValue}
          onChange={(event) => onChange(event.target.value || normalizedValue)}
          className="h-10 w-[8.25rem] rounded-[10px] border-black/8 bg-white px-3 text-sm font-semibold tracking-[-0.02em] shadow-none"
        />
      </div>

      <div className="flex items-center justify-center gap-2 rounded-[14px] bg-white px-2 py-3 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]">
        <WheelPickerWrapper className="w-[6rem] rounded-[12px] border-0 bg-transparent px-1 shadow-none">
          <WheelPicker
            value={hour}
            options={TRAVEL_HOUR_OPTIONS}
            onValueChange={(nextHour) => onChange(`${String(nextHour)}:${minute}`)}
            infinite
            optionItemHeight={30}
            visibleCount={7}
            classNames={{
              optionItem:
                "text-[0.78rem] font-medium text-[var(--color-text-muted)]",
              highlightWrapper:
                "rounded-[10px] bg-[var(--color-secondary-surface)] text-[var(--color-text)] ring-0",
              highlightItem:
                "text-[0.9rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]",
            }}
          />
        </WheelPickerWrapper>
        <span className="text-[0.95rem] font-semibold text-[var(--color-text-muted)]">:</span>
        <WheelPickerWrapper className="w-[6rem] rounded-[12px] border-0 bg-transparent px-1 shadow-none">
          <WheelPicker
            value={minute}
            options={TRAVEL_MINUTE_OPTIONS}
            onValueChange={(nextMinute) => onChange(`${hour}:${String(nextMinute)}`)}
            infinite
            optionItemHeight={30}
            visibleCount={7}
            classNames={{
              optionItem:
                "text-[0.78rem] font-medium text-[var(--color-text-muted)]",
              highlightWrapper:
                "rounded-[10px] bg-[var(--color-secondary-surface)] text-[var(--color-text)] ring-0",
              highlightItem:
                "text-[0.9rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]",
            }}
          />
        </WheelPickerWrapper>
      </div>
    </div>
  );
}

function PendingActivityAttachments({
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
    <section className="rounded-[18px] border border-black/8 bg-white p-4 shadow-[0_16px_40px_-34px_rgba(26,22,21,0.4)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            Attachments
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
            Add files now and they will be linked to this activity right after save.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-full border-black/8 px-3 text-[0.76rem] font-semibold"
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className="mr-1.5 h-3.5 w-3.5" />
          Join file
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        aria-label="Attach files to activity"
        className="sr-only"
        onChange={(event) => {
          const selectedFiles = event.target.files
            ? Array.from(event.target.files)
            : [];
          if (selectedFiles.length > 0) {
            onAddFiles(selectedFiles);
          }
          event.target.value = "";
        }}
      />

      {files.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2">
          {files.map((file) => {
            const fileKey = pendingAttachmentKey(file);
            return (
              <div
                key={fileKey}
                className="flex items-center gap-3 rounded-[14px] border border-black/8 bg-[var(--color-secondary-surface)] px-3 py-2.5"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]">
                  <FileText className="h-4 w-4 text-[var(--color-text-muted)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--color-text)]">
                    {file.name}
                  </p>
                  <p className="mt-0.5 text-[0.72rem] text-[var(--color-text-muted)]">
                    {formatAttachmentBytes(file.size)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-full text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-text)]"
                  onClick={() => onRemoveFile(fileKey)}
                  aria-label={`Remove ${file.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-center rounded-[16px] border border-dashed border-black/8 bg-[var(--color-secondary-surface)] px-4 py-6 text-center">
          <div>
            <p className="text-sm font-medium text-[var(--color-text-muted)]">
              No files linked yet
            </p>
            <p className="mt-1 text-[0.72rem] text-[var(--color-text-muted)]">
              Add tickets, PDFs, screenshots, or booking confirmations.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

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
    ? "itinerary"
    : defaultCategory === "hotel"
      ? "hotel"
      : defaultCategory === "travel"
        ? "travel"
        : "itinerary";
  const minimumStep: Step =
    !isCreate || createFlow !== "itinerary" ? 2 : 0;
  const initialCreateCategory: ActivityCategory =
    defaultCategory ??
    (createFlow === "hotel"
      ? "hotel"
      : createFlow === "travel"
        ? "travel"
        : "visit");
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
  const lastAutoTitleRef = useRef("");
  const [step, setStep] = useState<Step>(minimumStep);
  const [category, setCategory] = useState<ActivityCategory>(
    activity?.category ?? initialCreateCategory,
  );
  const [primaryQuery, setPrimaryQuery] = useState("");
  const [primaryCandidate, setPrimaryCandidate] =
    useState<PlaceCandidate | null>(null);
  const [originQuery, setOriginQuery] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [assignedTripDayId, setAssignedTripDayId] = useState<string | null>(
    activity?.trip_day_id ??
      (createFlow === "travel" || createFlow === "hotel"
        ? null
        : defaultTripDayId),
  );
  const [originCandidate, setOriginCandidate] = useState<PlaceCandidate | null>(
    null,
  );
  const [destinationCandidate, setDestinationCandidate] =
    useState<PlaceCandidate | null>(null);
  const [pendingAttachmentFiles, setPendingAttachmentFiles] = useState<File[]>([]);
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
        ? dayOptions.map((option) =>
            option.value !== INBOX_DAY_VALUE || createFlow !== "travel"
              ? option
              : {
                  ...option,
                  label: "Not assigned",
                  description: "Keep this travel segment separate until scheduled",
                },
          )
        : [
            {
              value: INBOX_DAY_VALUE,
              label: createFlow === "travel" ? "Not assigned" : "Inbox",
              description:
                createFlow === "travel"
                  ? "Keep this travel segment separate until scheduled"
                  : "Unassigned activity",
            },
          ],
    [createFlow, dayOptions],
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
  const visibleDayLabel =
    selectedAssignmentValue === INBOX_DAY_VALUE ? null : currentDayLabel;
  const { data: selectedPlace } = usePlace(selectedPlaceId);
  const selectedPlaceCandidate = useMemo(
    () => plannerActivityCandidate(selectedPlace),
    [selectedPlace],
  );
  const primaryGoogleSearch = useGooglePlaceSearch(
    { q: debouncedPrimaryQuery, limit: 6, offset: 0 },
    open &&
      category !== "travel" &&
      (step === 1 || category === "hotel") &&
      debouncedPrimaryQuery.length >= 3,
  );
  const originGoogleSearch = useGooglePlaceSearch(
    { q: debouncedOriginQuery, limit: 6, offset: 0 },
    open &&
      category === "travel" &&
      debouncedOriginQuery.length >= 3,
  );
  const destinationGoogleSearch = useGooglePlaceSearch(
    { q: debouncedDestinationQuery, limit: 6, offset: 0 },
    open &&
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
  const watchedAddressText = watch("address_text");
  const watchedTitle = watch("title");
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
    setPendingAttachmentFiles([]);
    setAssignedTripDayId(
      activity?.trip_day_id ??
        (createFlow === "travel" || createFlow === "hotel"
          ? null
          : defaultTripDayId ?? null),
    );

    if (activity) {
      setCategory(activity.category);
      setStep(2);
      setPrimaryCandidate(
        activity.category === "hotel" ? hotelDetailsCandidate : null,
      );
      setOriginCandidate(candidateFromTravelDetails(existingDetails, "origin"));
      setDestinationCandidate(
        candidateFromTravelDetails(existingDetails, "destination"),
      );
      return;
    }

    setCategory(initialCreateCategory);
    setStep(minimumStep);
    setPrimaryCandidate(null);
    setOriginCandidate(null);
    setDestinationCandidate(null);
    setValue(
      "start_time",
      createFlow === "travel"
        ? "09:00"
        : createFlow === "hotel"
          ? "15:00"
          : "",
    );
    setValue(
      "travel_mode",
      activity?.category === "travel"
        ? normalizeTravelMode(activity.category_details?.travel_mode)
        : createFlow === "travel"
          ? "flight"
          : "",
    );
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
    () => ["visit", "eat", "activity"],
    [],
  );

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
    if (assignedTripDayId == null && category !== "travel" && category !== "hotel") {
      setValue("start_time", "");
    }
  }, [assignedTripDayId, category, setValue]);

  useEffect(() => {
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
    watchedOriginText,
  ]);

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
      (candidate.source === "manual_route" || candidate.source === "manual_stay") &&
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
    setPrimaryQuery(candidate.address_text ?? candidate.name);
    if (category === "hotel") {
      setValue("hotel_name", candidate.name);
      setValue("address_text", candidate.address_text ?? "");
      setTitleIfPristine(candidate.name);
    } else {
      applyCandidateAutofill(candidate);
    }
    setStep(2);
  };

  const handleOriginCandidateSelect = (candidate: PlaceCandidate) => {
    setOriginCandidate(candidate);
    setOriginQuery(candidate.address_text ?? candidate.name);
    setValue("origin_text", candidate.address_text ?? candidate.name ?? "");
  };

  const handleDestinationCandidateSelect = (candidate: PlaceCandidate) => {
    setDestinationCandidate(candidate);
    setDestinationQuery(candidate.address_text ?? candidate.name);
    setValue(
      "destination_text",
      candidate.address_text ?? candidate.name ?? "",
    );
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
  const finalOriginCandidate = originCandidate ?? resolvedOriginCandidate;
  const finalDestinationCandidate =
    destinationCandidate ?? resolvedDestinationCandidate;
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
    setStep((current) =>
      current <= minimumStep ? current : ((current - 1) as Step),
    );
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
    setValue("travel_mode", value === "travel" ? "flight" : "");
    setValue("hotel_name", "");
    setValue("address_text", "");
    setValue("checkin_date", "");
    setValue("checkout_date", "");
    setValue("room_type", "");
    setStep(1);
  };

  const submitActivity = async (
    values: ActivityFormValues,
    attachmentFiles: File[] = [],
  ) => {
    clearErrors([
      "origin_text",
      "destination_text",
      "checkin_date",
      "checkout_date",
    ]);

    const normalizedOriginText = (
      finalOriginCandidate?.address_text ??
      finalOriginCandidate?.name ??
      values.origin_text ??
      ""
    ).trim();
    const normalizedDestinationText = (
      finalDestinationCandidate?.address_text ??
      finalDestinationCandidate?.name ??
      values.destination_text ??
      ""
    ).trim();
    const normalizedAddressText = (values.address_text ?? "").trim();
    const normalizedTravelMode = (values.travel_mode ?? "").trim();
    const normalizedCheckinDate = (values.checkin_date ?? "").trim();
    const normalizedCheckoutDate = (values.checkout_date ?? "").trim();
    const normalizedTitle = (values.title ?? "").trim();

    let hasValidationError = false;

    if (category === "travel") {
      if (!finalOriginCandidate || !normalizedOriginText) {
        setError("origin_text", {
          type: "manual",
          message: "Select an origin address",
        });
        hasValidationError = true;
      }
      if (!finalDestinationCandidate || !normalizedDestinationText) {
        setError("destination_text", {
          type: "manual",
          message: "Select a destination address",
        });
        hasValidationError = true;
      }
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
        finalOriginCandidate,
      );
      const destinationPlaceId = await persistPlaceCandidate(
        finalDestinationCandidate,
      );

      const categoryDetails: Record<string, unknown> =
        category === "travel"
          ? {
              origin_text: normalizedOriginText || null,
              destination_text: normalizedDestinationText || null,
              travel_mode: normalizeTravelMode(normalizedTravelMode),
              origin_geo:
                finalOriginCandidate?.lat != null &&
                finalOriginCandidate.lon != null
                  ? {
                      lat: finalOriginCandidate.lat,
                      lon: finalOriginCandidate.lon,
                    }
                  : null,
              destination_geo:
                finalDestinationCandidate?.lat != null &&
                finalDestinationCandidate.lon != null
                  ? {
                      lat: finalDestinationCandidate.lat,
                      lon: finalDestinationCandidate.lon,
                    }
                  : null,
              origin_place_id: originPlaceId,
              destination_place_id: destinationPlaceId,
            }
          : category === "hotel"
            ? {
                hotel_name: normalizedTitle || values.title,
                address_text:
                  normalizedAddressText ||
                  resolvedPrimaryCandidate?.address_text ||
                  null,
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

      await onSave({
        trip_day_id: assignedTripDayId,
        category,
        category_details: categoryDetails,
        title: values.title,
        description: values.description || null,
        start_time:
          category === "travel" || category === "hotel"
            ? values.start_time || null
            : assignedTripDayId == null
              ? null
              : values.start_time || null,
        duration_min: category === "hotel" ? null : values.duration_min ?? null,
        estimated_cost_amount: values.estimated_cost_amount ?? null,
        estimated_cost_currency: values.estimated_cost_currency || null,
        place_id: placeId,
        notes: values.notes || null,
        is_favorite: activity?.is_favorite ?? false,
        source: activity?.source ?? "manual",
      }, attachmentFiles);
    } catch {
      toast.error("Failed to prepare the selected place");
    }
  };

  const activeStepDescription = currentStepDescription(
    step,
    category,
    isCreate,
    createFlow,
  );
  const CurrentCategoryIcon = CATEGORY_ICON[category] ?? Landmark;
  const createTitle =
    createFlow === "hotel"
      ? "Create accommodation"
      : createFlow === "travel"
        ? "Create travel"
        : "Create itinerary activity";
  const submitLabel = activity
    ? "Save changes"
    : createFlow === "hotel"
      ? "Create accommodation"
      : createFlow === "travel"
        ? "Create travel"
        : "Create itinerary activity";
  const selectedLocationTitle =
    category === "travel"
      ? `${watchedOriginText?.trim() || resolvedOriginCandidate?.name || "Origin"} to ${watchedDestinationText?.trim() || resolvedDestinationCandidate?.name || "Destination"}`
      : category === "hotel"
        ? (watchedTitle?.trim() || resolvedPrimaryCandidate?.name || hotelDetailsCandidate?.name || "No stay named yet")
        : (resolvedPrimaryCandidate?.name ?? "No place selected");
  const selectedLocationDescription =
    category === "travel"
      ? "Fill in the route details for this segment."
      : category === "hotel"
        ? (watchedAddressText?.trim() ||
            (resolvedPrimaryCandidate
              ? formatPlaceCaption(resolvedPrimaryCandidate)
              : hotelDetailsCandidate
                ? formatPlaceCaption(hotelDetailsCandidate)
              : "Add the stay details and save it when you are ready."))
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
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {visibleDayLabel ? (
                  <Badge variant="outline" className="tracking-[0.08em]">
                    {visibleDayLabel}
                  </Badge>
                ) : null}
                {step > minimumStep ? (
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
                  : createTitle}
              </SheetTitle>
              <SheetDescription className="mt-1 max-w-[31rem] text-sm leading-5">
                {activeStepDescription}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <form
          onSubmit={handleSubmit((values) =>
            submitActivity(values, pendingAttachmentFiles),
          )}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
            <div className="mx-auto flex w-full max-w-[32rem] flex-col gap-4">
              {step === 0 && isCreate && createFlow === "itinerary" ? (
                <section className="grid gap-2.5 md:grid-cols-2">
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

              {step === 1 && createFlow === "itinerary" ? (
                <section className="rounded-[18px] border border-black/8 bg-white p-4 shadow-[0_16px_40px_-34px_rgba(26,22,21,0.4)]">
                  <div className="flex items-start justify-between gap-4">
                    <p className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                      Place
                    </p>
                  </div>

                  <div className="mt-3">
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
                  <section className="rounded-[18px] border border-black/8 bg-white p-4 shadow-[0_16px_40px_-34px_rgba(26,22,21,0.4)]">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                          {category === "travel"
                            ? "Travel"
                            : category === "hotel"
                              ? "Accommodation"
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
                    {visibleDayLabel ? (
                      <p className="mt-3 text-sm text-[var(--color-text-muted)]">
                        {visibleDayLabel}
                      </p>
                    ) : null}
                  </section>

                  {category === "travel" ? (
                    <section className="rounded-[18px] border border-black/8 bg-white p-4 shadow-[0_16px_40px_-34px_rgba(26,22,21,0.4)]">
                      <p className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                        Travel details
                      </p>
                      <FieldGroup className="mt-3 gap-3">
                        <Field>
                          <FieldLabel htmlFor="travel-mode">
                            Travel mode
                          </FieldLabel>
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
                                    className="h-11 rounded-[10px] border-black/8"
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
                          <FieldLabel htmlFor="travel-origin-search">
                            Origin address
                          </FieldLabel>
                          <FieldContent>
                            <PlaceSelector
                              inputId="travel-origin-search"
                              query={originQuery}
                              selectedCandidate={finalOriginCandidate}
                              onQueryChange={(value) => {
                                setOriginQuery(value);
                                setValue("origin_text", value);
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
                          {errors.origin_text ? (
                            <FieldError errors={[errors.origin_text]} />
                          ) : null}
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
                                setValue("destination_text", value);
                                if (
                                  !candidateMatchesQuery(destinationCandidate, value)
                                ) {
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
                              <FieldLabel htmlFor="travel-start-time">
                                Start time
                              </FieldLabel>
                              <FieldContent>
                                <div id="travel-start-time">
                                  <TravelTimeWheelPicker
                                    value={field.value || "09:00"}
                                    onChange={field.onChange}
                                  />
                                </div>
                              </FieldContent>
                              {fieldState.error ? (
                                <FieldError errors={[fieldState.error]} />
                              ) : null}
                            </Field>
                          )}
                        />
                      </FieldGroup>
                    </section>
                  ) : null}

                  {category === "hotel" ? (
                    <section className="rounded-[18px] border border-black/8 bg-white p-4 shadow-[0_16px_40px_-34px_rgba(26,22,21,0.4)]">
                      <p className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                        Accommodation details
                      </p>
                      <FieldGroup className="mt-3 gap-3">
                        <Field>
                          <FieldLabel htmlFor="hotel-address">
                            Address
                          </FieldLabel>
                          <FieldContent>
                            <PlaceSelector
                              inputId="hotel-address"
                              query={primaryQuery}
                              selectedCandidate={resolvedPrimaryCandidate}
                              onQueryChange={(value) => {
                                setPrimaryQuery(value);
                                setValue("address_text", value);
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
                                <FieldLabel htmlFor="hotel-checkin">
                                  Check-in date
                                </FieldLabel>
                                <FieldContent>
                                  <DatePicker
                                    id="hotel-checkin"
                                    value={field.value ?? ""}
                                    onChange={field.onChange}
                                    invalid={Boolean(fieldState.error)}
                                    placeholder="Choose check-in date"
                                    className="h-11 rounded-[10px] border-black/8 bg-white shadow-none"
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
                                <FieldLabel htmlFor="hotel-checkout">
                                  Checkout date
                                </FieldLabel>
                                <FieldContent>
                                  <DatePicker
                                    id="hotel-checkout"
                                    value={field.value ?? ""}
                                    onChange={field.onChange}
                                    invalid={Boolean(fieldState.error)}
                                    placeholder="Choose checkout date"
                                    className="h-11 rounded-[10px] border-black/8 bg-white shadow-none"
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
                              <FieldLabel htmlFor="hotel-start-time">
                                Check-in time
                              </FieldLabel>
                              <FieldContent>
                                <div id="hotel-start-time">
                                  <TravelTimeWheelPicker
                                    value={field.value || "15:00"}
                                    onChange={field.onChange}
                                    inputAriaLabel="Type check-in time"
                                  />
                                </div>
                              </FieldContent>
                              {fieldState.error ? (
                                <FieldError errors={[fieldState.error]} />
                              ) : null}
                            </Field>
                          )}
                        />

                      </FieldGroup>
                    </section>
                  ) : null}

                  <section className="rounded-[18px] border border-black/8 bg-white p-4 shadow-[0_16px_40px_-34px_rgba(26,22,21,0.4)]">
                    <p className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                      Activity details
                    </p>
                    <FieldGroup className="mt-3 gap-3">
                      {category !== "travel" && category !== "hotel" ? (
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
                      ) : null}

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
                        {category !== "travel" && category !== "hotel" ? (
                          <Controller
                            name="start_time"
                            control={control}
                            render={({ field, fieldState }) => (
                              <Field data-invalid={Boolean(fieldState.error)}>
                                <FieldLabel htmlFor="activity-start-time">
                                  Start time
                                </FieldLabel>
                                <FieldContent>
                                  <div id="activity-start-time">
                                    <TravelTimeWheelPicker
                                      value={field.value || "09:00"}
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
                        {category !== "hotel" ? (
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
                        ) : null}
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
                          currentFiles.filter(
                            (file) => pendingAttachmentKey(file) !== fileKey,
                          ),
                        )
                      }
                    />
                  ) : activity ? (
                    <TripAssetManager
                      tripId={tripId}
                      activityId={activity.id}
                      title="Attachments"
                      description="Add receipts, reservation PDFs, screenshots, and extra photos that belong to this activity."
                      className="shadow-[0_16px_40px_-34px_rgba(26,22,21,0.4)]"
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <SheetFooter className="border-t border-black/8 bg-white px-4 py-3">
            <div className="flex w-full items-center justify-end gap-2">
              {step === minimumStep ? (
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
                      <VoyagerLoader className="h-4 w-4 " />
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
