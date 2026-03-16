from __future__ import annotations

import json
import math
import uuid
from collections import defaultdict
from typing import Any

import httpx
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.db.models import Activity, EventSnapshot, Place, Trip, TripDay
from app.db.repositories import EventRepository, TripRepository
from app.metrics import increment_itinerary_llm_metric
from app.rate_limit.limiter import enforce_limit


def _trip_terms(trip: Trip) -> set[str]:
    raw = [trip.destination_text or "", trip.trip_type or ""]
    terms: set[str] = set()
    for value in raw:
        if not isinstance(value, str):
            continue
        for part in value.replace(",", " ").replace("/", " ").split():
            cleaned = part.strip().lower()
            if cleaned:
                terms.add(cleaned)
    return terms


def _snapshot_terms(snapshot: EventSnapshot) -> set[str]:
    values = [snapshot.title, snapshot.summary, *(snapshot.tags_json or [])]
    terms: set[str] = set()
    for value in values:
        if not isinstance(value, str):
            continue
        for part in value.replace(",", " ").replace("/", " ").split():
            cleaned = part.strip().lower()
            if cleaned:
                terms.add(cleaned)
    return terms


def _day_terms(activities: list[Activity]) -> set[str]:
    terms: set[str] = set()
    for activity in activities:
        for value in [activity.category, activity.title, activity.description]:
            if isinstance(value, str):
                for part in value.replace(",", " ").replace("/", " ").split():
                    cleaned = part.strip().lower()
                    if cleaned:
                        terms.add(cleaned)
    return terms


def _centroid_for_day(
    activities: list[Activity], places_by_id: dict[uuid.UUID, Place]
) -> tuple[float, float] | None:
    coords = []
    for activity in activities:
        if activity.place_id is None:
            continue
        place = places_by_id.get(activity.place_id)
        if place is None or place.lat is None or place.lon is None:
            continue
        coords.append((place.lat, place.lon))
    if not coords:
        return None
    lat = sum(item[0] for item in coords) / len(coords)
    lon = sum(item[1] for item in coords) / len(coords)
    return lat, lon


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


def _distance_score(
    snapshot: EventSnapshot,
    *,
    centroid: tuple[float, float] | None,
    place: Place | None,
) -> float:
    if centroid is None or place is None or place.lat is None or place.lon is None:
        return 8.0
    distance_km = _haversine_km(centroid[0], centroid[1], place.lat, place.lon)
    return max(0.0, 24.0 - min(distance_km, 24.0))


def _fallback_rationale(
    *,
    snapshot: EventSnapshot,
    day: TripDay,
    context_matches: list[str],
    distance_score: float,
) -> str:
    parts = [f"{snapshot.title} fits day {day.day_index + 1}"]
    if context_matches:
        parts.append(f"matches {', '.join(context_matches[:2])}")
    if snapshot.rating is not None:
        parts.append(f"carries a {snapshot.rating:.1f} TripAdvisor rating")
    if distance_score >= 12:
        parts.append("sits close to the rest of the day")
    return ", ".join(parts) + "."


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


