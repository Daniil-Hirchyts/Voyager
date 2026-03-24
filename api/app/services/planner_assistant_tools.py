from __future__ import annotations

import uuid
from typing import Any

from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import Activity, Job, Place
from app.db.repositories import (
    ActivityRepository,
    AssistantRepository,
    JobRepository,
    PlacePhotoRepository,
    PlaceRepository,
    TripRepository,
)
from app.errors import ServiceUnavailableError, ValidationApiError
from app.models.assistant import AssistantMessageResponse
from app.models.places import PlaceCreateRequest
from app.models.trips import ActivityCreateRequest, ActivityMoveRequest, ActivityPatchRequest
from app.rate_limit.limiter import limit_user_request
from app.services.google_maps import GoogleMapsError, lookup_google_place, search_google_places
from app.services.planner_assistant_common import (
    _float,
    _int,
    _job_progress_part,
    _jsonable,
    _string,
    assistant_message_to_response,
)


def _serialize_place(
    place: Place | None, photo_summaries: dict[uuid.UUID, tuple[int, Any]]
) -> dict[str, Any] | None:
    if place is None:
        return None
    photo_count, primary_photo = photo_summaries.get(place.id, (0, None))
    return {
        "id": str(place.id),
        "name": place.name,
        "category": place.category,
        "address_text": place.address_text,
        "lat": place.lat,
        "lon": place.lon,
        "photo_count": photo_count,
        "primary_photo": _jsonable(primary_photo) if primary_photo is not None else None,
    }


async def _load_trip_snapshot(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    trip_id: uuid.UUID,
) -> dict[str, Any]:
    summary = await TripRepository.get_trip_access_summary(db, user_id=user_id, trip_id=trip_id)
    trip = summary.trip
    days = await TripRepository.list_days(db, user_id, trip_id)
    activities = await ActivityRepository.list_trip_activities(db, user_id, trip_id)
    place_ids = [activity.place_id for activity in activities if activity.place_id]
    photo_summaries = await PlacePhotoRepository.photo_summaries_for_place_ids(
        db,
        [place_id for place_id in place_ids if place_id is not None],
    )
    places_by_id: dict[uuid.UUID, Place] = {}
    if place_ids:
        rows = await db.execute(select(Place).where(Place.id.in_(place_ids)))
        places_by_id = {place.id: place for place in rows.scalars().all()}

    activities_by_day: dict[uuid.UUID | None, list[dict[str, Any]]] = {None: []}
    for day in days:
        activities_by_day[day.id] = []

    for activity in activities:
        payload = {
            "id": str(activity.id),
            "trip_day_id": str(activity.trip_day_id) if activity.trip_day_id else None,
            "order_index": activity.order_index,
            "category": activity.category.value
            if hasattr(activity.category, "value")
            else str(activity.category),
            "title": activity.title,
            "description": activity.description,
            "start_time": activity.start_time.isoformat() if activity.start_time else None,
            "duration_min": activity.duration_min,
            "estimated_cost_amount": str(activity.estimated_cost_amount)
            if activity.estimated_cost_amount is not None
            else None,
            "estimated_cost_currency": activity.estimated_cost_currency,
            "place_id": str(activity.place_id) if activity.place_id else None,
            "notes": activity.notes,
            "source": activity.source,
            "place": _serialize_place(
                places_by_id.get(activity.place_id) if activity.place_id else None,
                photo_summaries,
            ),
        }
        activities_by_day.setdefault(activity.trip_day_id, []).append(payload)

    return {
        "trip": {
            "id": str(trip.id),
            "title": trip.title,
            "destination_text": trip.destination_text,
            "start_date": trip.start_date.isoformat(),
            "end_date": trip.end_date.isoformat(),
            "budget_amount": str(trip.budget_amount) if trip.budget_amount is not None else None,
            "budget_currency": trip.budget_currency,
            "trip_type": trip.trip_type,
            "route_travel_mode": trip.route_travel_mode,
            "version": trip.version,
            "current_user_role": summary.current_user_role.value,
            "collaborator_count": summary.collaborator_count,
        },
        "inbox_activities": activities_by_day.get(None, []),
        "days": [
            {
                "id": str(day.id),
                "day_index": day.day_index,
                "date": day.date.isoformat(),
                "notes": day.notes,
                "activities": activities_by_day.get(day.id, []),
            }
            for day in days
        ],
    }


