from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Job, Trip, TripDay
from app.db.repositories import EventRepository, PlaceRepository
from app.db.session import redis_client
from app.rate_limit.limiter import enforce_limit
from app.services.events_provider import (
    EventProviderLimitedError,
    EventProviderNonRetryableError,
    EventProviderRetryableError,
    get_provider,
    resolve_provider_availability,
    resolve_provider_order,
)
from app.services.itinerary_generation import NonRetryableJobError, RetryableJobError


@dataclass
class EventsExecutionResult:
    summary: dict[str, int]
    event_ids: list[str]
    errors: list[dict[str, Any]]


def _as_uuid(value: Any, *, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise NonRetryableJobError("JOB_PAYLOAD_INVALID", f"{field} must be a valid UUID") from exc


def _candidate_local_date(candidate: dict[str, Any]) -> date | None:
    raw = candidate.get("local_date")
    if isinstance(raw, date):
        return raw
    if isinstance(raw, str):
        try:
            return date.fromisoformat(raw)
        except ValueError:
            return None
    return None


def _resolve_matched_day_id(
    *,
    candidate: dict[str, Any],
    scope_day_by_date: dict[date, uuid.UUID],
    resolved_trip_day_id: uuid.UUID | None,
) -> uuid.UUID | None:
    if resolved_trip_day_id is not None:
        return resolved_trip_day_id
    local_date = _candidate_local_date(candidate)
    if local_date is not None:
        return scope_day_by_date.get(local_date)
    start_at = candidate.get("start_at")
    if isinstance(start_at, datetime):
        return scope_day_by_date.get(start_at.date())
    return None


async def _assert_trip_owner(db: AsyncSession, *, trip_id: uuid.UUID, user_id: uuid.UUID) -> Trip:
    row = await db.execute(select(Trip).where(Trip.id == trip_id).where(Trip.user_id == user_id))
    trip = row.scalar_one_or_none()
    if not trip:
        raise NonRetryableJobError("RESOURCE_NOT_FOUND", "Trip not found for events job")
    return trip


async def _resolve_scope_days(
    db: AsyncSession,
    *,
    trip_id: uuid.UUID,
    day_ids_raw: list[str] | list[uuid.UUID] | None,
) -> dict[uuid.UUID, TripDay]:
    rows = await db.execute(
        select(TripDay).where(TripDay.trip_id == trip_id).order_by(TripDay.day_index.asc())
    )
    days = list(rows.scalars().all())
    day_map = {day.id: day for day in days}
    if day_ids_raw is None:
        return day_map

    resolved_ids: list[uuid.UUID] = []
    for raw in day_ids_raw:
        day_id = _as_uuid(raw, field="day_ids")
        if day_id not in day_map:
            raise NonRetryableJobError(
                "VALIDATION_ERROR",
                "One or more day_ids are not part of the trip",
                {"day_id": str(day_id)},
            )
        if day_id not in resolved_ids:
            resolved_ids.append(day_id)
    return {day_id: day_map[day_id] for day_id in resolved_ids}


async def execute_events_search_job(db: AsyncSession, job: Job) -> EventsExecutionResult:
    payload = job.payload_json if isinstance(job.payload_json, dict) else {}
    trip_id = _as_uuid(payload.get("trip_id"), field="trip_id")
    user_id = _as_uuid(payload.get("user_id"), field="user_id")
    await _assert_trip_owner(db, trip_id=trip_id, user_id=user_id)

    request = payload.get("request")
    if not isinstance(request, dict):
        raise NonRetryableJobError("JOB_PAYLOAD_INVALID", "request payload must be an object")

    trip_day_id = request.get("trip_day_id")
    resolved_trip_day_id = _as_uuid(trip_day_id, field="trip_day_id") if trip_day_id else None
    scope_days = await _resolve_scope_days(db, trip_id=trip_id, day_ids_raw=request.get("day_ids"))
    scope_day_by_date = {day.date: day.id for day in scope_days.values()}

    availability = resolve_provider_availability(payload.get("providers"))
    if not availability.configured:
        missing_vars = sorted(
            {
                env_name
                for item in availability.unavailable
                for env_name in item.get("details", {}).get("missing_env_vars", [])
            }
        )
        raise NonRetryableJobError(
            "INTEGRATION_NOT_CONFIGURED",
            "No configured event providers available",
            {
                "providers": resolve_provider_order(payload.get("providers")),
                "missing_env_vars": missing_vars,
            },
        )

    event_ids: list[str] = []
    errors = list(availability.unavailable)
    created_count = 0
    skipped_count = 0

    for provider_name in availability.configured:
        provider = get_provider(provider_name)
        try:
            await enforce_limit(
                redis_client,
                prefix="rl:provider",
                identifier=provider_name,
                scope="search:event",
                limit=120,
                window_seconds=60,
            )
            candidates = await provider.search(request)
        except EventProviderLimitedError as exc:
            errors.append(
                {
                    "provider": provider_name,
                    "code": exc.code,
                    "message": exc.message,
                    "details": exc.details,
                }
            )
            continue
        except EventProviderRetryableError as exc:
            raise RetryableJobError(exc.code, exc.message, exc.details) from exc
        except EventProviderNonRetryableError as exc:
            errors.append(
                {
                    "provider": provider_name,
                    "code": exc.code,
                    "message": exc.message,
                    "details": exc.details,
                }
            )
            continue

        for candidate in candidates:
            matched_day_id = _resolve_matched_day_id(
                candidate=candidate,
                scope_day_by_date=scope_day_by_date,
                resolved_trip_day_id=resolved_trip_day_id,
            )
            if scope_days and matched_day_id is None:
                skipped_count += 1
                continue

            place_id = None
            if candidate.get("venue_name"):
                place = await PlaceRepository.get_or_create_external_place(
                    db,
                    source=f"{provider_name}_venue",
                    external_id=candidate.get("venue_external_id"),
                    name=str(candidate["venue_name"])[:255],
                    category="event_venue",
                    address_text=candidate.get("venue_address"),
                    lat=candidate.get("venue_lat"),
                    lon=candidate.get("venue_lon"),
                    metadata={"provider": provider_name},
                )
                place_id = place.id

            item = await EventRepository.create_snapshot(
                db,
                trip_id=trip_id,
                trip_day_id=matched_day_id,
                provider=provider_name,
                provider_event_ref=str(candidate["provider_event_ref"]),
                title=candidate["title"],
                summary=candidate.get("summary"),
                start_at=candidate.get("start_at"),
                end_at=candidate.get("end_at"),
                timezone=candidate.get("timezone"),
                venue_name=candidate.get("venue_name"),
                venue_address=candidate.get("venue_address"),
                place_id=place_id,
                segment=candidate.get("segment"),
                genre=candidate.get("genre"),
                min_price=candidate.get("min_price"),
                max_price=candidate.get("max_price"),
                currency=candidate.get("currency"),
                image_url=candidate.get("image_url"),
                deep_link=candidate.get("deep_link"),
                sales_status=candidate.get("sales_status"),
                request_fingerprint=payload.get("request_fingerprint"),
                raw_payload_json=candidate.get("raw_payload_json") or {},
                expires_at=candidate.get("expires_at") or (datetime.now(UTC)),
            )
            event_ids.append(str(item.id))
            created_count += 1

    if created_count == 0:
        raise NonRetryableJobError(
            "UPSTREAM_PROVIDER_ERROR",
            "No event provider returned usable events",
            {"errors": errors},
        )

    return EventsExecutionResult(
        summary={
            "processed_providers": len(availability.configured),
            "created": created_count,
            "skipped": skipped_count,
            "errors": len(errors),
        },
        event_ids=event_ids,
        errors=errors,
    )
