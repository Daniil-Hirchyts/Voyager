from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Activity, ActivityCategory, EventSnapshot, Job, Place, Trip, TripDay
from app.db.repositories import ActivityRepository, ProposalRepository, TripRepository
from app.errors import ConflictError, ValidationApiError
from app.models.routing import RouteTravelMode
from app.services.google_maps import GoogleMapsError, compute_route_leg
from app.services.itinerary_generation import NonRetryableJobError


@dataclass
class OptimizationExecutionResult:
    proposal_id: str
    summary: dict[str, Any]
    score: dict[str, Any]
    based_on_trip_version: int


def _as_uuid(value: Any, *, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise NonRetryableJobError("JOB_PAYLOAD_INVALID", f"{field} must be a valid UUID") from exc


def _haversine_km(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    radius = 6371.0
    lat1 = math.radians(lat_a)
    lon1 = math.radians(lon_a)
    lat2 = math.radians(lat_b)
    lon2 = math.radians(lon_b)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius * c


async def _load_trip(db: AsyncSession, *, trip_id: uuid.UUID, user_id: uuid.UUID) -> Trip:
    return await TripRepository.get_trip(db, user_id, trip_id)


async def _load_scope_days(
    db: AsyncSession,
    *,
    trip_id: uuid.UUID,
    day_ids_raw: list[str] | list[uuid.UUID] | None,
) -> list[TripDay]:
    rows = await db.execute(
        select(TripDay).where(TripDay.trip_id == trip_id).order_by(TripDay.day_index.asc())
    )
    all_days = list(rows.scalars().all())
    if day_ids_raw is None:
        return all_days

    day_map = {day.id: day for day in all_days}
    resolved: list[TripDay] = []
    for raw in day_ids_raw:
        day_id = _as_uuid(raw, field="day_ids")
        day = day_map.get(day_id)
        if day is None:
            raise NonRetryableJobError(
                "VALIDATION_ERROR",
                "One or more day_ids are not part of the trip",
                {"day_id": str(day_id)},
            )
        if day not in resolved:
            resolved.append(day)
    return resolved


async def _load_day_activities(
    db: AsyncSession, *, day_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[Activity]]:
    if not day_ids:
        return {}
    rows = await db.execute(
        select(Activity)
        .where(Activity.trip_day_id.in_(day_ids))
        .order_by(Activity.trip_day_id.asc(), Activity.order_index.asc())
    )
    grouped: dict[uuid.UUID, list[Activity]] = {day_id: [] for day_id in day_ids}
    for item in rows.scalars().all():
        grouped.setdefault(item.trip_day_id, []).append(item)
    return grouped


async def _load_trip_events(db: AsyncSession, *, trip_id: uuid.UUID) -> list[EventSnapshot]:
    rows = await db.execute(
        select(EventSnapshot)
        .where(EventSnapshot.trip_id == trip_id)
        .where(EventSnapshot.provider == "tripadvisor")
        .where(EventSnapshot.entity_type.in_(("attraction", "restaurant")))
        .order_by(EventSnapshot.start_at.asc().nulls_last(), EventSnapshot.created_at.desc())
    )
    return list(rows.scalars().all())


async def _load_places(db: AsyncSession, *, place_ids: set[uuid.UUID]) -> dict[uuid.UUID, Place]:
    if not place_ids:
        return {}
    rows = await db.execute(select(Place).where(Place.id.in_(place_ids)))
    return {item.id: item for item in rows.scalars().all()}


def _activity_tags(activity: Activity) -> list[str]:
    values = [activity.category.value if hasattr(activity.category, "value") else str(activity.category)]
    if activity.title:
        values.append(activity.title)
    if activity.description:
        values.append(activity.description)
    return [value for value in values if isinstance(value, str)]


def _event_tags(event: EventSnapshot) -> list[str]:
    return [
        value
        for value in ([event.entity_type] + list(event.tags_json or []) + [event.segment, event.genre, "event"])
        if value
    ]


def _proposal_activity_category(tags_json: list[str] | None) -> ActivityCategory:
    normalized = {str(value).strip().lower() for value in (tags_json or []) if value}
    if {"restaurant", "food", "eat", "cafe"} & normalized:
        return ActivityCategory.EAT
    if {"tour", "experience", "event", "activity"} & normalized:
        return ActivityCategory.ACTIVITY
    return ActivityCategory.VISIT


def _candidate_day_id_for_event(
    *,
    event: EventSnapshot,
    scope_days_by_date: dict[Any, uuid.UUID],
    scoped_day_ids: set[uuid.UUID],
) -> uuid.UUID | None:
    if event.trip_day_id and event.trip_day_id in scoped_day_ids:
        return event.trip_day_id
    if event.start_at is not None:
        return scope_days_by_date.get(event.start_at.date())
    raw_local_date = event.raw_payload_json.get("local_date") if isinstance(event.raw_payload_json, dict) else None
    if isinstance(raw_local_date, str):
        try:
            from datetime import date

            return scope_days_by_date.get(date.fromisoformat(raw_local_date))
        except ValueError:
            return None
    return None


def _insert_event_candidate(
    proposal_items: list[dict[str, Any]],
    *,
    trip_day_id: uuid.UUID,
    event: EventSnapshot,
) -> bool:
    if event.start_at is None:
        proposal_items.append(
            {
                "trip_day_id": trip_day_id,
                "source_activity_id": None,
                "event_snapshot_id": event.id,
                "place_id": event.place_id,
                "title": event.title,
                "description": event.summary,
                "start_time": None,
                "duration_min": None,
                "estimated_cost_amount": event.min_price or event.max_price,
                "estimated_cost_currency": event.currency,
                "tags_json": _event_tags(event),
                "rationale_json": {"reason": "event_candidate", "locked": True},
                "score_json": {},
            }
        )
        return True

    event_time = event.start_at.time().replace(tzinfo=None)
    for existing in proposal_items:
        existing_time = existing.get("start_time")
        if existing_time is None:
            continue
        delta = abs(
            (existing_time.hour * 60 + existing_time.minute)
            - (event_time.hour * 60 + event_time.minute)
        )
        if delta < 60:
            return False

    insert_at = len(proposal_items)
    for index, existing in enumerate(proposal_items):
        existing_time = existing.get("start_time")
        if existing_time is not None and event_time < existing_time:
            insert_at = index
            break

    proposal_items.insert(
        insert_at,
        {
            "trip_day_id": trip_day_id,
            "source_activity_id": None,
            "event_snapshot_id": event.id,
            "place_id": event.place_id,
            "title": event.title,
            "description": event.summary,
            "start_time": event_time,
            "duration_min": None,
            "estimated_cost_amount": event.min_price or event.max_price,
            "estimated_cost_currency": event.currency,
            "tags_json": _event_tags(event),
            "rationale_json": {"reason": "event_candidate", "locked": True},
            "score_json": {},
        },
    )
    return True


async def _estimate_leg(
    *,
    previous_place: Place,
    current_place: Place,
    route_cache: dict[tuple[uuid.UUID, uuid.UUID], tuple[float, float]],
) -> tuple[float, float]:
    cache_key = (previous_place.id, current_place.id)
    if cache_key in route_cache:
        return route_cache[cache_key]

    distance_km = _haversine_km(
        previous_place.lat,
        previous_place.lon,
        current_place.lat,
        current_place.lon,
    )
    duration_min = round((distance_km / 25.0) * 60.0, 1) if distance_km else 0.0

    try:
        estimated_distance_km, estimated_duration_min = await compute_route_leg(
            origin=(previous_place.lat, previous_place.lon),
            destination=(current_place.lat, current_place.lon),
            travel_mode=RouteTravelMode.WALK,
        )
        if estimated_distance_km is not None:
            distance_km = estimated_distance_km
        if estimated_duration_min is not None:
            duration_min = estimated_duration_min
    except GoogleMapsError:
        pass

    route_cache[cache_key] = (distance_km, duration_min)
    return route_cache[cache_key]


async def _score_day(
    *,
    trip: Trip,
    items: list[dict[str, Any]],
    places_by_id: dict[uuid.UUID, Place],
    route_cache: dict[tuple[uuid.UUID, uuid.UUID], tuple[float, float]],
) -> dict[str, Any]:
    total_distance_km = 0.0
    travel_minutes = 0.0
    unique_tags: set[str] = set()
    total_cost = 0.0
    previous_place: Place | None = None

    for item in items:
        for tag in item.get("tags_json") or []:
            if isinstance(tag, str):
                unique_tags.add(tag)
        amount = item.get("estimated_cost_amount")
        if amount is not None:
            try:
                total_cost += float(amount)
            except (TypeError, ValueError):
                pass

        place_id = item.get("place_id")
        current_place = places_by_id.get(place_id) if place_id else None
        distance_km = 0.0
        if (
            previous_place is not None
            and current_place is not None
            and previous_place.lat is not None
            and previous_place.lon is not None
            and current_place.lat is not None
            and current_place.lon is not None
        ):
            distance_km, leg_duration = await _estimate_leg(
                previous_place=previous_place,
                current_place=current_place,
                route_cache=route_cache,
            )
            total_distance_km += distance_km
            travel_minutes += leg_duration
        item["score_json"] = {
            "distance_km_from_previous": round(distance_km, 2),
            "travel_minutes_estimate": round(leg_duration, 1) if distance_km else 0.0,
            "tag_count": len(item.get("tags_json") or []),
        }
        previous_place = current_place or previous_place

    variety_score = min(len(unique_tags) * 10.0, 100.0)
    flow_score = max(0.0, 100.0 - total_distance_km * 4.0)
    budget_score = 100.0
    if trip.budget_amount is not None:
        try:
            budget = float(trip.budget_amount)
        except (TypeError, ValueError):
            budget = 0.0
        if budget > 0:
            budget_score = max(0.0, 100.0 - max(total_cost - budget, 0.0) / budget * 100.0)
    total_score = round((variety_score * 0.25) + (flow_score * 0.5) + (budget_score * 0.25), 2)
    return {
        "total_score": total_score,
        "variety_score": round(variety_score, 2),
        "flow_score": round(flow_score, 2),
        "budget_score": round(budget_score, 2),
        "distance_km": round(total_distance_km, 2),
        "travel_minutes_estimate": round(travel_minutes, 1),
        "total_estimated_cost": round(total_cost, 2),
    }


async def execute_itinerary_optimization_job(
    db: AsyncSession,
    job: Job,
) -> OptimizationExecutionResult:
    payload = job.payload_json if isinstance(job.payload_json, dict) else {}
    trip_id = _as_uuid(payload.get("trip_id"), field="trip_id")
    user_id = _as_uuid(payload.get("user_id"), field="user_id")
    trip = await _load_trip(db, trip_id=trip_id, user_id=user_id)
    request = payload.get("request")
    if not isinstance(request, dict):
        raise NonRetryableJobError("JOB_PAYLOAD_INVALID", "request payload must be an object")

    days = await _load_scope_days(db, trip_id=trip.id, day_ids_raw=request.get("day_ids"))
    activities_by_day = await _load_day_activities(db, day_ids=[day.id for day in days])
    events = await _load_trip_events(db, trip_id=trip.id)
    requested_snapshot_ids = {
        _as_uuid(raw, field="activity_snapshot_ids")
        for raw in (request.get("activity_snapshot_ids") or [])
    }
    if requested_snapshot_ids:
        events = [event for event in events if event.id in requested_snapshot_ids]

    include_event_candidates = bool(request.get("include_event_candidates", True))
    max_event_candidates_per_day = int(request.get("max_event_candidates_per_day") or 2)

    attached_event_ids = {
        activity.event_snapshot_id
        for day_items in activities_by_day.values()
        for activity in day_items
        if activity.event_snapshot_id is not None
    }

    proposal_rows: list[dict[str, Any]] = []
    summary = {
        "days_processed": len(days),
        "preserved_activities": 0,
        "inserted_event_candidates": 0,
        "locked_activities": 0,
    }
    per_day_scores: dict[str, Any] = {}
    scoped_day_ids = {day.id for day in days}
    scope_days_by_date = {day.date: day.id for day in days}
    day_candidate_map: dict[uuid.UUID, list[EventSnapshot]] = {day.id: [] for day in days}
    undated_candidates: list[EventSnapshot] = []
    route_cache: dict[tuple[uuid.UUID, uuid.UUID], tuple[float, float]] = {}

    for event in events:
        if event.id in attached_event_ids:
            continue
        matched_day_id = _candidate_day_id_for_event(
            event=event,
            scope_days_by_date=scope_days_by_date,
            scoped_day_ids=scoped_day_ids,
        )
        if matched_day_id is not None:
            day_candidate_map.setdefault(matched_day_id, []).append(event)
        else:
            undated_candidates.append(event)

    for index, event in enumerate(
        sorted(
            undated_candidates,
            key=lambda item: (
                float(item.rating or 0),
                int(item.review_count or 0),
                item.created_at,
            ),
            reverse=True,
        )
    ):
        if not days:
            break
        target_day = days[index % len(days)]
        day_candidate_map.setdefault(target_day.id, []).append(event)

    for day in days:
        current_items = activities_by_day.get(day.id, [])
        day_rows: list[dict[str, Any]] = []
        for activity in current_items:
            locked = activity.source != "generated" and (
                activity.start_time is not None or activity.event_snapshot_id is not None
            )
            if locked:
                summary["locked_activities"] += 1
            day_rows.append(
                {
                    "trip_day_id": day.id,
                    "source_activity_id": activity.id,
                    "event_snapshot_id": activity.event_snapshot_id,
                    "place_id": activity.place_id,
                    "title": activity.title,
                    "description": activity.description,
                    "start_time": activity.start_time,
                    "duration_min": activity.duration_min,
                    "estimated_cost_amount": activity.estimated_cost_amount,
                    "estimated_cost_currency": activity.estimated_cost_currency,
                    "tags_json": _activity_tags(activity),
                    "rationale_json": {"reason": "preserved", "locked": locked},
                    "score_json": {},
                }
            )
            summary["preserved_activities"] += 1

        if include_event_candidates:
            candidate_events = day_candidate_map.get(day.id, [])
            inserted = 0
            for event in candidate_events:
                if inserted >= max_event_candidates_per_day:
                    break
                if _insert_event_candidate(day_rows, trip_day_id=day.id, event=event):
                    inserted += 1
                    summary["inserted_event_candidates"] += 1

        for order_index, item in enumerate(day_rows):
            item["order_index"] = order_index

        place_ids = {
            item["place_id"]
            for item in day_rows
            if item.get("place_id") is not None
        }
        places_by_id = await _load_places(db, place_ids=place_ids)
        day_score = await _score_day(
            trip=trip,
            items=day_rows,
            places_by_id=places_by_id,
            route_cache=route_cache,
        )
        per_day_scores[str(day.id)] = day_score
        proposal_rows.extend(day_rows)

    overall_total = round(
        sum(score["total_score"] for score in per_day_scores.values()) / max(len(per_day_scores), 1),
        2,
    )
    score_json = {"total_score": overall_total, "per_day": per_day_scores}
    proposal_id = uuid.uuid4()
    proposal = await ProposalRepository.create_proposal(
        db,
        proposal_id=proposal_id,
        trip_id=trip.id,
        user_id=user_id,
        job_id=job.id,
        based_on_trip_version=trip.version,
        objective=str(request.get("objective") or "balanced_flow"),
        scope_day_ids=[day.id for day in days],
        summary_json=summary,
        score_json=score_json,
        items=proposal_rows,
    )

    return OptimizationExecutionResult(
        proposal_id=str(proposal.id),
        summary=summary,
        score=score_json,
        based_on_trip_version=proposal.based_on_trip_version,
    )


async def apply_proposal(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    proposal_id: uuid.UUID,
    expected_version: int,
) -> tuple[Trip, list[uuid.UUID]]:
    proposal = await ProposalRepository.get_proposal(db, user_id=user_id, proposal_id=proposal_id)
    trip = await TripRepository.get_trip(db, user_id, proposal.trip_id)
    if trip.version != expected_version or proposal.based_on_trip_version != expected_version:
        raise ConflictError(
            code="CONFLICT_VERSION_MISMATCH",
            message="Trip version mismatch",
            details={
                "latest_version": trip.version,
                "proposal_version": proposal.based_on_trip_version,
            },
        )

    scope_day_ids = [uuid.UUID(str(item)) for item in proposal.scope_day_ids_json]
    activities_by_day = await _load_day_activities(db, day_ids=scope_day_ids)

    for day_id in scope_day_ids:
        current_items = activities_by_day.get(day_id, [])
        current_by_id = {item.id: item for item in current_items}
        current_manual_ids = {item.id for item in current_items if item.source != "generated"}
        current_generated_ids = {item.id for item in current_items if item.source == "generated"}

        proposal_items = [
            item for item in proposal.items if item.trip_day_id == day_id
        ]
        proposal_items.sort(key=lambda item: item.order_index)

        referenced_manual_ids = {
            item.source_activity_id
            for item in proposal_items
            if item.source_activity_id in current_manual_ids
        }
        missing_manual_ids = current_manual_ids - referenced_manual_ids
        if missing_manual_ids:
            raise ValidationApiError(
                "Proposal would drop manual activities",
                {
                    "missing_manual_activity_ids": [
                        str(item) for item in sorted(missing_manual_ids, key=str)
                    ]
                },
            )

        referenced_generated_ids = {
            item.source_activity_id
            for item in proposal_items
            if item.source_activity_id in current_generated_ids
        }
        for activity_id in current_generated_ids - referenced_generated_ids:
            await db.delete(current_by_id[activity_id])
        await db.flush()

        target_ids: list[uuid.UUID] = []
        for proposal_item in proposal_items:
            existing = (
                current_by_id.get(proposal_item.source_activity_id)
                if proposal_item.source_activity_id
                else None
            )
            if existing is not None:
                if existing.trip_day_id != day_id:
                    raise ValidationApiError("Proposal activity references the wrong trip day")
                if existing.source == "generated":
                    existing.title = proposal_item.title
                    existing.description = proposal_item.description
                    existing.start_time = proposal_item.start_time
                    existing.duration_min = proposal_item.duration_min
                    existing.category = _proposal_activity_category(proposal_item.tags_json)
                    existing.category_details_json = {}
                    existing.estimated_cost_amount = proposal_item.estimated_cost_amount
                    existing.estimated_cost_currency = proposal_item.estimated_cost_currency
                    existing.place_id = proposal_item.place_id
                    existing.event_snapshot_id = proposal_item.event_snapshot_id
                    existing.source = "generated"
                    existing.generation_batch_id = proposal.job_id
                target_ids.append(existing.id)
                continue

            created = Activity(
                trip_id=proposal.trip_id,
                trip_day_id=day_id,
                order_index=10_000,
                category=_proposal_activity_category(proposal_item.tags_json),
                category_details_json={},
                title=proposal_item.title,
                description=proposal_item.description,
                start_time=proposal_item.start_time,
                duration_min=proposal_item.duration_min,
                estimated_cost_amount=proposal_item.estimated_cost_amount,
                estimated_cost_currency=proposal_item.estimated_cost_currency,
                place_id=proposal_item.place_id,
                event_snapshot_id=proposal_item.event_snapshot_id,
                notes=None,
                is_favorite=False,
                source="generated",
                generation_batch_id=proposal.job_id,
            )
            db.add(created)
            await db.flush()
            target_ids.append(created.id)

        await ActivityRepository._apply_order_for_day(db, day_id, target_ids)

    await ProposalRepository.mark_applied(db, proposal_id=proposal.id)
    await TripRepository.bump_version(db, trip.id)
    await db.flush()
    await db.refresh(trip)
    return trip, scope_day_ids
