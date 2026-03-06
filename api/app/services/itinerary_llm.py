from __future__ import annotations

import hashlib
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
        normalized_rows.append(
            {
                "title": title[:255],
                "description": description[:2000] if description else None,
                "start_time": SLOT_START_TIMES[slot],
                "duration_min": _normalize_duration(item.get("duration_min"), slot=slot),
                "tags_json": _normalize_tags(item.get("tags"), slot=slot),
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
    return candidates_by_day


def _deterministic_mock_candidates(
    *,
    trip: Trip,
    days: list[TripDay],
    model: str,
    seed: int | None,
) -> dict[uuid.UUID, list[dict[str, Any]]]:
    destination = trip.destination_text.split(",")[0].strip() or "destination"
    preferences = [p for p in trip.preferences_json if isinstance(p, str)]
    if not preferences:
        preferences = ["local highlights"]
    seed_base = seed if seed is not None else 0

    rows: dict[uuid.UUID, list[dict[str, Any]]] = {}
    for day in days:
        day_rows: list[dict[str, Any]] = []
        for slot_idx, slot in enumerate(SLOT_ORDER):
            preference = preferences[(day.day_index + slot_idx) % len(preferences)]
            key = f"{model}:{trip.id}:{day.id}:{slot}:{seed_base}:{preference}"
            digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:8]
            day_rows.append(
                {
                    "title": f"{slot.title()} plan in {destination} ({digest})",
                    "description": (
                        f"OpenRouter mocked {slot} plan for day {day.day_index + 1} "
                        f"focused on {preference}."
                    ),
                    "start_time": SLOT_START_TIMES[slot],
                    "duration_min": SLOT_DEFAULT_DURATION[slot],
                    "tags_json": [slot, preference],
                }
            )
        rows[day.id] = day_rows
    return rows


def _system_prompt() -> str:
    return (
        "You are a trip itinerary planner. Respond with JSON only. "
        "Schema: {\"days\":[{\"day_id\":\"uuid\",\"activities\":["
        "{\"slot\":\"morning|afternoon|evening\",\"title\":\"string\","
        "\"description\":\"string\",\"duration_min\":int,\"tags\":[\"string\"]}"
        "]}]}. Return exactly 3 activities per day for morning, afternoon, and evening."
    )


def _user_prompt(*, trip: Trip, days: list[TripDay], seed: int | None) -> str:
    destination = trip.destination_text
    preferences = [p for p in trip.preferences_json if isinstance(p, str)]
    payload = {
        "trip": {
            "id": str(trip.id),
            "destination_text": destination,
            "trip_type": trip.trip_type,
            "preferences": preferences,
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
) -> dict[uuid.UUID, list[dict[str, Any]]]:
    settings = get_settings()
    endpoint = f"{settings.llm_openrouter_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.llm_openrouter_api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": _system_prompt()},
            {"role": "user", "content": _user_prompt(trip=trip, days=days, seed=seed)},
        ],
    }

    async with httpx.AsyncClient(timeout=settings.llm_openrouter_timeout_sec) as client:
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
    content = _extract_message_text(message.get("content"))
    return _normalize_output(response_text=content, days=days)


async def generate_with_openrouter(
    *,
    trip: Trip,
    days: list[TripDay],
    seed: int | None,
    constraints: dict[str, Any],
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

    llm_mock_mode = str(constraints.get("llm_mock_mode", "")).strip().lower()
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
            if llm_mock_mode == "provider_error":
                raise RuntimeError("INJECTED_PROVIDER_FAILURE")
            if llm_mock_mode == "malformed":
                raise ValueError("INJECTED_PROVIDER_MALFORMED_RESPONSE")
            if llm_mock_mode == "success":
                candidates = _deterministic_mock_candidates(
                    trip=trip, days=days, model=model, seed=seed
                )
            else:
                candidates = await _call_openrouter(model=model, trip=trip, days=days, seed=seed)
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
