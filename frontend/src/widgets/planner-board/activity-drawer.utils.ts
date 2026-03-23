import type { Activity, ActivityCategory, GooglePlaceCandidate, PlannerActivity, Place } from '@/shared/api/types';
import { plannerCategoryLabel } from './categories';
import type { PlaceCandidate } from './activity-drawer.types';
import type { ActivityFormValues, CreateFlow, Step } from './activity-drawer.schema';

export function normalizeTravelMode(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (
    normalized === 'flight' ||
    normalized === 'train' ||
    normalized === 'car' ||
    normalized === 'ferry' ||
    normalized === 'walk'
  ) {
    return normalized;
  }
  if (normalized === 'drive' || normalized === 'driving' || normalized === 'taxi') {
    return 'car';
  }
  if (normalized === 'rail' || normalized === 'transit') {
    return 'train';
  }
  if (normalized === 'walking') {
    return 'walk';
  }
  return 'flight';
}

export function splitTimeParts(value: string | null | undefined) {
  const [rawHour = '09', rawMinute = '00'] = (value ?? '').slice(0, 5).split(':');
  const hour = /^\d{2}$/.test(rawHour) ? rawHour : '09';
  const minute = /^\d{2}$/.test(rawMinute) ? rawMinute : '00';
  return { hour, minute };
}