async def _build_place_payload(
    arguments: dict[str, Any],
) -> tuple[uuid.UUID | None, dict[str, Any] | None]:
    place_id_raw = _string(arguments.get("place_id"))
    inferred_external_id: str | None = None
    if place_id_raw:
        try:
            return uuid.UUID(place_id_raw), None
        except ValueError:
            inferred_external_id = place_id_raw

    place_name = _string(arguments.get("place_name"))
    place_address = _string(arguments.get("place_address"))
    place_external_id = _string(arguments.get("place_external_id")) or inferred_external_id
    place_category = _string(arguments.get("place_category"))
    place_lat = _float(arguments.get("place_lat"))
    place_lon = _float(arguments.get("place_lon"))

    if place_external_id and (
        not place_name
        or place_address is None
        or place_category is None
        or place_lat is None
        or place_lon is None
    ):
        try:
            details = await lookup_google_place(place_external_id)
        except GoogleMapsError as exc:
            raise ServiceUnavailableError(
                "GOOGLE_MAPS_ERROR",
                "Google place lookup failed",
                {"error": str(exc), "place_external_id": place_external_id},
            ) from exc
        if details is not None:
            place_name = (
                place_name or details.name or details.formatted_address or place_external_id
            )
            place_address = place_address or details.formatted_address
            place_category = place_category or details.category
            place_lat = place_lat if place_lat is not None else details.lat
            place_lon = place_lon if place_lon is not None else details.lng

    if not place_name:
        return None, None

    payload = PlaceCreateRequest(
        source="google_places" if place_external_id else "assistant_manual",
        external_id=place_external_id,
        name=place_name,
        category=place_category,
        address_text=place_address,
        lat=place_lat,
        lon=place_lon,
        metadata={"created_by": "planner_assistant"},
    )
    return None, payload.model_dump(mode="json")


async def _ensure_place_for_activity(
    db: AsyncSession,
    arguments: dict[str, Any],
) -> uuid.UUID | None:
    place_id, payload = await _build_place_payload(arguments)
    if place_id is not None:
        return place_id
    if payload is None:
        return None

    external_id = payload.get("external_id")
    if isinstance(external_id, str) and external_id.strip():
        existing = await db.execute(
            select(Place)
            .where(Place.external_id == external_id)
            .where(Place.source == payload["source"])
        )
        place = existing.scalar_one_or_none()
        if place is not None:
            return place.id

    place = await PlaceRepository.create_place(db, PlaceCreateRequest.model_validate(payload))
    return place.id


async def _serialize_activity(
    db: AsyncSession,
    activity: Activity,
) -> dict[str, Any]:
    photo_summaries = await PlacePhotoRepository.photo_summaries_for_place_ids(
        db,
        [activity.place_id] if activity.place_id else [],
    )
    place = await db.get(Place, activity.place_id) if activity.place_id else None
    return {
        "id": str(activity.id),
        "trip_day_id": str(activity.trip_day_id) if activity.trip_day_id else None,
        "order_index": activity.order_index,
        "category": activity.category.value
        if hasattr(activity.category, "value")
        else str(activity.category),
        "title": activity.title,
        "description": activity.description,
        "start_time": activity.start_time.isoformat() if activity.start_time else None,
        "duration_min": activity.duration_min,
        "estimated_cost_amount": str(activity.estimated_cost_amount)
        if activity.estimated_cost_amount is not None
        else None,
        "estimated_cost_currency": activity.estimated_cost_currency,
        "place_id": str(activity.place_id) if activity.place_id else None,
        "notes": activity.notes,
        "source": activity.source,
        "place": _serialize_place(place, photo_summaries),
    }


async def _queue_itinerary_job(
    db: AsyncSession,
    *,
    redis: Redis,
    user_id: uuid.UUID,
    trip_id: uuid.UUID,
    job_type: str,
    mode: str,
    day_ids: list[str] | None,
    seed: int | None,
) -> Job:
    settings = get_settings()
    await limit_user_request(
        redis,
        str(user_id),
        "itinerary:submit",
        settings.rate_limit_generate_per_hour,
        window_seconds=3600,
    )
    trip = await TripRepository.get_trip(db, user_id, trip_id)
    trip_days = await TripRepository.list_days(db, user_id, trip_id)
    allowed_ids = {str(day.id) for day in trip_days}
    normalized_days = day_ids or [str(day.id) for day in trip_days]
    invalid = [day_id for day_id in normalized_days if day_id not in allowed_ids]
    if invalid:
        raise ValidationApiError(
            "One or more day_ids are not part of the trip", {"day_ids": invalid}
        )

    job = await JobRepository.create_job(
        db,
        user_id,
        job_type=job_type,
        payload={
            "trip_id": str(trip_id),
            "user_id": str(user_id),
            "mode": mode,
            "day_ids": normalized_days,
            "constraints": {},
            "seed": seed,
            "expected_trip_version": trip.version,
        },
        max_attempts=settings.job_max_attempts,
    )
    return job


