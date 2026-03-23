from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, date, datetime, time
from decimal import Decimal
from typing import Any

import httpx
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import Activity, AssistantMessage, Job, Place, UserProfile
from app.db.repositories import (
    ActivityRepository,
    AssistantRepository,
    JobRepository,
    PlacePhotoRepository,
    PlaceRepository,
    TripRepository,
)
from app.errors import ApiError, NotFoundError, ServiceUnavailableError, ValidationApiError
from app.models.assistant import AssistantMessageResponse, AssistantThreadResponse
from app.models.places import PlaceCreateRequest
from app.models.trips import ActivityCreateRequest, ActivityMoveRequest, ActivityPatchRequest
from app.rate_limit.limiter import limit_user_request
from app.services.google_maps import GoogleMapsError, lookup_google_place, search_google_places
from app.services.llm_retry import llm_rate_limit_retry_delay_sec
from app.services.user_preferences import resolve_assistant_llm_provider

logger = logging.getLogger(__name__)

STREAM_EVENT_MESSAGE_UPSERT = "message_upsert"
STREAM_EVENT_DONE = "done"
STREAM_EVENT_ERROR = "error"
MAX_TOOL_TURNS = 8
DESTRUCTIVE_TOOLS = {"delete_activity", "reset_itinerary", "replace_itinerary"}
PLANNER_RESULT_TOOLS = {"create_activity", "update_activity", "move_activity", "delete_activity"}
ALLOWED_TOOL_NAMES = {
    "read_trip_snapshot",
    "search_places",
    "create_activity",
    "update_activity",
    "move_activity",
    "delete_activity",
    "generate_itinerary",
    "reset_itinerary",
}
DIRECT_COMMAND_TOOL_MAP = {
    "snapshot": "read_trip_snapshot",
    "search_places": "search_places",
    "create_activity": "create_activity",
    "update_activity": "update_activity",
    "move_activity": "move_activity",
    "delete_activity": "delete_activity",
}
GREETING_INPUT_RE = re.compile(
    r"^(hi|hello|hey|good morning|good afternoon|good evening)[!. ]*$",
    re.I,
)
THANKS_INPUT_RE = re.compile(r"^(thanks|thank you|thx)[!. ]*$", re.I)


def _jsonable(value: Any) -> Any:
    # Pydantic models must be dumped to dict before further processing
    try:
        from pydantic import BaseModel as _BaseModel  # noqa: PLC0415

        if isinstance(value, _BaseModel):
            return _jsonable(value.model_dump())
    except ImportError:
        pass
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    if isinstance(value, tuple):
        return [_jsonable(item) for item in value]
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, time):
        return value.isoformat()
    return value


def _string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    cleaned = str(value).strip()
    return cleaned or None


def _extract_message_text(content: Any) -> str | None:
    if isinstance(content, str):
        stripped = content.strip()
        return stripped or None
    if isinstance(content, dict):
        if content.get("type") in {"text", "output_text"} and isinstance(content.get("text"), str):
            stripped = content["text"].strip()
            return stripped or None
        if isinstance(content.get("content"), str):
            stripped = content["content"].strip()
            return stripped or None
    if isinstance(content, list):
        parts: list[str] = []
        for entry in content:
            if not isinstance(entry, dict):
                continue
            if entry.get("type") in {"text", "output_text"} and isinstance(entry.get("text"), str):
                parts.append(entry["text"])
        joined = "".join(parts).strip()
        return joined or None
    return None


def _small_talk_reply(text: str) -> str | None:
    normalized = text.strip()
    if not normalized:
        return None
    if GREETING_INPUT_RE.fullmatch(normalized):
        return (
            "Hi. I can help with this trip when you're ready. Ask a question, search for a place, "
            "or use /generate or /reset."
        )
    if THANKS_INPUT_RE.fullmatch(normalized):
        return "You're welcome. Ask if you want to adjust the itinerary or generate a new pass."
    return None


def _float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _assistant_status_payload(status: str) -> dict[str, Any]:
    normalized = status.strip().lower()
    if normalized == "running":
        return {"type": "running"}
    if normalized == "requires_action":
        return {"type": "requires-action", "reason": "interrupt"}
    if normalized == "incomplete":
        return {"type": "incomplete", "reason": "error"}
    return {"type": "complete", "reason": "stop"}


