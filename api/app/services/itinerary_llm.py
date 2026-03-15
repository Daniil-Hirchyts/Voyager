from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from datetime import time
from typing import Any

import httpx

from app.config import get_settings
from app.db.models import Trip, TripDay
from app.errors import TooManyRequestsError
from app.metrics import increment_itinerary_llm_metric
from app.rate_limit.limiter import enforce_limit
from app.services.google_maps import GoogleMapsError, lookup_google_place, search_google_places
from app.services.job_progress import ProgressTracker

logger = logging.getLogger(__name__)

SLOT_ORDER = ("morning", "afternoon", "evening")
SLOT_START_TIMES: dict[str, time] = {
    "morning": time(9, 0),
    "afternoon": time(13, 30),
    "evening": time(19, 0),
}
SLOT_DEFAULT_DURATION: dict[str, int] = {
    "morning": 120,
    "afternoon": 150,
    "evening": 120,
}
MIN_TOOL_TURNS = 10
MAX_TOOL_TURNS_PER_DAY = 12
MAX_FINAL_OUTPUT_REPAIRS = 2


@dataclass
class OpenRouterGenerationResult:
    attempted: bool
    success: bool
    model: str | None
    candidates_by_day: dict[uuid.UUID, list[dict[str, Any]]]
    errors: list[dict[str, Any]]


def _sanitize_error(
    *,
    code: str,
    message: str,
    model: str | None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "provider": "openrouter",
        "code": code,
        "message": message,
    }
    if model:
        payload["model"] = model
    if details:
        payload["details"] = details
    return payload


def _strip_code_fence(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```") and stripped.endswith("```"):
        lines = stripped.splitlines()
        if len(lines) >= 2:
            return "\n".join(lines[1:-1]).strip()
    return stripped


def _extract_message_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        if content.get("type") in {"text", "output_text"} and isinstance(content.get("text"), str):
            return content["text"]
        if isinstance(content.get("content"), str):
            return content["content"]
    if isinstance(content, list):
        parts: list[str] = []
        for entry in content:
            if not isinstance(entry, dict):
                continue
            if entry.get("type") in {"text", "output_text"} and isinstance(entry.get("text"), str):
                parts.append(entry["text"])
        if parts:
            return "".join(parts)
    raise ValueError("Unsupported message content format")


def _normalize_duration(raw: Any, *, slot: str) -> int:
    default_duration = SLOT_DEFAULT_DURATION[slot]
    if raw is None:
        return default_duration
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default_duration
    return max(30, min(value, 360))


def _normalize_tags(raw: Any, *, slot: str) -> list[str]:
    tags: list[str] = [slot]
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, str):
                normalized = item.strip().lower()
                if normalized and normalized not in tags:
                    tags.append(normalized)
    return tags


def _normalize_day_candidates(
    *,
    day_payload: dict[str, Any],
    day_id: uuid.UUID,
) -> list[dict[str, Any]]:
    items_raw = day_payload.get("activities")
    if not isinstance(items_raw, list):
        items_raw = day_payload.get("items")
    if not isinstance(items_raw, list) or len(items_raw) < 3:
        raise ValueError(f"Day {day_id} did not return at least 3 activities")

    by_slot: dict[str, dict[str, Any]] = {}
    sequence: list[dict[str, Any]] = []
    for item in items_raw:
        if isinstance(item, dict):
            sequence.append(item)
            slot = str(item.get("slot", "")).strip().lower()
            if slot in SLOT_ORDER and slot not in by_slot:
                by_slot[slot] = item

    normalized_rows: list[dict[str, Any]] = []
    for idx, slot in enumerate(SLOT_ORDER):
        item = by_slot.get(slot)
        if item is None and idx < len(sequence):
            item = sequence[idx]
        if item is None:
            raise ValueError(f"Day {day_id} is missing slot {slot}")

        title = str(item.get("title", "")).strip()
        if not title:
            raise ValueError(f"Day {day_id} slot {slot} has empty title")

        description_raw = item.get("description")
        description = str(description_raw).strip() if isinstance(description_raw, str) else None
        place_query_raw = item.get("place_query", item.get("placeQuery"))
        place_query = str(place_query_raw).strip() if isinstance(place_query_raw, str) else None
        google_place_id_raw = item.get("google_place_id", item.get("googlePlaceId"))
        google_place_id = (
            str(google_place_id_raw).strip() if isinstance(google_place_id_raw, str) else None
        )
        place_name_raw = item.get("place_name", item.get("placeName"))
        place_name = str(place_name_raw).strip() if isinstance(place_name_raw, str) else None
        address_text_raw = item.get("address_text", item.get("addressText"))
        address_text = str(address_text_raw).strip() if isinstance(address_text_raw, str) else None
        if not google_place_id:
            raise ValueError(f"Day {day_id} slot {slot} is missing google_place_id")
        if not place_name:
            raise ValueError(f"Day {day_id} slot {slot} is missing place_name")
        if not address_text:
            raise ValueError(f"Day {day_id} slot {slot} is missing address_text")
        normalized_rows.append(
            {
                "title": title[:255],
                "description": description[:2000] if description else None,
                "start_time": SLOT_START_TIMES[slot],
                "duration_min": _normalize_duration(item.get("duration_min"), slot=slot),
                "tags_json": _normalize_tags(item.get("tags"), slot=slot),
                "place_query": place_query[:255] if place_query else title[:255],
                "google_place_id": google_place_id[:255] if google_place_id else None,
                "place_name": place_name[:255] if place_name else None,
                "address_text": address_text[:500] if address_text else None,
            }
        )
    return normalized_rows


