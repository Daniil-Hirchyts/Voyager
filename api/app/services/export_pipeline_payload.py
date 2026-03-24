from __future__ import annotations

import uuid
from datetime import UTC, datetime, time
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Activity, Place, Trip, TripDay
from app.services.export_pipeline_common import _as_record, _format_money


def _format_activity_location_text(activity: dict[str, Any]) -> str | None:
    location = activity.get("location")
    if not isinstance(location, dict):
        return None
    parts = [
        location.get("name"),
        location.get("address_text"),
    ]
    values = [str(part).strip() for part in parts if str(part or "").strip()]
    if not values:
        return None
    deduped: list[str] = []
    for value in values:
        lowered = value.lower()
        if any(existing.lower() == lowered for existing in deduped):
            continue
        deduped.append(value)
    return ", ".join(deduped)


def _fallback_location_payload(
    *,
    category_value: str,
    category_details: dict[str, Any],
    route_points: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if category_value == "hotel":
        name = category_details.get("hotel_name")
        address_text = category_details.get("address_text")
        latitude = category_details.get("latitude")
        longitude = category_details.get("longitude")
        if name or address_text or latitude is not None or longitude is not None:
            return {
                "id": None,
                "name": name,
                "category": "hotel",
                "address_text": address_text,
                "lat": latitude,
                "lon": longitude,
                "source": "activity_details",
                "external_id": None,
            }

    if category_value == "travel" and route_points:
        labels = " -> ".join(
            str(point.get("label") or "").strip() for point in route_points if point.get("label")
        )
        destination = route_points[-1]
        return {
            "id": destination.get("place_id"),
            "name": labels or "Travel route",
            "category": "travel",
            "address_text": None,
            "lat": destination.get("lat"),
            "lon": destination.get("lon"),
            "source": "activity_details",
            "external_id": None,
        }

    return None


def _extract_route_points(category_details: dict[str, Any]) -> list[dict[str, Any]]:
    origin_geo = _as_record(category_details.get("origin_geo"))
    destination_geo = _as_record(category_details.get("destination_geo"))

    points: list[dict[str, Any]] = []
    origin_lat = origin_geo.get("lat")
    origin_lon = origin_geo.get("lon")
    if isinstance(origin_lat, (int, float)) and isinstance(origin_lon, (int, float)):
        points.append(
            {
                "label": str(category_details.get("origin_text") or "Origin"),
                "lat": float(origin_lat),
                "lon": float(origin_lon),
                "place_id": category_details.get("origin_place_id"),
            }
        )

    destination_lat = destination_geo.get("lat")
    destination_lon = destination_geo.get("lon")
    if isinstance(destination_lat, (int, float)) and isinstance(destination_lon, (int, float)):
        points.append(
            {
                "label": str(category_details.get("destination_text") or "Destination"),
                "lat": float(destination_lat),
                "lon": float(destination_lon),
                "place_id": category_details.get("destination_place_id"),
            }
        )

    return points


def _place_payload(place: Place | None) -> dict[str, Any] | None:
    if place is None:
        return None
    return {
        "id": str(place.id),
        "name": place.name,
        "category": place.category,
        "address_text": place.address_text,
        "lat": place.lat,
        "lon": place.lon,
        "source": place.source,
        "external_id": place.external_id,
    }


def _activity_payload(
    *,
    activity: Activity,
    place: Place | None,
    trip: Trip,
    day: TripDay | None,
    fallback_index: int,
) -> dict[str, Any]:
    details = activity.category_details_json or {}
    category_value = (
        activity.category.value if hasattr(activity.category, "value") else str(activity.category)
    )
    start_value = activity.start_time or (time(9 + min(fallback_index, 8), 0) if day else None)
    start_datetime = (
        datetime.combine(day.date, start_value, tzinfo=UTC).isoformat()
        if day is not None and start_value is not None
        else None
    )

    route_points = _extract_route_points(details) if category_value == "travel" else []
    hotel_details = (
        {
            "hotel_name": details.get("hotel_name"),
            "address_text": details.get("address_text"),
            "checkin_date": details.get("checkin_date"),
            "checkout_date": details.get("checkout_date"),
            "latitude": details.get("latitude"),
            "longitude": details.get("longitude"),
        }
        if category_value == "hotel"
        else None
    )
    location = _place_payload(place) or _fallback_location_payload(
        category_value=category_value,
        category_details=details,
        route_points=route_points,
    )

    return {
        "id": str(activity.id),
        "trip_id": str(trip.id),
        "trip_day_id": str(day.id) if day else None,
        "order_index": activity.order_index,
        "title": activity.title,
        "description": activity.description,
        "start_time": start_value.strftime("%H:%M") if start_value else None,
        "start_datetime": start_datetime,
        "duration_min": activity.duration_min or 60,
        "source": activity.source,
        "is_favorite": activity.is_favorite,
        "visited_at": activity.visited_at.isoformat() if activity.visited_at else None,
        "notes": activity.notes,
        "place_id": str(activity.place_id) if activity.place_id else None,
        "category": category_value,
        "category_details": details,
        "estimated_cost_amount": str(activity.estimated_cost_amount)
        if activity.estimated_cost_amount is not None
        else None,
        "estimated_cost_currency": activity.estimated_cost_currency,
        "cost_label": _format_money(
            activity.estimated_cost_amount, activity.estimated_cost_currency
        ),
        "date": day.date.isoformat() if day else None,
        "day_index": day.day_index if day else None,
        "day_label": f"Day {day.day_index + 1}" if day else "Inbox",
        "location": location,
        "location_text": _format_activity_location_text({"location": location}),
        "route_points": route_points,
        "hotel_details": hotel_details,
    }


async def _load_trip_payload(
    db: AsyncSession,
    *,
    trip: Trip,
) -> dict[str, Any]:
    day_rows = await db.execute(
        select(TripDay).where(TripDay.trip_id == trip.id).order_by(TripDay.day_index.asc())
    )
    days = list(day_rows.scalars().all())
    day_by_id = {day.id: day for day in days}

    activity_rows = await db.execute(
        select(Activity, Place)
        .outerjoin(Place, Activity.place_id == Place.id)
        .where(Activity.trip_id == trip.id)
        .order_by(
            Activity.trip_day_id.is_(None).asc(),
            Activity.trip_day_id.asc().nulls_last(),
            Activity.order_index.asc(),
            Activity.id.asc(),
        )
    )
    activity_map: dict[uuid.UUID, list[dict[str, Any]]] = {}
    inbox_activities: list[dict[str, Any]] = []

    for activity, place in activity_rows.all():
        day = day_by_id.get(activity.trip_day_id) if activity.trip_day_id is not None else None
        fallback_index = (
            len(activity_map.get(day.id, [])) if day is not None else len(inbox_activities)
        )
        item = _activity_payload(
            activity=activity,
            place=place,
            trip=trip,
            day=day,
            fallback_index=fallback_index,
        )
        if day is None:
            inbox_activities.append(item)
        else:
            activity_map.setdefault(day.id, []).append(item)

    payload_days: list[dict[str, Any]] = []
    for day in days:
        payload_days.append(
            {
                "id": str(day.id),
                "day_index": day.day_index,
                "date": day.date.isoformat(),
                "notes": day.notes,
                "activities": activity_map.get(day.id, []),
            }
        )

    return {
        "trip": {
            "id": str(trip.id),
            "title": trip.title,
            "destination_text": trip.destination_text,
            "start_date": trip.start_date.isoformat(),
            "end_date": trip.end_date.isoformat(),
            "budget_amount": str(trip.budget_amount) if trip.budget_amount is not None else None,
            "budget_currency": trip.budget_currency,
            "budget_label": _format_money(trip.budget_amount, trip.budget_currency),
            "trip_type": trip.trip_type,
            "route_travel_mode": trip.route_travel_mode,
            "version": trip.version,
            "last_generated_at": trip.last_generated_at.isoformat()
            if trip.last_generated_at
            else None,
        },
        "days": payload_days,
        "inbox_activities": inbox_activities,
        "summary": {
            "day_count": len(payload_days),
            "scheduled_activity_count": sum(len(day["activities"]) for day in payload_days),
            "inbox_activity_count": len(inbox_activities),
        },
    }