def assistant_message_to_response(message: AssistantMessage) -> AssistantMessageResponse:
    return AssistantMessageResponse(
        id=message.id,
        thread_id=message.thread_id,
        role=message.role,
        status=message.status,
        parts=[part for part in message.parts_json or [] if isinstance(part, dict)],
        metadata=message.metadata_json or {},
        source_job_id=message.source_job_id,
        created_at=message.created_at,
        updated_at=message.updated_at,
    )


async def get_thread_response(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    trip_id: uuid.UUID,
) -> AssistantThreadResponse:
    thread, messages = await AssistantRepository.get_thread_with_messages(
        db,
        user_id=user_id,
        trip_id=trip_id,
    )
    return AssistantThreadResponse(
        id=thread.id,
        trip_id=thread.trip_id,
        user_id=thread.user_id,
        messages=[assistant_message_to_response(message) for message in messages],
    )


async def clear_thread_messages(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    trip_id: uuid.UUID,
) -> None:
    await AssistantRepository.clear_thread_messages(db, user_id=user_id, trip_id=trip_id)


async def mirror_job_to_thread(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    trip_id: uuid.UUID,
    job_id: uuid.UUID,
    request_text: str,
    action: str,
) -> list[AssistantMessageResponse]:
    job = await JobRepository.get_job(db, user_id, job_id)
    payload = job.payload_json if isinstance(job.payload_json, dict) else {}
    if str(payload.get("trip_id") or "") != str(trip_id):
        raise NotFoundError("Job not found")
    (
        _thread,
        user_message,
        assistant_message,
    ) = await AssistantRepository.upsert_mirrored_job_messages(
        db,
        user_id=user_id,
        trip_id=trip_id,
        job_id=job_id,
        request_text=request_text,
        action=action,
    )
    responses: list[AssistantMessageResponse] = []
    if user_message is not None:
        responses.append(assistant_message_to_response(user_message))
    responses.append(assistant_message_to_response(assistant_message))
    return responses


async def append_job_progress_to_thread(
    db: AsyncSession,
    *,
    job_id: uuid.UUID,
    event: dict[str, Any],
) -> AssistantMessageResponse | None:
    message = await AssistantRepository.append_job_progress_event(db, job_id=job_id, event=event)
    if message is None:
        return None
    return assistant_message_to_response(message)


def _extract_text(parts: list[dict] | None) -> str | None:
    if not parts:
        return None
    texts = [str(part.get("text") or "").strip() for part in parts if part.get("type") == "text"]
    joined = "\n".join(item for item in texts if item)
    return joined or None


def _message_to_llm_payload(message: AssistantMessage) -> dict[str, Any] | None:
    if message.role == "user":
        text = _extract_text(message.parts_json)
        if text:
            return {"role": "user", "content": text}
        return None

    if message.role == "assistant":
        text = _extract_text(message.parts_json)
        if text:
            return {"role": "assistant", "content": text}
    return None


def _tool_result_content(payload: dict[str, Any]) -> str:
    return json.dumps(_jsonable(payload), separators=(",", ":"), ensure_ascii=True)


