from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Activity, Job, Place, Trip, TripDay
from app.db.repositories import (
    ActivityRepository,
    PlacePhotoRepository,
    PlaceRepository,
    TripRepository,
)
from app.models.places import PlaceCreateRequest
from app.services.itinerary_catalog import CatalogPlaceSeed, build_catalog_candidates

PHOTO_ENRICHMENT_LIMIT = 6


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


def _seed_external_id(trip: Trip, place_seed: CatalogPlaceSeed) -> str:
    destination_key = " ".join(trip.destination_text.lower().split())
    return f"planner-seed:{destination_key}:{place_seed.slug}"


async def _load_trip_for_job(db: AsyncSession, payload: dict[str, Any]) -> Trip:
    trip_id = payload.get("trip_id")
    user_id = payload.get("user_id")
    if not trip_id or not user_id:
        raise NonRetryableJobError(
            "JOB_PAYLOAD_INVALID",
            "Job payload missing trip or user identifiers",
        )

    result = await db.execute(
        select(Trip).where(Trip.id == uuid.UUID(trip_id)).where(Trip.user_id == uuid.UUID(user_id))
    )
    trip = result.scalar_one_or_none()
    if not trip:
        raise NonRetryableJobError("RESOURCE_NOT_FOUND", "Trip not found for job payload")
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


async def _resolve_place_seed(
    db: AsyncSession,
    *,
    trip: Trip,
    place_seed: CatalogPlaceSeed,
    place_cache: dict[str, Place],
) -> Place | None:
    external_id = _seed_external_id(trip, place_seed)
    cached = place_cache.get(external_id)
    if cached is not None:
        return cached

    matched = await PlaceRepository.find_seed_match(
        db,
        name=place_seed.name,
        address_text=place_seed.address_text,
        lat=place_seed.lat,
        lon=place_seed.lon,
    )
    if matched is not None:
        place_cache[external_id] = matched
        return matched

    created = await PlaceRepository.create_place(
        db,
        PlaceCreateRequest(
            source="seed",
            external_id=external_id,
            name=place_seed.name,
            category=place_seed.category,
            address_text=place_seed.address_text,
            lat=place_seed.lat,
            lon=place_seed.lon,
            metadata={
                **place_seed.metadata,
                "planner_seed_slug": place_seed.slug,
                "planner_destination": trip.destination_text,
            },
        ),
    )
    place_cache[external_id] = created
    return created


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
        place_id
        for place_id in place_ids
        if photo_summaries.get(place_id, (0, None))[0] == 0
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


async def _resolve_candidates_for_scope(
    db: AsyncSession,
    *,
    trip: Trip,
    days: list[TripDay],
    seed: int | None,
    constraints: dict[str, Any],
) -> CandidateResolutionResult:
    raw_candidates = build_catalog_candidates(trip=trip, days=days, seed=seed)
    place_cache: dict[str, Place] = {}
    resolved_place_ids: set[uuid.UUID] = set()
    unresolved_activity_count = 0
    resolved_candidates: dict[uuid.UUID, list[dict[str, Any]]] = {}

    for day in days:
        resolved_rows: list[dict[str, Any]] = []
        for candidate in raw_candidates.get(day.id, []):
            next_row = {key: value for key, value in candidate.items() if key != "place_seed"}
            place_seed = candidate.get("place_seed")
            if isinstance(place_seed, CatalogPlaceSeed):
                place = await _resolve_place_seed(
                    db,
                    trip=trip,
                    place_seed=place_seed,
                    place_cache=place_cache,
                )
                if place is not None:
                    next_row["place_id"] = place.id
                    resolved_place_ids.add(place.id)
                else:
                    unresolved_activity_count += 1
                    next_row["place_id"] = None
            else:
                unresolved_activity_count += 1
                next_row["place_id"] = None
            resolved_rows.append(next_row)
        resolved_candidates[day.id] = resolved_rows

    photo_limit_raw = constraints.get("photo_enrichment_limit")
    photo_limit = PHOTO_ENRICHMENT_LIMIT
    if isinstance(photo_limit_raw, int):
        photo_limit = max(0, min(photo_limit_raw, PHOTO_ENRICHMENT_LIMIT))

    photo_enriched_place_count, provider_errors = await _enrich_places_with_photos(
        db,
        place_ids=resolved_place_ids,
        limit=photo_limit,
    )

    return CandidateResolutionResult(
        candidates_by_day=resolved_candidates,
        generator_engine="deterministic_place_backed",
        llm_model=None,
        fallback_used=False,
        provider_errors=provider_errors,
        resolved_place_count=len(resolved_place_ids),
        photo_enriched_place_count=photo_enriched_place_count,
        unresolved_activity_count=unresolved_activity_count,
    )


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
                    trip_day_id=day.id,
                    order_index=next_index,
                    title=candidate["title"],
                    description=candidate["description"],
                    start_time=candidate["start_time"],
                    duration_min=candidate["duration_min"],
                    tags_json=candidate["tags_json"],
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
                row.tags_json = candidate["tags_json"]
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
                    trip_day_id=day.id,
                    order_index=next_index,
                    title=candidate["title"],
                    description=candidate["description"],
                    start_time=candidate["start_time"],
                    duration_min=candidate["duration_min"],
                    tags_json=candidate["tags_json"],
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
                    trip_day_id=day.id,
                    order_index=next_index,
                    title=candidate["title"],
                    description=candidate["description"],
                    start_time=candidate["start_time"],
                    duration_min=candidate["duration_min"],
                    tags_json=candidate["tags_json"],
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


async def execute_itinerary_job(db: AsyncSession, job: Job) -> ItineraryExecutionResult:
    payload = job.payload_json
    if not isinstance(payload, dict):
        raise NonRetryableJobError("JOB_PAYLOAD_INVALID", "Job payload must be an object")

    trip = await _load_trip_for_job(db, payload)
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
        constraints = payload.get("constraints") if isinstance(payload.get("constraints"), dict) else {}
        candidate_resolution = await _resolve_candidates_for_scope(
            db,
            trip=trip,
            days=scope_days,
            seed=seed,
            constraints=constraints,
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