def _tool_definitions() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "read_trip_snapshot",
                "description": "Read the current trip, days, inbox items, and itinerary activities.",
                "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "search_places",
                "description": (
                    "Search Google places for itinerary locations before creating or "
                    "updating place-based activities."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 5},
                    },
                    "required": ["query"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "create_activity",
                "description": (
                    "Create a new planner activity, optionally attached to a trip day and place."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "trip_day_id": {"type": ["string", "null"]},
                        "category": {"type": "string"},
                        "title": {"type": "string"},
                        "description": {"type": ["string", "null"]},
                        "start_time": {"type": ["string", "null"]},
                        "duration_min": {"type": ["integer", "null"]},
                        "estimated_cost_amount": {"type": ["number", "string", "null"]},
                        "estimated_cost_currency": {"type": ["string", "null"]},
                        "notes": {"type": ["string", "null"]},
                        "place_id": {"type": ["string", "null"]},
                        "place_name": {"type": ["string", "null"]},
                        "place_address": {"type": ["string", "null"]},
                        "place_category": {"type": ["string", "null"]},
                        "place_external_id": {"type": ["string", "null"]},
                        "place_lat": {"type": ["number", "null"]},
                        "place_lon": {"type": ["number", "null"]},
                    },
                    "required": ["category", "title"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "update_activity",
                "description": "Update an existing planner activity's editable fields.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "activity_id": {"type": "string"},
                        "category": {"type": ["string", "null"]},
                        "title": {"type": ["string", "null"]},
                        "description": {"type": ["string", "null"]},
                        "start_time": {"type": ["string", "null"]},
                        "duration_min": {"type": ["integer", "null"]},
                        "estimated_cost_amount": {"type": ["number", "string", "null"]},
                        "estimated_cost_currency": {"type": ["string", "null"]},
                        "notes": {"type": ["string", "null"]},
                        "is_favorite": {"type": ["boolean", "null"]},
                    },
                    "required": ["activity_id"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "move_activity",
                "description": "Move an activity to another day or reorder it inside the same bucket.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "activity_id": {"type": "string"},
                        "target_day_id": {"type": ["string", "null"]},
                        "target_index": {"type": "integer", "minimum": 0},
                    },
                    "required": ["activity_id", "target_day_id", "target_index"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "delete_activity",
                "description": (
                    "Delete an activity from the planner. This always requires confirmation."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {"activity_id": {"type": "string"}},
                    "required": ["activity_id"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "generate_itinerary",
                "description": "Queue itinerary generation. Replace mode requires confirmation.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "mode": {"type": "string", "enum": ["replace", "merge", "append"]},
                        "day_ids": {"type": ["array", "null"], "items": {"type": "string"}},
                        "seed": {"type": ["integer", "null"]},
                    },
                    "required": ["mode"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "reset_itinerary",
                "description": (
                    "Queue reset of all itinerary items for the selected days. "
                    "This always requires confirmation."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "day_ids": {"type": "array", "items": {"type": "string"}, "minItems": 1},
                    },
                    "required": ["day_ids"],
                    "additionalProperties": False,
                },
            },
        },
    ]