async def _llm_rationales(
    *,
    redis: Redis | None,
    trip: Trip,
    recommendations: list[dict[str, Any]],
) -> dict[uuid.UUID, str]:
    settings = get_settings()
    if (
        not settings.itinerary_llm_enabled
        or not settings.llm_openrouter_api_key
        or not recommendations
        or not settings.itinerary_llm_model_order()
    ):
        return {}

    model = settings.itinerary_llm_model_order()[0]
    await increment_itinerary_llm_metric(redis, "attempt")
    await enforce_limit(
        redis,
        prefix="rl:provider",
        identifier=f"openrouter:{model}",
        scope="itinerary.recommendations",
        limit=settings.rate_limit_itinerary_provider_per_min,
        window_seconds=60,
    )

    payload = {
        "trip": {
            "destination_text": trip.destination_text,
            "trip_type": trip.trip_type,
        },
        "recommendations": [
            {
                "snapshot_id": str(item["snapshot"].id),
                "title": item["snapshot"].title,
                "summary": item["snapshot"].summary,
                "tags": item["snapshot"].tags_json or [],
                "rating": float(item["snapshot"].rating)
                if item["snapshot"].rating is not None
                else None,
                "review_count": item["snapshot"].review_count,
                "day": {
                    "id": str(item["day"].id),
                    "index": item["day"].day_index + 1,
                    "date": item["day"].date.isoformat(),
                },
            }
            for item in recommendations
        ],
    }
    endpoint = f"{settings.llm_openrouter_base_url.rstrip('/')}/chat/completions"
    body = {
        "model": model,
        "temperature": 0.2,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are ranking saved TripAdvisor activities for a trip. "
                    "Return JSON only in the shape "
                    '{"items":[{"snapshot_id":"uuid","rationale":"string"}]}. '
                    "Each rationale must be one concise sentence."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(payload, separators=(",", ":"), ensure_ascii=True),
            },
        ],
    }
    headers = {
        "Authorization": f"Bearer {settings.llm_openrouter_api_key}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=settings.llm_openrouter_timeout_sec) as client:
            response = await client.post(endpoint, headers=headers, json=body)
        response.raise_for_status()
        response_payload = response.json()
        choices = response_payload.get("choices")
        if not isinstance(choices, list) or not choices:
            raise ValueError("Missing choices in provider response")
        message = choices[0].get("message")
        if not isinstance(message, dict):
            raise ValueError("Missing message in provider response")
        content = _strip_code_fence(_extract_message_text(message.get("content")))
        parsed = json.loads(content)
        items = parsed.get("items") if isinstance(parsed, dict) else None
        if not isinstance(items, list):
            raise ValueError("Invalid LLM rationale payload")
        await increment_itinerary_llm_metric(redis, "success")
        rationales: dict[uuid.UUID, str] = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            snapshot_id = item.get("snapshot_id")
            rationale = item.get("rationale")
            if not snapshot_id or not isinstance(rationale, str) or not rationale.strip():
                continue
            rationales[uuid.UUID(str(snapshot_id))] = rationale.strip()
        return rationales
    except Exception:
        await increment_itinerary_llm_metric(redis, "fallback")
        return {}


async def recommend_shortlist_items(
    db: AsyncSession,
    *,
    redis: Redis | None,
    user_id: uuid.UUID,
    trip_id: uuid.UUID,
    day_ids: list[uuid.UUID] | None,
    snapshot_ids: list[uuid.UUID] | None,
    limit: int,
    use_llm_rationale: bool,
) -> list[dict[str, Any]]:
    trip = await TripRepository.get_trip(db, user_id, trip_id)
    all_days = await TripRepository.list_days(db, user_id, trip_id)
    if day_ids:
        scoped_days = [day for day in all_days if day.id in set(day_ids)]
        if len(scoped_days) != len(set(day_ids)):
            raise ValueError("One or more day_ids are not part of the trip")
    else:
        scoped_days = all_days

    snapshot_query = (
        select(EventSnapshot)
        .options(selectinload(EventSnapshot.place))
        .where(EventSnapshot.trip_id == trip_id)
    )
    snapshot_query = snapshot_query.where(EventSnapshot.provider == "tripadvisor")
    snapshot_query = snapshot_query.where(
        EventSnapshot.entity_type.in_(("attraction", "restaurant"))
    )
    if snapshot_ids:
        snapshot_query = snapshot_query.where(EventSnapshot.id.in_(snapshot_ids))
    rows = await db.execute(
        snapshot_query.order_by(
            EventSnapshot.rating.desc().nulls_last(), EventSnapshot.created_at.desc()
        )
    )
    snapshots = list(rows.scalars().all())
    if not snapshots or not scoped_days:
        return []

    activity_rows = await db.execute(
        select(Activity).where(Activity.trip_day_id.in_([day.id for day in scoped_days]))
    )
    activities = list(activity_rows.scalars().all())
    activities_by_day: dict[uuid.UUID, list[Activity]] = defaultdict(list)
    attached_snapshot_ids: set[uuid.UUID] = set()
    place_ids: set[uuid.UUID] = set()
    for activity in activities:
        activities_by_day[activity.trip_day_id].append(activity)
        if activity.event_snapshot_id is not None:
            attached_snapshot_ids.add(activity.event_snapshot_id)
        if activity.place_id is not None:
            place_ids.add(activity.place_id)

    place_rows = (
        await db.execute(select(Place).where(Place.id.in_(place_ids))) if place_ids else None
    )
    places_by_id = {place.id: place for place in place_rows.scalars().all()} if place_rows else {}
    centroids = {
        day.id: _centroid_for_day(activities_by_day.get(day.id, []), places_by_id)
        for day in scoped_days
    }
    trip_terms = _trip_terms(trip)

    scored: list[dict[str, Any]] = []
    for snapshot in snapshots:
        if snapshot.id in attached_snapshot_ids:
            continue
        snapshot_terms = _snapshot_terms(snapshot)
        place = places_by_id.get(snapshot.place_id) if snapshot.place_id else None
        best: dict[str, Any] | None = None
        for day in scoped_days:
            day_context_terms = _day_terms(activities_by_day.get(day.id, []))
            context_matches = sorted(snapshot_terms & (trip_terms | day_context_terms))
            context_score = min(len(context_matches) * 10.0, 30.0)
            rating_score = (float(snapshot.rating) if snapshot.rating is not None else 3.5) * 12.0
            review_score = min(math.log10((snapshot.review_count or 0) + 10) * 6.0, 18.0)
            distance_score = _distance_score(snapshot, centroid=centroids.get(day.id), place=place)
            day_bias = max(0, 12 - day.day_index)
            total_score = round(
                context_score + rating_score + review_score + distance_score + day_bias, 2
            )
            candidate = {
                "snapshot": snapshot,
                "day": day,
                "score": total_score,
                "context_matches": context_matches,
                "distance_score": distance_score,
            }
            if best is None or candidate["score"] > best["score"]:
                best = candidate
        if best is not None:
            scored.append(best)

    scored.sort(
        key=lambda item: (
            item["score"],
            item["snapshot"].rating or 0,
            item["snapshot"].review_count or 0,
        ),
        reverse=True,
    )
    top_items = scored[:limit]
    llm_rationales = (
        await _llm_rationales(redis=redis, trip=trip, recommendations=top_items)
        if use_llm_rationale
        else {}
    )

    results: list[dict[str, Any]] = []
    for item in top_items:
        snapshot = item["snapshot"]
        day = item["day"]
        results.append(
            {
                "snapshot_id": snapshot.id,
                "trip_day_id": day.id,
                "score": item["score"],
                "rationale": llm_rationales.get(
                    snapshot.id,
                    _fallback_rationale(
                        snapshot=snapshot,
                        day=day,
                        context_matches=item["context_matches"],
                        distance_score=item["distance_score"],
                    ),
                ),
                "item": EventRepository.to_discovery_item(snapshot),
            }
        )
    return results