def _normalize_output(
    *,
    response_text: str,
    days: list[TripDay],
) -> dict[uuid.UUID, list[dict[str, Any]]]:
    parsed = json.loads(_strip_code_fence(response_text))
    if not isinstance(parsed, dict):
        raise ValueError("Top-level LLM payload must be a JSON object")

    day_entries = parsed.get("days")
    if not isinstance(day_entries, list):
        raise ValueError("LLM payload must include 'days' as a list")

    day_map = {day.id: day for day in days}
    candidates_by_day: dict[uuid.UUID, list[dict[str, Any]]] = {}
    for entry in day_entries:
        if not isinstance(entry, dict):
            continue
        day_id_raw = entry.get("day_id")
        if not day_id_raw:
            continue
        day_id = uuid.UUID(str(day_id_raw))
        if day_id not in day_map:
            continue
        candidates_by_day[day_id] = _normalize_day_candidates(day_payload=entry, day_id=day_id)

    missing = [str(day.id) for day in days if day.id not in candidates_by_day]
    if missing:
        raise ValueError(f"LLM payload missing scoped days: {missing}")
    _validate_candidate_diversity(candidates_by_day)
    return candidates_by_day


def _normalize_title_key(value: str) -> str:
    return " ".join(value.casefold().split())


def _validate_candidate_diversity(
    candidates_by_day: dict[uuid.UUID, list[dict[str, Any]]],
) -> None:
    seen_place_ids: dict[str, uuid.UUID] = {}
    seen_titles: dict[str, uuid.UUID] = {}
    for day_id, rows in candidates_by_day.items():
        for row in rows:
            place_id = str(row.get("google_place_id") or "").strip().casefold()
            if place_id:
                prior_day_id = seen_place_ids.get(place_id)
                if prior_day_id is not None:
                    raise ValueError(
                        "LLM payload reused the same google_place_id across multiple days"
                    )
                seen_place_ids[place_id] = day_id

            title_key = _normalize_title_key(str(row.get("title") or ""))
            if title_key:
                prior_day_id = seen_titles.get(title_key)
                if prior_day_id is not None:
                    raise ValueError("LLM payload reused the same activity title across multiple days")
                seen_titles[title_key] = day_id


def _system_prompt() -> str:
    return (
        "You are a trip itinerary planner. "
        "Use the provided Google place tools to ground every activity to a real, specific venue, "
        "landmark, museum, restaurant, park, square, bridge, or attraction in the destination "
        "before your final answer. "
        "Every activity must be backed by a Google place ID and the exact formatted address returned "
        "by google_place_details. "
        "If you cannot ground an activity to a real Google place with a canonical formatted address, "
        "replace that activity with one you can ground. "
        "Never use the destination city, region, district, neighborhood, or locality itself as the "
        "activity place. Every place must be specific enough that someone can navigate to it directly. "
        "Do not repeat the same Google place ID or the same activity title across different days "
        "unless the user explicitly asked for repeats. "
        "Never invent Google place IDs or addresses. Respond with JSON only. "
        'Schema: {"days":[{"day_id":"uuid","activities":['
        '{"slot":"morning|afternoon|evening","title":"string",'
        '"description":"string","duration_min":int,"tags":["string"],'
        '"place_query":"string","google_place_id":"string|null",'
        '"place_name":"string|null","address_text":"string|null"}'
        "]}]}. Return exactly 3 activities per day for morning, afternoon, and evening. "
        "Every activity must include google_place_id, place_name, and address_text from Google."
    )


