from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import time
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.db.models import ActivityCategory

_DATA_PATH = Path(__file__).with_name("editorial_trip_templates.json")


@dataclass(frozen=True)
class EditorialTemplatePlace:
    google_place_id: str
    name: str
    category: str | None
    address_text: str
    lat: float | None
    lon: float | None
    country: str | None
    region: str | None
    time_zone_id: str | None
    metadata: dict[str, Any]


@dataclass(frozen=True)
class EditorialActivitySeed:
    category: ActivityCategory
    title: str
    description: str | None
    start_time: time
    duration_min: int
    place: EditorialTemplatePlace


EditorialTripTemplate = tuple[tuple[EditorialActivitySeed, ...], ...]


def _normalize_route_id(route_id: str) -> str:
    return route_id.strip().casefold()


def _parse_category(value: str) -> ActivityCategory:
    normalized = value.strip().casefold()
    try:
        return ActivityCategory(normalized)
    except ValueError as exc:
        raise ValueError(f"Unsupported editorial activity category: {value}") from exc


def _parse_time(value: str) -> time:
    parsed = time.fromisoformat(value)
    return parsed.replace(tzinfo=None)


def _parse_place(payload: dict[str, Any]) -> EditorialTemplatePlace:
    google_place_id = str(payload.get("google_place_id") or "").strip()
    name = str(payload.get("place_name") or "").strip()
    address_text = str(payload.get("address_text") or "").strip()
    if not google_place_id or not name or not address_text:
        raise ValueError("Editorial template place is missing required grounding data")

    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}

    lat = payload.get("lat")
    lon = payload.get("lon")
    return EditorialTemplatePlace(
        google_place_id=google_place_id,
        name=name,
        category=str(payload.get("place_category")).strip() or None
        if payload.get("place_category") is not None
        else None,
        address_text=address_text,
        lat=float(lat) if isinstance(lat, (int, float)) else None,
        lon=float(lon) if isinstance(lon, (int, float)) else None,
        country=str(payload.get("country")).strip() or None
        if payload.get("country") is not None
        else None,
        region=str(payload.get("region")).strip() or None
        if payload.get("region") is not None
        else None,
        time_zone_id=str(payload.get("time_zone_id")).strip() or None
        if payload.get("time_zone_id") is not None
        else None,
        metadata=metadata,
    )


def _parse_activity(payload: dict[str, Any]) -> EditorialActivitySeed:
    title = str(payload.get("title") or "").strip()
    if not title:
        raise ValueError("Editorial template activity is missing a title")

    duration_min = payload.get("duration_min")
    if not isinstance(duration_min, int):
        raise ValueError(f"Editorial template activity {title!r} is missing duration_min")

    description = payload.get("description")
    return EditorialActivitySeed(
        category=_parse_category(str(payload.get("category") or "")),
        title=title,
        description=str(description).strip()
        if isinstance(description, str) and description.strip()
        else None,
        start_time=_parse_time(str(payload.get("start_time") or "")),
        duration_min=duration_min,
        place=_parse_place(payload),
    )


@lru_cache
def _load_templates() -> dict[str, EditorialTripTemplate]:
    raw = json.loads(_DATA_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("Editorial template data must be a JSON object")

    templates: dict[str, EditorialTripTemplate] = {}
    for route_id, payload in raw.items():
        if not isinstance(route_id, str) or not isinstance(payload, dict):
            raise ValueError("Editorial template data contains an invalid route record")
        days = payload.get("days")
        if not isinstance(days, list) or not days:
            raise ValueError(f"Editorial route {route_id} is missing day data")
        parsed_days: list[tuple[EditorialActivitySeed, ...]] = []
        for day_index, day in enumerate(days):
            if not isinstance(day, list) or not day:
                raise ValueError(f"Editorial route {route_id} day {day_index} is invalid")
            parsed_days.append(tuple(_parse_activity(item) for item in day))
        templates[_normalize_route_id(route_id)] = tuple(parsed_days)
    return templates


def has_editorial_route_template(route_id: str | None) -> bool:
    if not isinstance(route_id, str):
        return False
    return _normalize_route_id(route_id) in _load_templates()


def get_editorial_route_template(route_id: str | None) -> EditorialTripTemplate | None:
    if not isinstance(route_id, str):
        return None
    return _load_templates().get(_normalize_route_id(route_id))


def editorial_route_template_day_count(route_id: str | None) -> int | None:
    template = get_editorial_route_template(route_id)
    if template is None:
        return None
    return len(template)