export function normalizeTypedTime(value: string) {
  const compactValue = value.trim().replace(/[^\d:]/g, '');
  if (!compactValue) return null;

  let hour: number;
  let minute: number;

  if (compactValue.includes(':')) {
    const [rawHour = '', ...rawMinuteParts] = compactValue.split(':');
    const hourDigits = rawHour.replace(/\D/g, '').slice(0, 2);
    const minuteDigits = rawMinuteParts.join('').replace(/\D/g, '').slice(0, 2);
    if (!hourDigits) return null;
    hour = Number(hourDigits);
    minute = minuteDigits ? Number(minuteDigits.padStart(2, '0')) : 0;
  } else {
    const digits = compactValue.replace(/\D/g, '').slice(0, 4);
    if (!digits) return null;

    if (digits.length <= 2) {
      hour = Number(digits);
      minute = 0;
    } else if (digits.length === 3) {
      hour = Number(digits.slice(0, 1));
      minute = Number(digits.slice(1));
    } else {
      hour = Number(digits.slice(0, 2));
      minute = Number(digits.slice(2));
    }
  }

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) {
    return null;
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function formatAttachmentBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function pendingAttachmentKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function mergePendingAttachments(currentFiles: File[], nextFiles: File[]) {
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

export function currentStepDescription(
  step: Step,
  category: ActivityCategory,
  isCreate: boolean,
  createFlow: CreateFlow,
) {
  if (!isCreate) {
    return 'Edit the saved details for this planner item.';
  }
  if (createFlow === 'travel') {
    return 'Add the route details for this travel segment.';
  }
  if (createFlow === 'hotel') {
    return 'Add the stay details for this accommodation item.';
  }
  if (step === 0) {
    return 'Choose the itinerary activity type.';
  }
  if (step === 1) {
    return `Search and link a ${plannerCategoryLabel(category).toLowerCase()} place.`;
  }
  return 'Review the itinerary details and save the activity.';
}

export function detailsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function activityToForm(activity: Activity | PlannerActivity): ActivityFormValues {
  const details = detailsRecord(activity.category_details);
  return {
    title: activity.title,
    description: activity.description ?? undefined,
    start_time: activity.start_time ?? undefined,
    duration_min: activity.duration_min ?? undefined,
    estimated_cost_amount:
      activity.estimated_cost_amount != null ? Number(activity.estimated_cost_amount) : undefined,
    estimated_cost_currency: activity.estimated_cost_currency ?? 'EUR',
    notes: activity.notes ?? undefined,
    origin_text: typeof details.origin_text === 'string' ? details.origin_text : undefined,
    destination_text:
      typeof details.destination_text === 'string' ? details.destination_text : undefined,
    travel_mode: normalizeTravelMode(details.travel_mode),
    hotel_name: typeof details.hotel_name === 'string' ? details.hotel_name : undefined,
    address_text: typeof details.address_text === 'string' ? details.address_text : undefined,
    checkin_date: typeof details.checkin_date === 'string' ? details.checkin_date : undefined,
    checkout_date: typeof details.checkout_date === 'string' ? details.checkout_date : undefined,
    room_type: typeof details.room_type === 'string' ? details.room_type : undefined,
  };
}

export function emptyActivityForm(): ActivityFormValues {
  return {
    title: '',
    description: '',
    start_time: '',
    duration_min: undefined,
    estimated_cost_amount: undefined,
    estimated_cost_currency: 'EUR',
    notes: '',
    origin_text: '',
    destination_text: '',
    travel_mode: 'flight',
    hotel_name: '',
    address_text: '',
    checkin_date: '',
    checkout_date: '',
    room_type: '',
  };
}

export function plannerActivityCandidate(place: Place | null | undefined): PlaceCandidate | null {
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

export function candidateFromTravelDetails(
  details: Record<string, unknown>,
  prefix: 'origin' | 'destination',
): PlaceCandidate | null {
  const text =
    typeof details[`${prefix}_text`] === 'string' ? String(details[`${prefix}_text`]) : null;
  const geo =
    details[`${prefix}_geo`] && typeof details[`${prefix}_geo`] === 'object'
      ? (details[`${prefix}_geo`] as Record<string, unknown>)
      : {};
  const lat = Number(geo.lat);
  const lon = Number(geo.lon);

  if (!text && (!Number.isFinite(lat) || !Number.isFinite(lon))) {
    return null;
  }

  return {
    source: 'manual_route',
    saved_place_id:
      typeof details[`${prefix}_place_id`] === 'string'
        ? String(details[`${prefix}_place_id`])
        : null,
    name: text ?? (prefix === 'origin' ? 'Origin' : 'Destination'),
    category: prefix,
    address_text: text,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    metadata: {},
  };
}

export function candidateFromHotelDetails(details: Record<string, unknown>): PlaceCandidate | null {
  const hotelName = typeof details.hotel_name === 'string' ? String(details.hotel_name) : null;
  const addressText =
    typeof details.address_text === 'string' ? String(details.address_text) : null;
  const lat = Number(details.latitude);
  const lon = Number(details.longitude);

  if (!hotelName && !addressText && (!Number.isFinite(lat) || !Number.isFinite(lon))) {
    return null;
  }

  return {
    source: 'manual_stay',
    saved_place_id: typeof details.place_id === 'string' ? String(details.place_id) : null,
    name: hotelName ?? addressText ?? 'Accommodation',
    category: 'hotel',
    address_text: addressText,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    metadata: {},
  };
}

export function candidateFromGooglePlace(place: GooglePlaceCandidate): PlaceCandidate {
  return {
    source: 'google_places',
    external_id: place.place_id,
    name: place.name,
    category: place.category,
    address_text: place.address_text,
    lat: place.lat,
    lon: place.lon,
    metadata: place.metadata ?? {},
  };
}

export function formatPlaceCaption(candidate: PlaceCandidate | null) {
  if (!candidate) return 'No place selected yet';
  return candidate.address_text || candidate.category || candidate.name;
}

export function normalizePlaceSearchQuery(value: string) {
  return value.replace(/['`]/g, "'").replace(/\s+/g, ' ').trim();
}

export function candidateIdentity(candidate: PlaceCandidate) {
  const normalizedName = normalizePlaceSearchQuery(candidate.name).toLowerCase();
  const normalizedAddress = normalizePlaceSearchQuery(candidate.address_text ?? '').toLowerCase();

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

export function candidateMatchesQuery(candidate: PlaceCandidate | null, query: string) {
  if (!candidate) return false;
  const normalizedQuery = normalizePlaceSearchQuery(query).toLowerCase();
  if (!normalizedQuery) return true;
  const haystacks = [candidate.name, candidate.address_text ?? '', candidate.category ?? '']
    .map((value) => normalizePlaceSearchQuery(value).toLowerCase())
    .filter(Boolean);
  return haystacks.some((value) => value.includes(normalizedQuery));
}

export function autoResolveCandidate(candidates: PlaceCandidate[], query: string) {
  const normalizedQuery = normalizePlaceSearchQuery(query).toLowerCase();
  if (normalizedQuery.length < 3) {
    return null;
  }
  const exactMatch =
    candidates.find((candidate) =>
      [candidate.name, candidate.address_text ?? '']
        .map((value) => normalizePlaceSearchQuery(value).toLowerCase())
        .some((value) => value === normalizedQuery),
    ) ?? null;
  return exactMatch ?? candidates[0] ?? null;
}
