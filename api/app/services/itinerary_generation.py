from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Activity, ActivityCategory, Job, Place, Trip, TripDay
from app.db.repositories import (
    ActivityRepository,
    PlacePhotoRepository,
    PlaceRepository,
    TripRepository,
)
from app.errors import NotFoundError
from app.services.google_maps import (
    GoogleMapsError,
    geocode_address,
    lookup_google_place,
    search_google_places,
)
from app.services.itinerary_catalog import CatalogPlaceSeed, build_catalog_candidates
from app.services.itinerary_llm import generate_with_openrouter
from app.services.job_progress import ProgressTracker

PHOTO_ENRICHMENT_LIMIT = 6
RETRYABLE_GROUNDING_ERROR_CODES = {
    "PROVIDER_LIMITED",
    "UPSTREAM_PROVIDER_TIMEOUT",
    "UPSTREAM_PROVIDER_ERROR",
}
DESTINATION_LEVEL_PLACE_TYPES = {
    "country",
    "locality",
    "administrative_area_level_1",
    "administrative_area_level_2",
    "postal_town",
    "sublocality",
    "neighborhood",
}


class JobExecutionError(Exception):
    def __init__(self, code: str, message: str, details: dict | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


class RetryableJobError(JobExecutionError):
    pass


class NonRetryableJobError(JobExecutionError):
    pass


@dataclass
class ItineraryExecutionResult:
    summary: dict[str, int]
    day_deltas: list[dict[str, Any]]
    new_trip_version: int
    generator_engine: str | None
    llm_model: str | None
    fallback_used: bool
    provider_errors: list[dict[str, Any]]
    resolved_place_count: int
    photo_enriched_place_count: int
    unresolved_activity_count: int


@dataclass
class CandidateResolutionResult:
    candidates_by_day: dict[uuid.UUID, list[dict[str, Any]]]
    generator_engine: str
    llm_model: str | None
    fallback_used: bool
    provider_errors: list[dict[str, Any]]
    resolved_place_count: int
    photo_enriched_place_count: int
    unresolved_activity_count: int


def _normalize_title(value: str) -> str:
    return " ".join(value.lower().split())


def _candidate_category(candidate: dict[str, Any]) -> ActivityCategory:
    title = str(candidate.get("title") or "").lower()
    if any(
        token in title for token in ("breakfast", "lunch", "dinner", "cafe", "bistro", "restaurant")
    ):
        return ActivityCategory.EAT
    if any(token in title for token in ("tour", "cruise", "workshop", "experience", "show")):
        return ActivityCategory.ACTIVITY
    return ActivityCategory.VISIT


async def _load_trip_for_job(db: AsyncSession, payload: dict[str, Any]) -> Trip:
    trip_id = payload.get("trip_id")
    user_id = payload.get("user_id")
    if not trip_id or not user_id:
        raise NonRetryableJobError(
            "JOB_PAYLOAD_INVALID",
            "Job payload missing trip or user identifiers",
        )

    try:
        trip = await TripRepository.get_trip(db, uuid.UUID(user_id), uuid.UUID(trip_id))
    except NotFoundError:
        raise NonRetryableJobError("RESOURCE_NOT_FOUND", "Trip not found for job payload") from None
    return trip


async def _resolve_scope_days(
    db: AsyncSession,
    trip: Trip,
    payload: dict[str, Any],
    *,
    require_non_empty: bool = False,
) -> list[TripDay]:
    rows = await db.execute(
        select(TripDay).where(TripDay.trip_id == trip.id).order_by(TripDay.day_index)
    )
    all_days = list(rows.scalars().all())
    day_ids_raw = payload.get("day_ids")
    if day_ids_raw is None:
        return all_days

    if not isinstance(day_ids_raw, list):
        raise NonRetryableJobError("VALIDATION_ERROR", "day_ids must be a list of UUID values")

    if require_non_empty and len(day_ids_raw) == 0:
        raise NonRetryableJobError("VALIDATION_ERROR", "day_ids must be non-empty")
    if len(day_ids_raw) == 0:
        raise NonRetryableJobError("VALIDATION_ERROR", "day_ids cannot be empty")

    selected_ids: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for raw in day_ids_raw:
        day_id = uuid.UUID(str(raw))
        if day_id not in seen:
            seen.add(day_id)
            selected_ids.append(day_id)

    day_map = {day.id: day for day in all_days}
    missing = [str(day_id) for day_id in selected_ids if day_id not in day_map]
    if missing:
        raise NonRetryableJobError(
            "VALIDATION_ERROR",
            "One or more day_ids are not part of the trip",
            {"missing_day_ids": missing},
        )

    return [day_map[day_id] for day_id in selected_ids]


def _fail_mode(payload: dict[str, Any], attempts: int) -> None:
    constraints = payload.get("constraints") or {}
    if not isinstance(constraints, dict):
        raise NonRetryableJobError("VALIDATION_ERROR", "constraints must be an object")

    mode = constraints.get("force_fail")
    if mode == "retry_once" and attempts == 1:
        raise RetryableJobError("ITINERARY_TRANSIENT_FAILURE", "Injected transient failure")
    if mode == "always_retry":
        raise RetryableJobError("ITINERARY_TRANSIENT_FAILURE", "Injected transient failure")
    if mode == "always_fail":
        raise NonRetryableJobError("ITINERARY_PERMANENT_FAILURE", "Injected permanent failure")


async def _fetch_day_activities(db: AsyncSession, day_id: uuid.UUID) -> list[Activity]:
    result = await db.execute(
        select(Activity).where(Activity.trip_day_id == day_id).order_by(Activity.order_index)
    )
    return list(result.scalars().all())


async def _normalize_day(db: AsyncSession, day_id: uuid.UUID) -> None:
    rows = await _fetch_day_activities(db, day_id)
    await ActivityRepository._apply_order_for_day(db, day_id, [row.id for row in rows])


def _merge_metadata(*items: dict | None) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        for key, value in item.items():
            if value is not None:
                merged[key] = value
    return merged


def _candidate_category_from_place(
    candidate: dict[str, Any],
    *,
    place_category: str | None,
) -> ActivityCategory:
    if isinstance(place_category, str):
        category_text = place_category.lower()
        if any(token in category_text for token in ("restaurant", "cafe", "food", "bar", "bakery")):
            return ActivityCategory.EAT
        if any(token in category_text for token in ("tour", "experience", "activity", "event")):
            return ActivityCategory.ACTIVITY
    return _candidate_category(candidate)


def _provider_errors_are_retryable(provider_errors: list[dict[str, Any]]) -> bool:
    return bool(provider_errors) and all(
        str(item.get("code") or "") in RETRYABLE_GROUNDING_ERROR_CODES for item in provider_errors
    )


def _is_destination_level_google_place(details: Any) -> bool:
    category = str(getattr(details, "category", "") or "").strip().casefold()
    if category in DESTINATION_LEVEL_PLACE_TYPES:
        return True

    metadata = getattr(details, "metadata", None)
    raw_types = metadata.get("types") if isinstance(metadata, dict) else None
    if not isinstance(raw_types, list):
        return False

    normalized_types = {
        str(item).strip().casefold()
        for item in raw_types
        if isinstance(item, str) and item.strip()
    }
    return bool(normalized_types & DESTINATION_LEVEL_PLACE_TYPES)


def _raise_strict_grounding_error(
    *,
    provider_errors: list[dict[str, Any]],
    llm_model: str | None,
    unresolved_activity_count: int | None = None,
) -> None:
    details: dict[str, Any] = {"provider_errors": provider_errors}
    if llm_model:
        details["llm_model"] = llm_model
    if unresolved_activity_count is not None:
        details["unresolved_activity_count"] = unresolved_activity_count

    message = (
        "AI itinerary generation requires every activity to resolve to a Google place "
        "with a canonical Google address"
    )
    if _provider_errors_are_retryable(provider_errors):
        raise RetryableJobError("ITINERARY_GROUNDING_UPSTREAM_ERROR", message, details)
    raise NonRetryableJobError("ITINERARY_GROUNDING_REQUIRED", message, details)


async def _resolve_google_place(
    db: AsyncSession,
    *,
    google_place_id: str,
    place_cache: dict[str, Place],
) -> Place | None:
    normalized_place_id = str(google_place_id).strip()
    if not normalized_place_id:
        return None
    cached = place_cache.get(normalized_place_id)
    if cached is not None:
        return cached

    details = await lookup_google_place(normalized_place_id)
    if details is None or not details.formatted_address:
        return None
    if _is_destination_level_google_place(details):
        return None

    place = await PlaceRepository.get_or_create_external_place(
        db,
        source="google_places",
        external_id=details.place_id,
        name=details.name or details.formatted_address or details.place_id,
        category=details.category,
        address_text=details.formatted_address,
        lat=details.lat,
        lon=details.lng,
        metadata=_merge_metadata(
            details.metadata,
            {
                "country": details.country,
                "region": details.region,
                "google_place_id": details.place_id,
                "time_zone_id": details.timezone,
            },
        ),
    )
    place_cache[details.place_id] = place
    return place


async def _resolve_mock_llm_candidate_place(
    db: AsyncSession,
    *,
    candidate: dict[str, Any],
    place_cache: dict[str, Place],
) -> Place | None:
    google_place_id = str(candidate.get("google_place_id") or "").strip()
    address_text = str(candidate.get("address_text") or "").strip()
    if not google_place_id or not address_text:
        return None

    cached = place_cache.get(google_place_id)
    if cached is not None:
        return cached

    place_name = str(candidate.get("place_name") or "").strip() or address_text
    place = await PlaceRepository.get_or_create_external_place(
        db,
        source="google_places",
        external_id=google_place_id,
        name=place_name,
        category=None,
        address_text=address_text,
        lat=None,
        lon=None,
        metadata={
            "google_place_id": google_place_id,
            "mock_google_grounding": True,
        },
    )
    place_cache[google_place_id] = place
    return place


async def _resolve_llm_candidate_place(
    db: AsyncSession,
    *,
    candidate: dict[str, Any],
    place_cache: dict[str, Place],
) -> Place | None:
    google_place_id = candidate.get("google_place_id")
    if not isinstance(google_place_id, str) or not google_place_id.strip():
        return None
    return await _resolve_google_place(
        db,
        google_place_id=google_place_id,
        place_cache=place_cache,
    )


def _catalog_queries_for_seed(trip: Trip, place_seed: CatalogPlaceSeed) -> list[str]:
    destination = " ".join(str(trip.destination_text or "").split())
    raw_queries = [
        (
            f"{place_seed.name} {place_seed.address_text}"
            if place_seed.name and place_seed.address_text
            else None
        ),
        place_seed.address_text,
        (
            place_seed.name
            if not destination or destination.lower() in place_seed.name.lower()
            else f"{place_seed.name} {destination}"
        )
        if place_seed.name
        else None,
        place_seed.name,
    ]

    queries: list[str] = []
    seen: set[str] = set()
    for item in raw_queries:
        if not isinstance(item, str):
            continue
        query = " ".join(item.split())
        if not query:
            continue
        dedupe_key = query.casefold()
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        queries.append(query)
    return queries


async def _resolve_catalog_seed_place(
    db: AsyncSession,
    *,
    trip: Trip,
    place_seed: CatalogPlaceSeed,
    place_cache: dict[str, Place],
) -> Place | None:
    if place_seed.address_text:
        geocode = await geocode_address(place_seed.address_text)
        if geocode and geocode.place_id:
            place = await _resolve_google_place(
                db,
                google_place_id=geocode.place_id,
                place_cache=place_cache,
            )
            if place is not None:
                return place

    radius_m = 2500 if place_seed.lat is not None and place_seed.lon is not None else None
    for query in _catalog_queries_for_seed(trip, place_seed):
        results = await search_google_places(
            query,
            3,
            lat=place_seed.lat,
            lng=place_seed.lon,
            radius_m=radius_m,
        )
        for result in results:
            place = await _resolve_google_place(
                db,
                google_place_id=result.place_id,
                place_cache=place_cache,
            )
            if place is not None:
                return place

    return None


async def _enrich_places_with_photos(
    db: AsyncSession,
    *,
    place_ids: set[uuid.UUID],
    limit: int,
) -> tuple[int, list[dict[str, Any]]]:
    if not place_ids:
        return 0, []

    provider_errors: list[dict[str, Any]] = []
    photo_summaries = await PlacePhotoRepository.photo_summaries_for_place_ids(
        db,
        list(place_ids),
    )
    candidate_ids = [
        place_id for place_id in place_ids if photo_summaries.get(place_id, (0, None))[0] == 0
    ][:limit]
    if not candidate_ids:
        return 0, provider_errors

    rows = await db.execute(select(Place).where(Place.id.in_(candidate_ids)))
    places_by_id = {place.id: place for place in rows.scalars().all()}

    from app.services.place_photos import _fetch_place_photos

    enriched = 0
    for place_id in candidate_ids:
        place = places_by_id.get(place_id)
        if place is None:
            continue

        provider_name, photos, errors = await _fetch_place_photos(place)
        provider_errors.extend(errors)
        if not provider_name or not photos:
            continue

        await PlacePhotoRepository.replace_photos(db, place_id=place.id, items=photos[:8])
        enriched += 1

    return enriched, provider_errors


async def _resolve_catalog_candidates_for_scope(
    db: AsyncSession,
    *,
    trip: Trip,
    days: list[TripDay],
    seed: int | None,
    constraints: dict[str, Any],
    progress: ProgressTracker | None = None,
) -> CandidateResolutionResult:
    raw_candidates = build_catalog_candidates(trip=trip, days=days, seed=seed)
    place_cache: dict[str, Place] = {}
    resolved_place_ids: set[uuid.UUID] = set()
    provider_errors: list[dict[str, Any]] = []
    unresolved_activity_count = 0
    resolved_candidates: dict[uuid.UUID, list[dict[str, Any]]] = {}

    for day in days:
        resolved_rows: list[dict[str, Any]] = []
        for candidate in raw_candidates.get(day.id, []):
            place_seed = candidate.get("place_seed")
            if not isinstance(place_seed, CatalogPlaceSeed):
                provider_errors.append(
                    {
                        "provider": "catalog",
                        "code": "PLACE_SEED_MISSING",
                        "message": "Deterministic fallback candidate is missing a place seed",
                        "details": {"title": candidate.get("title")},
                    }
                )
                unresolved_activity_count += 1
                continue

            try:
                place = await _resolve_catalog_seed_place(
                    db,
                    trip=trip,
                    place_seed=place_seed,
                    place_cache=place_cache,
                )
            except GoogleMapsError as exc:
                provider_errors.append(
                    {
                        "provider": "google_maps",
                        "code": "UPSTREAM_PROVIDER_ERROR",
                        "message": "Google grounding failed for deterministic fallback",
                        "details": {
                            "error": str(exc),
                            "title": candidate.get("title"),
                            "place_name": place_seed.name,
                            "address_text": place_seed.address_text,
                        },
                    }
                )
                unresolved_activity_count += 1
                continue

            if place is None:
                provider_errors.append(
                    {
                        "provider": "google_maps",
                        "code": "PLACE_NOT_FOUND",
                        "message": "Deterministic fallback could not resolve a canonical Google address",
                        "details": {
                            "title": candidate.get("title"),
                            "place_name": place_seed.name,
                            "address_text": place_seed.address_text,
                        },
                    }
                )
                unresolved_activity_count += 1
                continue

            next_row = {key: value for key, value in candidate.items() if key != "place_seed"}
            next_row["place_id"] = place.id
            next_row["category"] = _candidate_category_from_place(
                candidate,
                place_category=place.category,
            )
            resolved_rows.append(next_row)
            resolved_place_ids.add(place.id)
        resolved_candidates[day.id] = resolved_rows

    photo_enriched_place_count = 0
    if unresolved_activity_count == 0:
        photo_limit_raw = constraints.get("photo_enrichment_limit")
        photo_limit = PHOTO_ENRICHMENT_LIMIT
        if isinstance(photo_limit_raw, int):
            photo_limit = max(0, min(photo_limit_raw, PHOTO_ENRICHMENT_LIMIT))

        if progress and resolved_place_ids:
            await progress.step(
                "Fetching photos",
                f"{len(resolved_place_ids)} places",
                phase="photo_enrichment",
            )
        photo_enriched_place_count, photo_errors = await _enrich_places_with_photos(
            db,
            place_ids=resolved_place_ids,
            limit=photo_limit,
        )
        provider_errors.extend(photo_errors)

    return CandidateResolutionResult(
        candidates_by_day=resolved_candidates,
        generator_engine="deterministic_google_grounded",
        llm_model=None,
        fallback_used=False,
        provider_errors=provider_errors,
        resolved_place_count=len(resolved_place_ids),
        photo_enriched_place_count=photo_enriched_place_count,
        unresolved_activity_count=unresolved_activity_count,
    )


async def _resolve_llm_candidates_for_scope(
    db: AsyncSession,
    *,
    trip: Trip,
    days: list[TripDay],
    candidates_by_day: dict[uuid.UUID, list[dict[str, Any]]],
    llm_model: str | None,
    constraints: dict[str, Any],
    progress: ProgressTracker | None = None,
) -> CandidateResolutionResult:
    place_cache: dict[str, Place] = {}
    resolved_place_ids: set[uuid.UUID] = set()
    provider_errors: list[dict[str, Any]] = []
    unresolved_activity_count = 0
    resolved_candidates: dict[uuid.UUID, list[dict[str, Any]]] = {}
    llm_mock_mode = str(constraints.get("llm_mock_mode", "")).strip().lower()

    for day in days:
        day_candidates = candidates_by_day.get(day.id, [])
        resolved_rows: list[dict[str, Any]] = []
        for candidate in day_candidates:
            google_place_id = str(candidate.get("google_place_id") or "").strip()
            if not google_place_id:
                provider_errors.append(
                    {
                        "provider": "google_maps",
                        "code": "MISSING_GOOGLE_PLACE_ID",
                        "message": "Generated activity is missing a Google place ID",
                        "details": {
                            "title": candidate.get("title"),
                            "place_query": candidate.get("place_query"),
                        },
                    }
                )
                unresolved_activity_count += 1
                continue
            try:
                if llm_mock_mode == "success":
                    place = await _resolve_mock_llm_candidate_place(
                        db,
                        candidate=candidate,
                        place_cache=place_cache,
                    )
                else:
                    place = await _resolve_llm_candidate_place(
                        db,
                        candidate=candidate,
                        place_cache=place_cache,
                    )
            except GoogleMapsError as exc:
                provider_errors.append(
                    {
                        "provider": "google_maps",
                        "code": "UPSTREAM_PROVIDER_ERROR",
                        "message": "Google place grounding failed",
                        "details": {
                            "error": str(exc),
                            "title": candidate.get("title"),
                            "place_query": candidate.get("place_query"),
                        },
                    }
                )
                unresolved_activity_count += 1
                continue

            if place is None:
                provider_errors.append(
                    {
                        "provider": "google_maps",
                        "code": "PLACE_NOT_FOUND",
                        "message": "Google place grounding did not return a canonical address",
                        "details": {
                            "title": candidate.get("title"),
                            "place_query": candidate.get("place_query"),
                            "google_place_id": google_place_id,
                        },
                    }
                )
                unresolved_activity_count += 1
                continue

            next_row = dict(candidate)
            next_row["place_id"] = place.id
            next_row["category"] = _candidate_category_from_place(
                candidate,
                place_category=place.category,
            )
            resolved_rows.append(next_row)
            resolved_place_ids.add(place.id)
        resolved_candidates[day.id] = resolved_rows

    photo_enriched_place_count = 0
    if unresolved_activity_count == 0:
        photo_limit_raw = constraints.get("photo_enrichment_limit")
        photo_limit = PHOTO_ENRICHMENT_LIMIT
        if isinstance(photo_limit_raw, int):
            photo_limit = max(0, min(photo_limit_raw, PHOTO_ENRICHMENT_LIMIT))

        if progress and resolved_place_ids:
            await progress.step(
                "Fetching photos",
                f"{len(resolved_place_ids)} places",
                phase="photo_enrichment",
            )
        photo_enriched_place_count, photo_errors = await _enrich_places_with_photos(
            db,
            place_ids=resolved_place_ids,
            limit=photo_limit,
        )
        provider_errors.extend(photo_errors)

    return CandidateResolutionResult(
        candidates_by_day=resolved_candidates,
        generator_engine="llm_google_grounded",
        llm_model=llm_model,
        fallback_used=False,
        provider_errors=provider_errors,
        resolved_place_count=len(resolved_place_ids),
        photo_enriched_place_count=photo_enriched_place_count,
        unresolved_activity_count=unresolved_activity_count,
    )


async def _resolve_candidates_for_scope(
    db: AsyncSession,
    *,
    trip: Trip,
    days: list[TripDay],
    seed: int | None,
    constraints: dict[str, Any],
    progress: ProgressTracker | None = None,
) -> CandidateResolutionResult:
    llm_call_id: str | None = None
    if progress:
        llm_call_id = await progress.tool_call(
            "generate_with_llm",
            {
                "destination": str(trip.destination_text or ""),
                "num_days": len(days),
            },
            phase="llm",
        )

    llm_result = await generate_with_openrouter(
        trip=trip,
        days=days,
        seed=seed,
        constraints=constraints,
        progress=progress,
    )
    llm_errors = list(llm_result.errors)
    accumulated_errors = list(llm_errors)

    if progress:
        if llm_result.success:
            candidates_count = sum(len(v) for v in llm_result.candidates_by_day.values())
            await progress.tool_result(
                "generate_with_llm",
                {
                    "success": True,
                    "model": llm_result.model,
                    "candidates": candidates_count,
                },
                call_id=llm_call_id,
                phase="llm",
            )
        else:
            await progress.tool_result(
                "generate_with_llm",
                {"success": False, "model": llm_result.model},
                is_error=True,
                call_id=llm_call_id,
                phase="llm",
            )

    if llm_result.success:
        if progress:
            await progress.step(
                "Grounding activities",
                "Resolving places via Google Maps",
                phase="grounding",
            )

        llm_resolution = await _resolve_llm_candidates_for_scope(
            db,
            trip=trip,
            days=days,
            candidates_by_day=llm_result.candidates_by_day,
            llm_model=llm_result.model,
            constraints=constraints,
            progress=progress,
        )
        llm_resolution.provider_errors = llm_errors + llm_resolution.provider_errors
        if llm_resolution.unresolved_activity_count == 0:
            return llm_resolution
        accumulated_errors = llm_resolution.provider_errors

    _raise_strict_grounding_error(
        provider_errors=accumulated_errors,
        llm_model=llm_result.model,
    )
    raise AssertionError("unreachable")


async def _apply_replace(
    db: AsyncSession,
    *,
    days: list[TripDay],
    job_id: uuid.UUID,
    candidates_by_day: dict[uuid.UUID, list[dict[str, Any]]],
) -> tuple[dict[str, int], list[dict[str, Any]]]:
    summary = {"created": 0, "updated": 0, "skipped": 0, "deleted": 0}
    deltas: list[dict[str, Any]] = []

    for day in days:
        existing = await _fetch_day_activities(db, day.id)
        generated = [row for row in existing if row.source == "generated"]
        for row in generated:
            await db.delete(row)
        await db.flush()

        manual_rows = await _fetch_day_activities(db, day.id)
        manual_ids = [row.id for row in manual_rows]
        await ActivityRepository._apply_order_for_day(db, day.id, manual_ids)

        candidates = candidates_by_day.get(day.id, [])
        next_index = len(manual_ids)
        for candidate in candidates:
            db.add(
                Activity(
                    trip_id=day.trip_id,
                    trip_day_id=day.id,
                    order_index=next_index,
                    category=candidate.get("category", ActivityCategory.VISIT),
                    category_details_json={},
                    title=candidate["title"],
                    description=candidate["description"],
                    start_time=candidate["start_time"],
                    duration_min=candidate["duration_min"],
                    estimated_cost_amount=candidate.get("estimated_cost_amount"),
                    estimated_cost_currency=candidate.get("estimated_cost_currency"),
                    place_id=candidate.get("place_id"),
                    event_snapshot_id=candidate.get("event_snapshot_id"),
                    source="generated",
                    generation_batch_id=job_id,
                )
            )
            next_index += 1
            summary["created"] += 1

        summary["deleted"] += len(generated)
        deltas.append(
            {
                "day_id": str(day.id),
                "deleted_generated": len(generated),
                "created_generated": len(candidates),
                "updated_generated": 0,
                "skipped_generated": 0,
            }
        )

    return summary, deltas


async def _apply_merge(
    db: AsyncSession,
    *,
    days: list[TripDay],
    job_id: uuid.UUID,
    candidates_by_day: dict[uuid.UUID, list[dict[str, Any]]],
) -> tuple[dict[str, int], list[dict[str, Any]]]:
    summary = {"created": 0, "updated": 0, "skipped": 0, "deleted": 0}
    deltas: list[dict[str, Any]] = []

    for day in days:
        existing = await _fetch_day_activities(db, day.id)
        existing_generated = {
            _normalize_title(row.title): row for row in existing if row.source == "generated"
        }
        existing_all = {_normalize_title(row.title) for row in existing}
        candidates = candidates_by_day.get(day.id, [])

        created_day = 0
        updated_day = 0
        skipped_day = 0
        next_index = len(existing)

        for candidate in candidates:
            normalized = _normalize_title(candidate["title"])
            if normalized in existing_generated:
                row = existing_generated[normalized]
                row.title = candidate["title"]
                row.description = candidate["description"]
                row.start_time = candidate["start_time"]
                row.duration_min = candidate["duration_min"]
                row.category = candidate.get("category", ActivityCategory.VISIT)
                row.category_details_json = {}
                row.estimated_cost_amount = candidate.get("estimated_cost_amount")
                row.estimated_cost_currency = candidate.get("estimated_cost_currency")
                row.place_id = candidate.get("place_id")
                row.event_snapshot_id = candidate.get("event_snapshot_id")
                row.generation_batch_id = job_id
                row.source = "generated"
                summary["updated"] += 1
                updated_day += 1
                continue

            if normalized in existing_all:
                summary["skipped"] += 1
                skipped_day += 1
                continue

            db.add(
                Activity(
                    trip_id=day.trip_id,
                    trip_day_id=day.id,
                    order_index=next_index,
                    category=candidate.get("category", ActivityCategory.VISIT),
                    category_details_json={},
                    title=candidate["title"],
                    description=candidate["description"],
                    start_time=candidate["start_time"],
                    duration_min=candidate["duration_min"],
                    estimated_cost_amount=candidate.get("estimated_cost_amount"),
                    estimated_cost_currency=candidate.get("estimated_cost_currency"),
                    place_id=candidate.get("place_id"),
                    event_snapshot_id=candidate.get("event_snapshot_id"),
                    source="generated",
                    generation_batch_id=job_id,
                )
            )
            next_index += 1
            existing_all.add(normalized)
            summary["created"] += 1
            created_day += 1

        deltas.append(
            {
                "day_id": str(day.id),
                "deleted_generated": 0,
                "created_generated": created_day,
                "updated_generated": updated_day,
                "skipped_generated": skipped_day,
            }
        )

    return summary, deltas


async def _apply_append(
    db: AsyncSession,
    *,
    days: list[TripDay],
    job_id: uuid.UUID,
    candidates_by_day: dict[uuid.UUID, list[dict[str, Any]]],
) -> tuple[dict[str, int], list[dict[str, Any]]]:
    summary = {"created": 0, "updated": 0, "skipped": 0, "deleted": 0}
    deltas: list[dict[str, Any]] = []

    for day in days:
        existing = await _fetch_day_activities(db, day.id)
        existing_all = {_normalize_title(row.title) for row in existing}
        candidates = candidates_by_day.get(day.id, [])

        created_day = 0
        skipped_day = 0
        next_index = len(existing)

        for candidate in candidates:
            normalized = _normalize_title(candidate["title"])
            if normalized in existing_all:
                summary["skipped"] += 1
                skipped_day += 1
                continue

            db.add(
                Activity(
                    trip_id=day.trip_id,
                    trip_day_id=day.id,
                    order_index=next_index,
                    category=candidate.get("category", ActivityCategory.VISIT),
                    category_details_json={},
                    title=candidate["title"],
                    description=candidate["description"],
                    start_time=candidate["start_time"],
                    duration_min=candidate["duration_min"],
                    estimated_cost_amount=candidate.get("estimated_cost_amount"),
                    estimated_cost_currency=candidate.get("estimated_cost_currency"),
                    place_id=candidate.get("place_id"),
                    event_snapshot_id=candidate.get("event_snapshot_id"),
                    source="generated",
                    generation_batch_id=job_id,
                )
            )
            next_index += 1
            existing_all.add(normalized)
            summary["created"] += 1
            created_day += 1

        deltas.append(
            {
                "day_id": str(day.id),
                "deleted_generated": 0,
                "created_generated": created_day,
                "updated_generated": 0,
                "skipped_generated": skipped_day,
            }
        )

    return summary, deltas


async def _apply_reset(
    db: AsyncSession,
    *,
    days: list[TripDay],
) -> tuple[dict[str, int], list[dict[str, Any]]]:
    summary = {"created": 0, "updated": 0, "skipped": 0, "deleted": 0}
    deltas: list[dict[str, Any]] = []

    for day in days:
        existing = await _fetch_day_activities(db, day.id)
        generated = [row for row in existing if row.source == "generated"]
        for row in generated:
            await db.delete(row)
        await db.flush()
        await _normalize_day(db, day.id)

        summary["deleted"] += len(generated)
        deltas.append(
            {
                "day_id": str(day.id),
                "deleted_generated": len(generated),
                "created_generated": 0,
                "updated_generated": 0,
                "skipped_generated": 0,
            }
        )

    return summary, deltas


async def execute_itinerary_job(
    db: AsyncSession,
    job: Job,
    progress: ProgressTracker | None = None,
) -> ItineraryExecutionResult:
    payload = job.payload_json
    if not isinstance(payload, dict):
        raise NonRetryableJobError("JOB_PAYLOAD_INVALID", "Job payload must be an object")

    trip = await _load_trip_for_job(db, payload)

    if progress:
        await progress.step("Loaded trip", str(trip.destination_text or ""), phase="setup")

    expected_version = payload.get("expected_trip_version")
    if expected_version is None:
        raise NonRetryableJobError(
            "JOB_PAYLOAD_INVALID",
            "expected_trip_version is required in job payload",
        )
    if trip.version != int(expected_version):
        raise NonRetryableJobError(
            "CONFLICT_VERSION_MISMATCH",
            "Trip version mismatch at execution time",
            {"latest_version": trip.version, "expected_version": int(expected_version)},
        )

    _fail_mode(payload, job.attempts)

    seed_raw = payload.get("seed")
    seed = int(seed_raw) if seed_raw is not None else None
    mode = payload.get("mode")

    if job.job_type == "itinerary.reset":
        scope_days = await _resolve_scope_days(db, trip, payload, require_non_empty=True)
        if progress:
            await progress.step(
                "Resetting activities",
                f"{len(scope_days)} days",
                phase="apply",
            )
        summary, deltas = await _apply_reset(db, days=scope_days)
        trip.generation_state = "RESET"
        generator_engine = None
        llm_model = None
        fallback_used = False
        provider_errors: list[dict[str, Any]] = []
        resolved_place_count = 0
        photo_enriched_place_count = 0
        unresolved_activity_count = 0
    else:
        scope_days = await _resolve_scope_days(db, trip, payload, require_non_empty=False)
        constraints = (
            payload.get("constraints") if isinstance(payload.get("constraints"), dict) else {}
        )
        if progress:
            await progress.step(
                "Planning itinerary",
                f"{len(scope_days)} day{'s' if len(scope_days) != 1 else ''} · {str(mode)} mode",
                phase="planning",
            )
        candidate_resolution = await _resolve_candidates_for_scope(
            db,
            trip=trip,
            days=scope_days,
            seed=seed,
            constraints=constraints,
            progress=progress,
        )
        if progress:
            await progress.step(
                "Applying to itinerary",
                f"{candidate_resolution.resolved_place_count} places resolved"
                + (
                    f" · {candidate_resolution.photo_enriched_place_count} photos enriched"
                    if candidate_resolution.photo_enriched_place_count
                    else ""
                ),
                phase="apply",
            )
        if mode == "replace":
            summary, deltas = await _apply_replace(
                db,
                days=scope_days,
                job_id=job.id,
                candidates_by_day=candidate_resolution.candidates_by_day,
            )
        elif mode == "merge":
            summary, deltas = await _apply_merge(
                db,
                days=scope_days,
                job_id=job.id,
                candidates_by_day=candidate_resolution.candidates_by_day,
            )
        elif mode == "append":
            summary, deltas = await _apply_append(
                db,
                days=scope_days,
                job_id=job.id,
                candidates_by_day=candidate_resolution.candidates_by_day,
            )
        else:
            raise NonRetryableJobError("VALIDATION_ERROR", "Unsupported generation mode")

        generator_engine = candidate_resolution.generator_engine
        llm_model = candidate_resolution.llm_model
        fallback_used = candidate_resolution.fallback_used
        provider_errors = candidate_resolution.provider_errors
        resolved_place_count = candidate_resolution.resolved_place_count
        photo_enriched_place_count = candidate_resolution.photo_enriched_place_count
        unresolved_activity_count = candidate_resolution.unresolved_activity_count
        trip.last_generated_at = datetime.now(UTC)
        trip.generation_state = "READY"

    await db.flush()
    new_version = await TripRepository.bump_version(db, trip.id)
    await db.flush()

    return ItineraryExecutionResult(
        summary=summary,
        day_deltas=deltas,
        new_trip_version=new_version,
        generator_engine=generator_engine,
        llm_model=llm_model,
        fallback_used=fallback_used,
        provider_errors=provider_errors,
        resolved_place_count=resolved_place_count,
        photo_enriched_place_count=photo_enriched_place_count,
        unresolved_activity_count=unresolved_activity_count,
    )
