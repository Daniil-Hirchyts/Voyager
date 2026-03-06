from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, time
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Activity, Job, Trip, TripDay
from app.db.repositories import ActivityRepository, TripRepository
from app.db.session import redis_client
from app.metrics import increment_itinerary_llm_metric
from app.services.itinerary_llm import generate_with_openrouter


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


def _normalize_title(value: str) -> str:
    return " ".join(value.lower().split())


def _pick(pool: list[str], key: str) -> str:
    if not pool:
        return ""
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    idx = int(digest[:8], 16) % len(pool)
    return pool[idx]


def _slot_templates(slot: str) -> list[str]:
    if slot == "morning":
        return [
            "Walk through {destination}",
            "Local breakfast and street exploration in {destination}",
            "Visit a signature landmark in {destination}",
        ]
    if slot == "afternoon":
        return [
            "Museum or cultural stop focused on {preference}",
            "Neighborhood discovery around {destination}",
            "Scenic route and photo stops in {destination}",
        ]
    return [
        "Dinner plan around {preference}",
        "Sunset viewpoint and relaxed stroll in {destination}",
        "Evening local experience in {destination}",
    ]


def _build_deterministic_candidates(
    *,
    trip: Trip,
    day: TripDay,
    seed: int | None,
) -> list[dict[str, Any]]:
    destination = trip.destination_text.split(",")[0].strip()
    preferences = [p for p in trip.preferences_json if isinstance(p, str)]
    if not preferences:
        preferences = ["local highlights"]

    slots: list[tuple[str, time, int]] = [
        ("morning", time(9, 0), 120),
        ("afternoon", time(13, 30), 150),
        ("evening", time(19, 0), 120),
    ]

    base_seed = seed if seed is not None else 0
    rows: list[dict[str, Any]] = []
    for slot_idx, (slot_name, start_time, duration_min) in enumerate(slots):
        preference = preferences[(day.day_index + slot_idx) % len(preferences)]
        key = (
            f"{trip.id}:{trip.trip_type}:{destination}:{preference}:"
            f"{day.day_index}:{slot_idx}:{base_seed}"
        )
        template = _pick(_slot_templates(slot_name), key)
        title = template.format(destination=destination, preference=preference)
        description = (
            f"Generated {slot_name} suggestion for day {day.day_index + 1} focused on {preference}."
        )
        rows.append(
            {
                "title": title,
                "description": description,
                "start_time": start_time,
                "duration_min": duration_min,
                "tags_json": [slot_name, preference],
            }
        )
    return rows


def _build_deterministic_candidates_for_scope(
    *,
    trip: Trip,
    days: list[TripDay],
    seed: int | None,
) -> dict[uuid.UUID, list[dict[str, Any]]]:
    return {day.id: _build_deterministic_candidates(trip=trip, day=day, seed=seed) for day in days}


@dataclass
class CandidateResolutionResult:
    candidates_by_day: dict[uuid.UUID, list[dict[str, Any]]]
    generator_engine: str
    llm_model: str | None
    fallback_used: bool
    provider_errors: list[dict[str, Any]]


async def _resolve_candidates_for_scope(
    *,
    trip: Trip,
    days: list[TripDay],
    seed: int | None,
    constraints: dict[str, Any],
) -> CandidateResolutionResult:
    llm_result = await generate_with_openrouter(
        trip=trip,
        days=days,
        seed=seed,
        constraints=constraints,
    )
    if llm_result.success:
        return CandidateResolutionResult(
            candidates_by_day=llm_result.candidates_by_day,
            generator_engine="openrouter",
            llm_model=llm_result.model,
            fallback_used=False,
            provider_errors=llm_result.errors,
        )

    fallback_used = llm_result.attempted
    if fallback_used:
        await increment_itinerary_llm_metric(redis_client, "fallback")

    return CandidateResolutionResult(
        candidates_by_day=_build_deterministic_candidates_for_scope(
            trip=trip,
            days=days,
            seed=seed,
        ),
        generator_engine="deterministic",
        llm_model=None,
        fallback_used=fallback_used,
        provider_errors=llm_result.errors,
    )


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
    else:
        scope_days = await _resolve_scope_days(db, trip, payload, require_non_empty=False)
        constraints = payload.get("constraints") if isinstance(payload.get("constraints"), dict) else {}
        candidate_resolution = await _resolve_candidates_for_scope(
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
    )