def _trim_provider_history(history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    settings = get_settings()
    max_messages = max(4, settings.assistant_max_history_messages)
    if len(history) <= max_messages:
        return history

    system_message = history[0] if history and history[0].get("role") == "system" else None
    trimmed = history[-max_messages:]
    if system_message is None:
        return trimmed
    return [system_message, *trimmed[-(max_messages - 1) :]]


def _validate_tool_name(tool_name: str) -> None:
    if tool_name not in ALLOWED_TOOL_NAMES:
        raise ValidationApiError(f"Unsupported tool {tool_name}")


def _tool_call_part(
    *,
    tool_call_id: str,
    tool_name: str,
    args: dict[str, Any],
    result: dict[str, Any] | None = None,
    is_error: bool = False,
    interrupt: dict[str, Any] | None = None,
) -> dict[str, Any]:
    part = {
        "type": "tool-call",
        "toolCallId": tool_call_id,
        "toolName": tool_name,
        "args": _jsonable(args) if isinstance(args, dict) else {},
        "argsText": _tool_result_content(args if isinstance(args, dict) else {}),
    }
    if result is not None:
        part["result"] = _jsonable(result)
    if is_error:
        part["isError"] = True
    if interrupt is not None:
        part["interrupt"] = {"type": "human", "payload": _jsonable(interrupt)}
    return part


def _planner_result_part(operation: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "data",
        "name": "planner-result",
        "data": {"operation": operation, **_jsonable(payload)},
    }


def _job_progress_part(
    *,
    job_id: uuid.UUID,
    action: str,
    request_text: str,
) -> dict[str, Any]:
    return {
        "type": "data",
        "name": "job-progress",
        "data": {
            "job_id": str(job_id),
            "action": action,
            "request_text": request_text,
            "job_status": "PENDING",
            "events": [],
            "summary": None,
        },
    }


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
                "description": "Search Google places for itinerary locations before creating or updating place-based activities.",
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
                "description": "Create a new planner activity, optionally attached to a trip day and place.",
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
                "description": "Delete an activity from the planner. This always requires confirmation.",
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
                "description": "Queue reset of all itinerary items for the selected days. This always requires confirmation.",
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


def _system_prompt() -> str:
    return (
        "You are Voyager's planner assistant. "
        "Help the user understand and edit a trip itinerary. "
        "Use tools only when you need current trip data or when the user requests a mutation. "
        "For simple greetings, acknowledgements, or small talk, reply directly without tools. "
        "If the user asks about places, options, or ideas, inspect the trip context and search places before answering. "
        "Always call search_places before recommending specific new venues so the UI can show grounded place cards. "
        "Never invent activity ids, day ids, or place ids. "
        "For destructive actions, still call the tool; the system will request confirmation. "
        "When a tool already completed the user's request, answer briefly and concretely."
    )


async def _call_llm(
    *,
    history: list[dict[str, Any]],
    llm_provider: str = "openrouter",
) -> dict[str, Any]:
    settings = get_settings()

    if llm_provider == "mistral":
        models = settings.itinerary_mistral_model_order()
        api_key = settings.llm_mistral_api_key
        base_url = settings.llm_mistral_base_url
        timeout_sec = settings.llm_mistral_timeout_sec
    elif llm_provider == "gemini":
        models = settings.itinerary_gemini_model_order()
        api_key = settings.llm_gemini_api_key
        base_url = settings.llm_gemini_base_url
        timeout_sec = settings.llm_gemini_timeout_sec
    else:
        llm_provider = "openrouter"
        models = settings.itinerary_llm_model_order()
        api_key = settings.llm_openrouter_api_key
        base_url = settings.llm_openrouter_base_url
        timeout_sec = settings.llm_openrouter_timeout_sec

    if not api_key:
        raise ServiceUnavailableError(
            "INTEGRATION_NOT_CONFIGURED",
            f"{llm_provider} API key is not configured",
            {"missing_env_vars": [f"VOYAGER_LLM_{llm_provider.upper()}_API_KEY"]},
        )

    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    last_error: Exception | None = None
    async with httpx.AsyncClient(timeout=timeout_sec) as client:
        for model in models:
            payload = {
                "model": model,
                "temperature": 0.2,
                "messages": history,
                "tools": _tool_definitions(),
                "tool_choice": "auto",
                "max_tokens": max(64, settings.assistant_max_response_tokens),
            }
            rate_limit_attempts = 0
            while True:
                try:
                    response = await client.post(endpoint, headers=headers, json=payload)
                    response.raise_for_status()
                    data = response.json()
                    choices = data.get("choices")
                    if not isinstance(choices, list) or not choices:
                        raise ValueError("Missing choices in provider response")
                    first = choices[0]
                    if not isinstance(first, dict) or not isinstance(first.get("message"), dict):
                        raise ValueError("Missing assistant message in provider response")
                    message = first["message"]
                    message["_model"] = model
                    return message
                except Exception as exc:  # pragma: no cover - defensive provider failover
                    if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 429:
                        if rate_limit_attempts < settings.llm_rate_limit_max_retries:
                            rate_limit_attempts += 1
                            delay_sec = llm_rate_limit_retry_delay_sec(
                                attempt=rate_limit_attempts,
                                retry_after=exc.response.headers.get("Retry-After"),
                                base_delay_ms=settings.llm_rate_limit_base_delay_ms,
                                max_delay_ms=settings.llm_rate_limit_max_delay_ms,
                            )
                            logger.warning(
                                "planner_assistant_provider_rate_limited_retrying",
                                extra={
                                    "trace_id": "-",
                                    "provider": llm_provider,
                                    "model": model,
                                    "attempt": rate_limit_attempts,
                                    "delay_sec": delay_sec,
                                },
                                exc_info=True,
                            )
                            await asyncio.sleep(delay_sec)
                            continue
                        last_error = ServiceUnavailableError(
                            "UPSTREAM_PROVIDER_RATE_LIMIT",
                            f"{llm_provider.capitalize()} is temporarily unavailable right now.",
                            {"provider": llm_provider, "status_code": 429},
                        )
                        logger.warning(
                            "planner_assistant_provider_rate_limited_exhausted",
                            extra={"trace_id": "-", "provider": llm_provider, "model": model},
                            exc_info=True,
                        )
                        break
                    last_error = exc
                    logger.warning("planner_assistant_provider_failed", exc_info=True)
                    break
    if isinstance(last_error, ServiceUnavailableError):
        raise last_error
    raise ServiceUnavailableError(
        "UPSTREAM_PROVIDER_ERROR",
        "Planner assistant provider request failed",
        {"error": str(last_error) if last_error else "unknown"},
    )


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


def _format_tool_summary(tool_name: str, result: dict[str, Any]) -> str:
    if tool_name == "read_trip_snapshot":
        days = result.get("days") or []
        return f"Loaded the latest trip snapshot with {len(days)} day(s)."
    if tool_name == "search_places":
        items = result.get("items") or []
        return f"Found {len(items)} place option(s)."
    if tool_name == "create_activity":
        activity = result.get("activity") or {}
        title = _string(activity.get("title")) or "the activity"
        return f"Added {title}."
    if tool_name in {"update_activity", "move_activity"}:
        activity = result.get("activity") or {}
        title = _string(activity.get("title")) or "the activity"
        return f"Updated {title}."
    if tool_name == "delete_activity":
        return "Deleted the activity."
    if tool_name in {"generate_itinerary", "reset_itinerary"}:
        return "Queued the planner job and added its live progress below."
    return "Completed the requested tool action."


def _tool_supports_planner_result(tool_name: str) -> bool:
    return tool_name in PLANNER_RESULT_TOOLS


def _fallback_assistant_text(parts: list[dict[str, Any]]) -> str | None:
    for part in reversed(parts):
        if not isinstance(part, dict) or part.get("type") != "tool-call":
            continue
        tool_name = _string(part.get("toolName"))
        if not tool_name:
            continue
        result = part.get("result")
        result_payload = result if isinstance(result, dict) else {}
        if part.get("isError"):
            error = result_payload.get("error")
            if isinstance(error, dict):
                message = _string(error.get("message"))
                if message:
                    return f"{_format_tool_summary(tool_name, result_payload)} {message}"
            return _format_tool_summary(tool_name, result_payload)
        if isinstance(result, dict):
            return _format_tool_summary(tool_name, result_payload)
    return None


def _format_command_request_text(command_name: str, args: dict[str, Any]) -> str:
    if command_name == "snapshot":
        return "/snapshot"
    if command_name == "search_places":
        query = _string(args.get("query")) or ""
        return f"/search_places {query}".strip()
    if args:
        return f"/{command_name} {json.dumps(_jsonable(args), separators=(',', ':'), ensure_ascii=True)}"
    return f"/{command_name}"


def _decode_tool_arguments(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _pending_confirmation_payload(
    *,
    tool_name: str,
    tool_call_id: str,
    args: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    if tool_name == "delete_activity":
        return (
            {"tool_name": tool_name, "tool_call_id": tool_call_id, "args": args},
            "Deleting this activity will remove it from the planner. Confirm to continue.",
        )
    if tool_name == "reset_itinerary":
        return (
            {"tool_name": tool_name, "tool_call_id": tool_call_id, "args": args},
            "Reset will remove every activity from the selected days. Confirm to continue.",
        )
    return (
        {"tool_name": tool_name, "tool_call_id": tool_call_id, "args": args},
        "Replace mode can overwrite generated activities. Confirm to continue.",
    )


class PlannerAssistantSession:
    def __init__(
        self,
        *,
        db: AsyncSession,
        redis: Redis,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        thread_id: uuid.UUID,
        emit: Callable[[AssistantMessageResponse], Awaitable[None]],
    ) -> None:
        self._db = db
        self._redis = redis
        self._user_id = user_id
        self._trip_id = trip_id
        self._thread_id = thread_id
        self._emit = emit

    async def _emit_message(self, message: AssistantMessage) -> None:
        await self._emit(assistant_message_to_response(message))

    async def _create_assistant_message(
        self, *, metadata: dict[str, Any] | None = None
    ) -> AssistantMessage:
        message = await AssistantRepository.create_message(
            self._db,
            thread_id=self._thread_id,
            role="assistant",
            parts=[],
            metadata=metadata or {"kind": "chat"},
            status="running",
        )
        await self._emit_message(message)
        return message

    async def _prepare_confirmation(
        self,
        *,
        message: AssistantMessage,
        tool_name: str,
        tool_call_id: str,
        args: dict[str, Any],
        confirmation_text: str,
        interrupt_payload: dict[str, Any],
    ) -> None:
        parts = list(message.parts_json or [])
        parts.append({"type": "text", "text": confirmation_text})
        parts.append(
            _tool_call_part(
                tool_call_id=tool_call_id,
                tool_name=tool_name,
                args=args,
                interrupt=interrupt_payload,
            )
        )
        await AssistantRepository.update_message(
            self._db,
            message,
            status="requires_action",
            parts=parts,
            metadata={
                **(message.metadata_json or {}),
                "kind": message.metadata_json.get("kind", "chat")
                if isinstance(message.metadata_json, dict)
                else "chat",
                "pending_confirmation": interrupt_payload,
            },
        )
        await self._emit_message(message)

    async def _run_direct_tool_call(
        self,
        *,
        message: AssistantMessage,
        tool_name: str,
        args: dict[str, Any],
        request_text: str,
    ) -> None:
        tool_call_id = str(uuid.uuid4())
        parts = list(message.parts_json or [])
        parts.append(_tool_call_part(tool_call_id=tool_call_id, tool_name=tool_name, args=args))
        await AssistantRepository.update_message(
            self._db,
            message,
            status="running",
            parts=parts,
        )
        await self._emit_message(message)

        try:
            result, extra_messages = await _execute_tool_call(
                self._db,
                redis=self._redis,
                user_id=self._user_id,
                trip_id=self._trip_id,
                thread_id=self._thread_id,
                tool_name=tool_name,
                arguments=args,
                request_text=request_text,
            )
        except Exception as exc:
            parts[-1] = _tool_call_part(
                tool_call_id=tool_call_id,
                tool_name=tool_name,
                args=args,
                result={"error": {"message": str(exc)}},
                is_error=True,
            )
            parts.append({"type": "text", "text": f"Tool failed: {exc}"})
            await AssistantRepository.update_message(
                self._db,
                message,
                status="incomplete",
                parts=parts,
            )
            await self._emit_message(message)
            return

        parts[-1] = _tool_call_part(
            tool_call_id=tool_call_id,
            tool_name=tool_name,
            args=args,
            result=result,
        )
        if _tool_supports_planner_result(tool_name):
            parts.append(_planner_result_part(tool_name, result))
        parts.append({"type": "text", "text": _format_tool_summary(tool_name, result)})
        await AssistantRepository.update_message(
            self._db,
            message,
            status="complete",
            parts=parts,
        )
        await self._emit_message(message)
        for extra_message in extra_messages:
            await self._emit(extra_message)

    async def handle_user_turn(
        self,
        *,
        client_message_id: uuid.UUID | None,
        text: str,
    ) -> None:
        request_text = text.strip()
        if not request_text:
            raise ValidationApiError("text is required")
        settings = get_settings()
        if len(request_text) > settings.assistant_max_input_chars:
            raise ValidationApiError(
                "text is too long",
                {"max_chars": settings.assistant_max_input_chars},
            )

        user = await self._db.get(UserProfile, self._user_id)
        llm_provider = resolve_assistant_llm_provider(
            user.preferences_json if user and user.preferences_json else None
        )

        thread, history = await AssistantRepository.get_thread_with_messages(
            self._db,
            user_id=self._user_id,
            trip_id=self._trip_id,
        )
        user_message = await AssistantRepository.create_message(
            self._db,
            thread_id=thread.id,
            role="user",
            parts=[{"type": "text", "text": request_text}],
            metadata={"kind": "chat"},
            status="complete",
            message_id=client_message_id,
        )
        await self._emit_message(user_message)

        assistant_message = await self._create_assistant_message(metadata={"kind": "chat"})
        direct_reply = _small_talk_reply(request_text)
        if direct_reply:
            await AssistantRepository.update_message(
                self._db,
                assistant_message,
                status="complete",
                parts=[{"type": "text", "text": direct_reply}],
            )
            await self._emit_message(assistant_message)
            return

        provider_history: list[dict[str, Any]] = [{"role": "system", "content": _system_prompt()}]
        for item in history:
            payload = _message_to_llm_payload(item)
            if payload is not None:
                provider_history.append(payload)
        provider_history.append({"role": "user", "content": request_text})
        provider_history = _trim_provider_history(provider_history)

        for _ in range(MAX_TOOL_TURNS):
            provider_message = await _call_llm(history=provider_history, llm_provider=llm_provider)
            tool_calls = provider_message.get("tool_calls")
            if isinstance(tool_calls, list) and tool_calls:
                provider_history.append(
                    {
                        "role": "assistant",
                        "content": _extract_message_text(provider_message.get("content")) or "",
                        "tool_calls": tool_calls,
                    }
                )
                for tool_call in tool_calls:
                    if not isinstance(tool_call, dict):
                        continue
                    call_id = _string(tool_call.get("id")) or str(uuid.uuid4())
                    function = tool_call.get("function")
                    if not isinstance(function, dict):
                        continue
                    tool_name = _string(function.get("name")) or "tool"
                    args = _decode_tool_arguments(function.get("arguments"))

                    if tool_name not in ALLOWED_TOOL_NAMES:
                        blocked_result = {
                            "error": {
                                "message": f"Tool '{tool_name}' is not allowed",
                            }
                        }
                        parts = list(assistant_message.parts_json or [])
                        parts.append(
                            _tool_call_part(
                                tool_call_id=call_id,
                                tool_name=tool_name,
                                args=args,
                                result=blocked_result,
                                is_error=True,
                            )
                        )
                        parts.append(
                            {
                                "type": "text",
                                "text": f"Blocked unsupported tool request: {tool_name}.",
                            }
                        )
                        await AssistantRepository.update_message(
                            self._db,
                            assistant_message,
                            status="running",
                            parts=parts,
                        )
                        await self._emit(assistant_message_to_response(assistant_message))
                        provider_history.append(
                            {
                                "role": "tool",
                                "tool_call_id": call_id,
                                "name": tool_name,
                                "content": _tool_result_content(blocked_result),
                            }
                        )
                        continue

                    if tool_name in DESTRUCTIVE_TOOLS or (
                        tool_name == "generate_itinerary"
                        and str(args.get("mode") or "").lower() == "replace"
                    ):
                        interrupt_payload, confirmation_text = _pending_confirmation_payload(
                            tool_name="replace_itinerary"
                            if tool_name == "generate_itinerary"
                            and str(args.get("mode") or "").lower() == "replace"
                            else tool_name,
                            tool_call_id=call_id,
                            args=args,
                        )
                        await self._prepare_confirmation(
                            message=assistant_message,
                            tool_name=tool_name,
                            tool_call_id=call_id,
                            args=args,
                            confirmation_text=confirmation_text,
                            interrupt_payload=interrupt_payload,
                        )
                        return

                    parts = list(assistant_message.parts_json or [])
                    parts.append(
                        _tool_call_part(tool_call_id=call_id, tool_name=tool_name, args=args)
                    )
                    await AssistantRepository.update_message(
                        self._db,
                        assistant_message,
                        status="running",
                        parts=parts,
                    )
                    await self._emit(assistant_message_to_response(assistant_message))

                    try:
                        result, extra_messages = await _execute_tool_call(
                            self._db,
                            redis=self._redis,
                            user_id=self._user_id,
                            trip_id=self._trip_id,
                            thread_id=self._thread_id,
                            tool_name=tool_name,
                            arguments=args,
                            request_text=request_text,
                        )
                        parts[-1] = _tool_call_part(
                            tool_call_id=call_id,
                            tool_name=tool_name,
                            args=args,
                            result=result,
                        )
                        if _tool_supports_planner_result(tool_name):
                            parts.append(_planner_result_part(tool_name, result))
                        await AssistantRepository.update_message(
                            self._db,
                            assistant_message,
                            status="running",
                            parts=parts,
                        )
                        await self._emit(assistant_message_to_response(assistant_message))
                        for extra_message in extra_messages:
                            await self._emit(extra_message)
                        provider_history.append(
                            {
                                "role": "tool",
                                "tool_call_id": call_id,
                                "name": tool_name,
                                "content": _tool_result_content(result),
                            }
                        )
                    except Exception as exc:
                        result = {"error": {"message": str(exc)}}
                        parts[-1] = _tool_call_part(
                            tool_call_id=call_id,
                            tool_name=tool_name,
                            args=args,
                            result=result,
                            is_error=True,
                        )
                        parts.append({"type": "text", "text": f"Tool failed: {exc}"})
                        await AssistantRepository.update_message(
                            self._db,
                            assistant_message,
                            status="incomplete",
                            parts=parts,
                        )
                        await self._emit(assistant_message_to_response(assistant_message))
                        return
                continue

            content = _extract_message_text(provider_message.get("content"))
            parts = list(assistant_message.parts_json or [])
            if content:
                parts.append({"type": "text", "text": content})
            elif parts:
                fallback_text = _fallback_assistant_text(parts)
                if fallback_text:
                    parts.append({"type": "text", "text": fallback_text})
            else:
                parts.append({"type": "text", "text": "I’m ready to help with this trip."})
            await AssistantRepository.update_message(
                self._db,
                assistant_message,
                status="complete",
                parts=parts,
            )
            await self._emit(assistant_message_to_response(assistant_message))
            return

        parts = list(assistant_message.parts_json or [])
        parts.append(
            {
                "type": "text",
                "text": "I hit the tool-turn limit for this request. Please narrow the task and try again.",
            }
        )
        await AssistantRepository.update_message(
            self._db,
            assistant_message,
            status="incomplete",
            parts=parts,
        )
        await self._emit(assistant_message_to_response(assistant_message))

    async def handle_command(
        self,
        *,
        client_message_id: uuid.UUID | None,
        command_name: str,
        args: dict[str, Any],
    ) -> None:
        normalized_name = command_name.strip().lower()
        tool_name = DIRECT_COMMAND_TOOL_MAP.get(normalized_name)
        if tool_name is None:
            raise ValidationApiError(f"Unsupported assistant command: {command_name}")

        request_text = _format_command_request_text(normalized_name, args)
        settings = get_settings()
        if len(request_text) > settings.assistant_max_input_chars:
            raise ValidationApiError(
                "command payload is too long",
                {"max_chars": settings.assistant_max_input_chars},
            )
        user_message = await AssistantRepository.create_message(
            self._db,
            thread_id=self._thread_id,
            role="user",
            parts=[{"type": "text", "text": request_text}],
            metadata={
                "kind": "command",
                "command_name": normalized_name,
                "command_args": _jsonable(args),
            },
            status="complete",
            message_id=client_message_id,
        )
        await self._emit_message(user_message)

        assistant_message = await self._create_assistant_message(
            metadata={"kind": "command", "command_name": normalized_name}
        )

        if tool_name in DESTRUCTIVE_TOOLS:
            interrupt_payload, confirmation_text = _pending_confirmation_payload(
                tool_name=tool_name,
                tool_call_id=str(uuid.uuid4()),
                args=args,
            )
            await self._prepare_confirmation(
                message=assistant_message,
                tool_name=tool_name,
                tool_call_id=str(interrupt_payload["tool_call_id"]),
                args=args,
                confirmation_text=confirmation_text,
                interrupt_payload=interrupt_payload,
            )
            return

        await self._run_direct_tool_call(
            message=assistant_message,
            tool_name=tool_name,
            args=args,
            request_text=request_text,
        )

    async def handle_confirmation(
        self,
        *,
        message_id: uuid.UUID,
        tool_call_id: str,
        confirmed: bool,
    ) -> None:
        message = await AssistantRepository.get_message_for_trip(
            self._db,
            user_id=self._user_id,
            trip_id=self._trip_id,
            message_id=message_id,
        )
        parts = list(message.parts_json or [])
        tool_index = next(
            (
                idx
                for idx, part in enumerate(parts)
                if isinstance(part, dict)
                and part.get("type") == "tool-call"
                and str(part.get("toolCallId")) == tool_call_id
            ),
            -1,
        )
        if tool_index < 0:
            raise ValidationApiError("Pending tool call not found")
        tool_part = parts[tool_index]
        interrupt = tool_part.get("interrupt")
        if not isinstance(interrupt, dict):
            raise ValidationApiError("This tool call does not require confirmation")
        payload = interrupt.get("payload")
        if not isinstance(payload, dict):
            raise ValidationApiError("Invalid confirmation payload")
        tool_name = (
            _string(payload.get("tool_name")) or _string(tool_part.get("toolName")) or "tool"
        )
        resolved_tool_name = (
            _string(tool_part.get("toolName")) or "generate_itinerary"
            if tool_name == "replace_itinerary"
            else tool_name
        )
        _validate_tool_name(resolved_tool_name)
        args = payload.get("args") if isinstance(payload.get("args"), dict) else {}

        if not confirmed:
            tool_part["result"] = {"cancelled": True}
            tool_part.pop("interrupt", None)
            parts[tool_index] = tool_part
            parts.append({"type": "text", "text": "Cancelled. I did not make any changes."})
            await AssistantRepository.update_message(
                self._db,
                message,
                status="complete",
                parts=parts,
                metadata={**(message.metadata_json or {}), "pending_confirmation": None},
            )
            await self._emit(assistant_message_to_response(message))
            return

        await AssistantRepository.update_message(
            self._db,
            message,
            status="running",
            metadata={**(message.metadata_json or {}), "pending_confirmation": None},
        )
        await self._emit(assistant_message_to_response(message))

        try:
            result, extra_messages = await _execute_tool_call(
                self._db,
                redis=self._redis,
                user_id=self._user_id,
                trip_id=self._trip_id,
                thread_id=message.thread_id,
                tool_name=resolved_tool_name,
                arguments=args,
                request_text="Confirmed assistant action",
            )
        except Exception as exc:
            tool_part["result"] = {"error": {"message": str(exc)}}
            tool_part["isError"] = True
            tool_part.pop("interrupt", None)
            parts[tool_index] = tool_part
            parts.append({"type": "text", "text": f"Confirmed action failed: {exc}"})
            await AssistantRepository.update_message(
                self._db,
                message,
                status="incomplete",
                parts=parts,
            )
            await self._emit(assistant_message_to_response(message))
            return

        tool_part["result"] = _jsonable(result)
        tool_part.pop("interrupt", None)
        parts[tool_index] = tool_part
        if _tool_supports_planner_result(tool_name):
            parts.append(_planner_result_part(tool_name, result))
        parts.append({"type": "text", "text": _format_tool_summary(tool_name, result)})
        await AssistantRepository.update_message(
            self._db,
            message,
            status="complete",
            parts=parts,
        )
        await self._emit(assistant_message_to_response(message))
        for extra_message in extra_messages:
            await self._emit(extra_message)


async def stream_assistant_messages(
    db: AsyncSession,
    *,
    redis: Redis,
    user_id: uuid.UUID,
    trip_id: uuid.UUID,
    client_message_id: uuid.UUID | None,
    text: str | None,
    confirmation: dict[str, Any] | None,
    command: dict[str, Any] | None,
) -> AsyncIterator[dict[str, Any]]:
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    async def emit(message: AssistantMessageResponse) -> None:
        await queue.put(
            {
                "type": STREAM_EVENT_MESSAGE_UPSERT,
                "message": message.model_dump(mode="json"),
            }
        )

    async def run() -> None:
        settings = get_settings()
        await limit_user_request(
            redis,
            str(user_id),
            "assistant:turn",
            settings.rate_limit_assistant_turns_per_min,
            window_seconds=60,
        )
        thread = await AssistantRepository.get_or_create_thread(
            db, user_id=user_id, trip_id=trip_id
        )
        session = PlannerAssistantSession(
            db=db,
            redis=redis,
            user_id=user_id,
            trip_id=trip_id,
            thread_id=thread.id,
            emit=emit,
        )
        try:
            if confirmation is not None:
                await session.handle_confirmation(
                    message_id=uuid.UUID(str(confirmation["message_id"])),
                    tool_call_id=str(confirmation["tool_call_id"]),
                    confirmed=bool(confirmation["confirmed"]),
                )
            elif command is not None:
                await session.handle_command(
                    client_message_id=client_message_id,
                    command_name=str(command.get("name") or ""),
                    args=command.get("args") if isinstance(command.get("args"), dict) else {},
                )
            else:
                await session.handle_user_turn(client_message_id=client_message_id, text=text or "")
            await queue.put({"type": STREAM_EVENT_DONE})
        except Exception as exc:
            error_message = exc.message if isinstance(exc, ApiError) else str(exc)
            await queue.put(
                {
                    "type": STREAM_EVENT_ERROR,
                    "error": {
                        "message": error_message,
                        "code": getattr(exc, "code", "ASSISTANT_ERROR"),
                    },
                }
            )
        finally:
            await queue.put(None)

    task = asyncio.create_task(run())
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield item
    finally:
        if not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