async def _execute_tool_call(
    db: AsyncSession,
    *,
    redis: Redis,
    user_id: uuid.UUID,
    trip_id: uuid.UUID,
    thread_id: uuid.UUID,
    tool_name: str,
    arguments: dict[str, Any],
    request_text: str,
) -> tuple[dict[str, Any], list[AssistantMessageResponse]]:
    if tool_name == "read_trip_snapshot":
        snapshot = await _load_trip_snapshot(db, user_id=user_id, trip_id=trip_id)
        return {
            "trip": snapshot["trip"],
            "days": snapshot["days"],
            "inbox_activities": snapshot["inbox_activities"],
        }, []

    if tool_name == "search_places":
        query = _string(arguments.get("query"))
        if not query:
            raise ValidationApiError("query is required")
        limit = max(1, min(_int(arguments.get("limit")) or 5, 5))
        try:
            items = await search_google_places(query, limit)
        except GoogleMapsError as exc:
            raise ServiceUnavailableError(
                "GOOGLE_MAPS_ERROR",
                "Google place search failed",
                {"error": str(exc)},
            ) from exc
        return {
            "items": [
                {
                    "place_id": item.place_id,
                    "name": item.name,
                    "label": item.label,
                    "address_text": item.address_text,
                    "category": item.category,
                    "lat": item.lat,
                    "lon": item.lon,
                    "country": item.country,
                    "region": item.region,
                    "timezone": item.timezone,
                }
                for item in items
            ]
        }, []

    if tool_name == "create_activity":
        place_id = await _ensure_place_for_activity(db, arguments)
        payload = ActivityCreateRequest(
            trip_day_id=uuid.UUID(arguments["trip_day_id"])
            if _string(arguments.get("trip_day_id"))
            else None,
            category=str(arguments.get("category") or "visit"),
            title=str(arguments.get("title") or "").strip(),
            description=_string(arguments.get("description")),
            start_time=_string(arguments.get("start_time")),
            duration_min=_int(arguments.get("duration_min")),
            estimated_cost_amount=arguments.get("estimated_cost_amount"),
            estimated_cost_currency=_string(arguments.get("estimated_cost_currency")),
            place_id=place_id,
            notes=_string(arguments.get("notes")),
            source="manual",
        )
        activity = await ActivityRepository.create_trip_activity(db, user_id, trip_id, payload)
        serialized = await _serialize_activity(db, activity)
        return {"activity": serialized}, []

    if tool_name == "update_activity":
        activity_id = _string(arguments.get("activity_id"))
        if not activity_id:
            raise ValidationApiError("activity_id is required")
        payload = ActivityPatchRequest(
            category=_string(arguments.get("category")),
            title=_string(arguments.get("title")),
            description=_string(arguments.get("description")),
            start_time=_string(arguments.get("start_time")),
            duration_min=_int(arguments.get("duration_min")),
            estimated_cost_amount=arguments.get("estimated_cost_amount"),
            estimated_cost_currency=_string(arguments.get("estimated_cost_currency")),
            notes=_string(arguments.get("notes")),
            is_favorite=arguments.get("is_favorite"),
        )
        activity = await ActivityRepository.patch_activity(
            db,
            user_id,
            uuid.UUID(activity_id),
            payload,
        )
        serialized = await _serialize_activity(db, activity)
        return {"activity": serialized}, []

    if tool_name == "move_activity":
        activity_id = _string(arguments.get("activity_id"))
        target_index = _int(arguments.get("target_index"))
        if not activity_id or target_index is None:
            raise ValidationApiError("activity_id and target_index are required")
        trip = await TripRepository.get_trip(db, user_id, trip_id)
        activity = await ActivityRepository.move_activity(
            db,
            user_id,
            uuid.UUID(activity_id),
            trip.version,
            ActivityMoveRequest(
                target_day_id=uuid.UUID(arguments["target_day_id"])
                if _string(arguments.get("target_day_id"))
                else None,
                target_index=target_index,
            ),
        )
        serialized = await _serialize_activity(db, activity)
        return {"activity": serialized}, []

    if tool_name == "delete_activity":
        activity_id = _string(arguments.get("activity_id"))
        if not activity_id:
            raise ValidationApiError("activity_id is required")
        await ActivityRepository.delete_activity(db, user_id, uuid.UUID(activity_id))
        return {"deleted_activity_id": activity_id}, []

    if tool_name == "generate_itinerary":
        mode = _string(arguments.get("mode")) or "replace"
        job = await _queue_itinerary_job(
            db,
            redis=redis,
            user_id=user_id,
            trip_id=trip_id,
            job_type="itinerary.generate",
            mode=mode,
            day_ids=[str(item) for item in arguments.get("day_ids") or []] or None,
            seed=_int(arguments.get("seed")),
        )
        mirrored = await _create_job_progress_message(
            db,
            user_id=user_id,
            trip_id=trip_id,
            thread_id=thread_id,
            job_id=job.id,
            request_text=request_text,
            action="generate",
        )
        return {"job_id": str(job.id), "status": job.status.value, "mode": mode}, mirrored

    if tool_name == "reset_itinerary":
        raw_day_ids = arguments.get("day_ids")
        if not isinstance(raw_day_ids, list) or not raw_day_ids:
            raise ValidationApiError("day_ids are required")
        job = await _queue_itinerary_job(
            db,
            redis=redis,
            user_id=user_id,
            trip_id=trip_id,
            job_type="itinerary.reset",
            mode="replace",
            day_ids=[str(item) for item in raw_day_ids],
            seed=None,
        )
        mirrored = await _create_job_progress_message(
            db,
            user_id=user_id,
            trip_id=trip_id,
            thread_id=thread_id,
            job_id=job.id,
            request_text=request_text,
            action="reset",
        )
        return {
            "job_id": str(job.id),
            "status": job.status.value,
            "day_ids": [str(item) for item in raw_day_ids],
        }, mirrored

    raise ValidationApiError(f"Unsupported tool {tool_name}")


async def _create_job_progress_message(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    trip_id: uuid.UUID,
    thread_id: uuid.UUID,
    job_id: uuid.UUID,
    request_text: str,
    action: str,
) -> list[AssistantMessageResponse]:
    existing = await AssistantRepository.get_message_by_source_job_id(db, job_id=job_id)
    if existing is not None:
        return [assistant_message_to_response(existing)]
    message = await AssistantRepository.create_message(
        db,
        thread_id=thread_id,
        role="assistant",
        parts=[_job_progress_part(job_id=job_id, action=action, request_text=request_text)],
        metadata={"kind": "job-progress", "action": action},
        status="running",
        source_job_id=job_id,
    )
    return [assistant_message_to_response(message)]