def _user_prompt(*, trip: Trip, days: list[TripDay], seed: int | None) -> str:
    destination = trip.destination_text
    payload = {
        "trip": {
            "id": str(trip.id),
            "destination_text": destination,
            "trip_type": trip.trip_type,
            "title": trip.title,
            "seed": seed,
        },
        "days": [
            {
                "day_id": str(day.id),
                "day_index": day.day_index,
                "date": day.date.isoformat(),
            }
            for day in days
        ],
    }
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=True)


def _google_places_search_tool() -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": "google_places_search",
            "description": "Search Google Places for real destinations, landmarks, venues, restaurants, museums, and neighborhoods.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Natural-language place query that includes the city or region when needed.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of Google place candidates to return.",
                        "minimum": 1,
                        "maximum": 5,
                    },
                },
                "required": ["query"],
                "additionalProperties": False,
            },
        },
    }


def _google_place_details_tool() -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": "google_place_details",
            "description": "Fetch details for a Google place ID, including its canonical name and formatted address.",
            "parameters": {
                "type": "object",
                "properties": {
                    "place_id": {
                        "type": "string",
                        "description": "The Google place ID returned by google_places_search.",
                    }
                },
                "required": ["place_id"],
                "additionalProperties": False,
            },
        },
    }


def _tool_definitions() -> list[dict[str, Any]]:
    return [_google_places_search_tool(), _google_place_details_tool()]


def _tool_message_payload(message: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {"role": "assistant"}
    if "content" in message:
        payload["content"] = message.get("content")
    tool_calls = message.get("tool_calls")
    if isinstance(tool_calls, list):
        payload["tool_calls"] = tool_calls
    return payload


def _serialize_google_search_item(item: Any) -> dict[str, Any]:
    metadata = item.metadata if isinstance(getattr(item, "metadata", None), dict) else {}
    return {
        "place_id": item.place_id,
        "name": item.name,
        "label": item.label,
        "address_text": item.address_text,
        "category": item.category,
        "country": item.country,
        "region": item.region,
        "lat": item.lat,
        "lon": item.lon,
        "types": metadata.get("types"),
        "google_maps_uri": metadata.get("google_maps_uri"),
    }


def _serialize_google_details(details: Any) -> dict[str, Any]:
    metadata = details.metadata if isinstance(getattr(details, "metadata", None), dict) else {}
    return {
        "place_id": details.place_id,
        "name": details.name,
        "formatted_address": details.formatted_address,
        "category": details.category,
        "country": details.country,
        "region": details.region,
        "lat": details.lat,
        "lon": details.lng,
        "timezone": details.timezone,
        "types": metadata.get("types"),
        "google_maps_uri": metadata.get("google_maps_uri"),
        "website_uri": metadata.get("website_uri"),
    }


def _decode_tool_arguments(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _tool_result_content(payload: dict[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=True)


async def _execute_tool_call(
    name: str,
    arguments: Any,
    *,
    progress: ProgressTracker | None = None,
    call_id: str | None = None,
) -> dict[str, Any]:
    payload = _decode_tool_arguments(arguments)
    progress_call_id = call_id
    if progress is not None:
        progress_call_id = await progress.tool_call(
            name,
            payload,
            call_id=call_id,
            phase="orchestration",
        )

    async def _emit_and_return(result: dict[str, Any], *, is_error: bool = False) -> dict[str, Any]:
        if progress is not None:
            await progress.tool_result(
                name,
                result,
                is_error=is_error,
                call_id=progress_call_id,
                phase="orchestration",
            )
        return result

    if name == "google_places_search":
        query = str(payload.get("query", "")).strip()
        if not query:
            return await _emit_and_return(
                {"error": {"code": "INVALID_ARGUMENT", "message": "query is required"}},
                is_error=True,
            )
        raw_limit = payload.get("limit")
        try:
            limit = int(raw_limit) if raw_limit is not None else 3
        except (TypeError, ValueError):
            limit = 3
        limit = max(1, min(limit, 5))
        try:
            items = await search_google_places(query, limit)
        except GoogleMapsError as exc:
            return await _emit_and_return(
                {
                    "error": {
                        "code": "GOOGLE_MAPS_ERROR",
                        "message": "Google place search failed",
                        "details": {"error": str(exc)},
                    }
                },
                is_error=True,
            )
        return await _emit_and_return(
            {"items": [_serialize_google_search_item(item) for item in items]}
        )

    if name == "google_place_details":
        place_id = str(payload.get("place_id", "")).strip()
        if not place_id:
            return await _emit_and_return(
                {"error": {"code": "INVALID_ARGUMENT", "message": "place_id is required"}},
                is_error=True,
            )
        try:
            details = await lookup_google_place(place_id)
        except GoogleMapsError as exc:
            return await _emit_and_return(
                {
                    "error": {
                        "code": "GOOGLE_MAPS_ERROR",
                        "message": "Google place details lookup failed",
                        "details": {"error": str(exc)},
                    }
                },
                is_error=True,
            )
        return await _emit_and_return(
            {"item": _serialize_google_details(details) if details is not None else None}
        )

    return await _emit_and_return(
        {"error": {"code": "UNKNOWN_TOOL", "message": f"Unsupported tool {name}"}},
        is_error=True,
    )


def _get_redis_client():
    try:
        from app.db.session import redis_client as session_redis_client
    except Exception:  # pragma: no cover - defensive for isolated unit tests
        return None
    return session_redis_client


async def _call_openrouter(
    *,
    model: str,
    trip: Trip,
    days: list[TripDay],
    seed: int | None,
    progress: ProgressTracker | None = None,
) -> dict[uuid.UUID, list[dict[str, Any]]]:
    settings = get_settings()
    endpoint = f"{settings.llm_openrouter_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.llm_openrouter_api_key}",
        "Content-Type": "application/json",
    }
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _system_prompt()},
        {"role": "user", "content": _user_prompt(trip=trip, days=days, seed=seed)},
    ]
    async with httpx.AsyncClient(timeout=settings.llm_openrouter_timeout_sec) as client:
        max_tool_turns = max(MIN_TOOL_TURNS, len(days) * MAX_TOOL_TURNS_PER_DAY)
        final_output_repairs = 0
        for turn_index in range(max_tool_turns):
            if progress is not None:
                await progress.step(
                    "Model turn",
                    f"Turn {turn_index + 1}",
                    phase="orchestration",
                )
            body = {
                "model": model,
                "temperature": 0.2,
                "messages": messages,
                "tools": _tool_definitions(),
                "tool_choice": "auto",
            }
            response = await client.post(endpoint, headers=headers, json=body)

            if response.status_code == 429:
                raise RuntimeError("PROVIDER_LIMITED")
            if response.status_code >= 500:
                raise RuntimeError(f"PROVIDER_ERROR:{response.status_code}")
            if response.status_code >= 400:
                raise ValueError(f"PROVIDER_BAD_REQUEST:{response.status_code}")

            payload = response.json()
            choices = payload.get("choices")
            if not isinstance(choices, list) or not choices:
                raise ValueError("Missing choices in provider response")
            first = choices[0]
            if not isinstance(first, dict):
                raise ValueError("Invalid provider choice shape")
            message = first.get("message")
            if not isinstance(message, dict):
                raise ValueError("Missing message in provider choice")

            tool_calls = message.get("tool_calls")
            if isinstance(tool_calls, list) and tool_calls:
                if progress is not None:
                    await progress.step(
                        "Model emitted tool calls",
                        f"{len(tool_calls)} call(s)",
                        phase="orchestration",
                    )
                messages.append(_tool_message_payload(message))
                for tool_call in tool_calls:
                    if not isinstance(tool_call, dict):
                        continue
                    tool_call_id = str(tool_call.get("id") or "").strip()
                    function = tool_call.get("function")
                    if not tool_call_id or not isinstance(function, dict):
                        continue
                    tool_name = str(function.get("name") or "").strip()
                    tool_result = await _execute_tool_call(
                        tool_name,
                        function.get("arguments"),
                        progress=progress,
                        call_id=tool_call_id,
                    )
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "name": tool_name,
                            "content": _tool_result_content(tool_result),
                        }
                    )
                continue

            content = _extract_message_text(message.get("content"))
            try:
                return _normalize_output(response_text=content, days=days)
            except (ValueError, json.JSONDecodeError) as exc:
                if final_output_repairs >= MAX_FINAL_OUTPUT_REPAIRS:
                    raise
                final_output_repairs += 1
                if progress is not None:
                    await progress.step(
                        "Repairing final output",
                        str(exc),
                        phase="orchestration",
                    )
                messages.append({"role": "assistant", "content": content})
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "Your previous JSON was invalid: "
                            f"{exc}. Return corrected JSON only. "
                            "Keep the same schema, do not repeat any google_place_id "
                            "or activity title across different days, and use tools again "
                            "if you need additional distinct places."
                        ),
                    }
                )
                continue

    raise ValueError("Provider did not finish grounded itinerary generation")


async def generate_with_openrouter(
    *,
    trip: Trip,
    days: list[TripDay],
    seed: int | None,
    constraints: dict[str, Any],
    progress: ProgressTracker | None = None,
) -> OpenRouterGenerationResult:
    settings = get_settings()
    if not settings.itinerary_llm_enabled:
        return OpenRouterGenerationResult(
            attempted=False,
            success=False,
            model=None,
            candidates_by_day={},
            errors=[],
        )

    models = settings.itinerary_llm_model_order()
    if not models:
        return OpenRouterGenerationResult(
            attempted=True,
            success=False,
            model=None,
            candidates_by_day={},
            errors=[
                _sanitize_error(
                    code="INTEGRATION_NOT_CONFIGURED",
                    message="No OpenRouter models configured",
                    model=None,
                    details={"missing_env_vars": ["VOYAGER_LLM_OPENROUTER_MODEL_ORDER"]},
                )
            ],
        )

    if not settings.llm_openrouter_api_key:
        return OpenRouterGenerationResult(
            attempted=True,
            success=False,
            model=None,
            candidates_by_day={},
            errors=[
                _sanitize_error(
                    code="INTEGRATION_NOT_CONFIGURED",
                    message="OpenRouter API key is not configured",
                    model=None,
                    details={"missing_env_vars": ["VOYAGER_LLM_OPENROUTER_API_KEY"]},
                )
            ],
        )

    errors: list[dict[str, Any]] = []
    redis = _get_redis_client()
    for model in models:
        await increment_itinerary_llm_metric(redis, "attempt")
        try:
            await enforce_limit(
                redis,
                prefix="rl:provider",
                identifier=f"openrouter:{model}",
                scope="itinerary.generate",
                limit=settings.rate_limit_itinerary_provider_per_min,
                window_seconds=60,
            )
        except TooManyRequestsError as exc:
            errors.append(
                _sanitize_error(
                    code="PROVIDER_LIMITED",
                    message="Itinerary provider rate limit exceeded",
                    model=model,
                    details=exc.details,
                )
            )
            continue

        try:
            candidates = await _call_openrouter(
                model=model,
                trip=trip,
                days=days,
                seed=seed,
                progress=progress,
            )
        except httpx.TimeoutException:
            errors.append(
                _sanitize_error(
                    code="UPSTREAM_PROVIDER_TIMEOUT",
                    message="OpenRouter request timed out",
                    model=model,
                )
            )
            continue
        except RuntimeError as exc:
            text = str(exc)
            if text == "PROVIDER_LIMITED":
                errors.append(
                    _sanitize_error(
                        code="PROVIDER_LIMITED",
                        message="OpenRouter returned provider-limited response",
                        model=model,
                    )
                )
            elif text.startswith("PROVIDER_ERROR:"):
                errors.append(
                    _sanitize_error(
                        code="UPSTREAM_PROVIDER_ERROR",
                        message="OpenRouter upstream provider error",
                        model=model,
                        details={"status_code": text.split(":")[1]},
                    )
                )
            else:
                errors.append(
                    _sanitize_error(
                        code="UPSTREAM_PROVIDER_ERROR",
                        message="OpenRouter request failed",
                        model=model,
                        details={"error": text},
                    )
                )
            continue
        except (ValueError, json.JSONDecodeError) as exc:
            errors.append(
                _sanitize_error(
                    code="PROVIDER_RESPONSE_INVALID",
                    message="OpenRouter response validation failed",
                    model=model,
                    details={"error": str(exc)},
                )
            )
            continue
        except Exception as exc:  # pragma: no cover - defensive fallback
            logger.exception("openrouter_unexpected_error", extra={"trace_id": "-"})
            errors.append(
                _sanitize_error(
                    code="UPSTREAM_PROVIDER_ERROR",
                    message="Unexpected OpenRouter integration error",
                    model=model,
                    details={"error": str(exc)},
                )
            )
            continue

        await increment_itinerary_llm_metric(redis, "success")
        return OpenRouterGenerationResult(
            attempted=True,
            success=True,
            model=model,
            candidates_by_day=candidates,
            errors=errors,
        )

    if errors:
        await increment_itinerary_llm_metric(redis, "failure")
    return OpenRouterGenerationResult(
        attempted=True,
        success=False,
        model=None,
        candidates_by_day={},
        errors=errors,
    )
