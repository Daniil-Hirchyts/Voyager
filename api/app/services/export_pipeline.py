from __future__ import annotations

import hashlib
import json
import os
import textwrap
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import Activity, Job, Place, Trip, TripDay
from app.db.repositories import ExportRepository, TripRepository
from app.errors import NotFoundError
from app.services.itinerary_generation import NonRetryableJobError

settings = get_settings()


@dataclass
class ExportExecutionResult:
    export_id: str
    format: str
    trip_version: int
    sha256: str
    size_bytes: int
    content_type: str


@dataclass
class _PdfTextLine:
    text: str
    font: str = "F1"
    size: float = 11
    color: tuple[float, float, float] = (0.14, 0.18, 0.24)
    leading: float | None = None


@dataclass
class _PdfBlock:
    lines: list[_PdfTextLine]
    fill_color: tuple[float, float, float] | None = None
    border_color: tuple[float, float, float] | None = (0.86, 0.89, 0.93)
    padding_top: float = 16
    padding_bottom: float = 14
    padding_horizontal: float = 16
    spacing_after: float = 12


@dataclass
class _PreparedPdfBlock:
    lines: list[_PdfTextLine]
    fill_color: tuple[float, float, float] | None
    border_color: tuple[float, float, float] | None
    padding_top: float
    padding_bottom: float
    padding_horizontal: float
    spacing_after: float
    height: float


def _as_uuid(value: Any, *, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise NonRetryableJobError("JOB_PAYLOAD_INVALID", f"{field} must be a valid UUID") from exc


def _as_format(value: Any) -> str:
    normalized = str(value).strip().lower()
    if normalized not in {"json", "ics", "pdf"}:
        raise NonRetryableJobError(
            "VALIDATION_ERROR",
            "Unsupported export format",
            {"allowed_formats": ["json", "ics", "pdf"]},
        )
    return normalized


def _escape_ics(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold_ics_line(line: str, *, limit: int = 73) -> list[str]:
    if len(line) <= limit:
        return [line]

    segments: list[str] = []
    remaining = line
    first = True
    while remaining:
        width = limit if first else limit - 1
        segments.append(remaining[:width] if first else f" {remaining[:width]}")
        remaining = remaining[width:]
        first = False
    return segments


def _append_ics_field(lines: list[str], key: str, value: str | None) -> None:
    if value is None or value == "":
        return
    lines.extend(_fold_ics_line(f"{key}:{_escape_ics(value)}"))


def _escape_pdf_text(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _to_jsonable(value: Any) -> Any:
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def _serialize_json(payload: dict[str, Any]) -> bytes:
    return json.dumps(
        payload,
        indent=2,
        ensure_ascii=False,
        sort_keys=True,
        default=_to_jsonable,
    ).encode("utf-8")


def _as_record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _format_money(amount: Any, currency: Any) -> str | None:
    if amount in (None, ""):
        return None
    amount_text = str(amount)
    currency_text = str(currency).strip() if currency else ""
    return f"{amount_text} {currency_text}".strip()


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


def _serialize_ics(payload: dict[str, Any]) -> bytes:
    trip = payload["trip"]
    days = payload["days"]
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Voyager//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ]
    _append_ics_field(lines, "X-WR-CALNAME", str(trip["title"]))
    _append_ics_field(lines, "X-WR-CALDESC", str(trip["destination_text"]))

    for day in days:
        for activity in day["activities"]:
            start_datetime = activity.get("start_datetime")
            if not start_datetime:
                continue

            start_dt = datetime.fromisoformat(start_datetime)
            end_dt = start_dt + timedelta(minutes=int(activity["duration_min"]))
            uid_seed = f"{activity['id']}:{activity['order_index']}:{day['id']}"
            uid = hashlib.sha1(uid_seed.encode("utf-8")).hexdigest()  # nosec B324

            description_parts: list[str] = []
            if activity.get("description"):
                description_parts.append(str(activity["description"]))
            if activity.get("notes"):
                description_parts.append(f"Notes: {activity['notes']}")
            if activity.get("location_text"):
                description_parts.append(f"Location: {activity['location_text']}")
            if activity.get("cost_label"):
                description_parts.append(f"Budget: {activity['cost_label']}")
            if activity.get("source"):
                description_parts.append(f"Source: {activity['source']}")
            route_points = activity.get("route_points") or []
            if route_points:
                description_parts.append(
                    "Route: "
                    + " -> ".join(str(point.get("label") or "").strip() for point in route_points)
                )
            hotel_details = activity.get("hotel_details") or {}
            if hotel_details.get("checkin_date") or hotel_details.get("checkout_date"):
                description_parts.append(
                    "Stay: "
                    + " / ".join(
                        part
                        for part in [
                            f"Check-in {hotel_details.get('checkin_date')}"
                            if hotel_details.get("checkin_date")
                            else None,
                            f"Check-out {hotel_details.get('checkout_date')}"
                            if hotel_details.get("checkout_date")
                            else None,
                        ]
                        if part
                    )
                )
            description_parts.append(f"Trip day: {day['day_index'] + 1} ({day['date']})")
            description = "\n".join(part for part in description_parts if part)

            location_name = None
            location = activity.get("location")
            if isinstance(location, dict):
                location_name = location.get("name") or activity.get("location_text")
            elif activity.get("location_text"):
                location_name = activity["location_text"]

            lines.extend(
                [
                    "BEGIN:VEVENT",
                    f"UID:{uid}@voyager.local",
                    "DTSTAMP:19700101T000000Z",
                    f"DTSTART:{start_dt.strftime('%Y%m%dT%H%M%SZ')}",
                    f"DTEND:{end_dt.strftime('%Y%m%dT%H%M%SZ')}",
                ]
            )
            _append_ics_field(lines, "SUMMARY", str(activity["title"]))
            _append_ics_field(lines, "DESCRIPTION", description)
            _append_ics_field(lines, "LOCATION", str(location_name) if location_name else None)
            _append_ics_field(lines, "CATEGORIES", str(activity["category"]).upper())

            if (
                isinstance(location, dict)
                and location.get("lat") is not None
                and location.get("lon") is not None
            ):
                lines.extend(
                    _fold_ics_line(f"GEO:{float(location['lat']):.6f};{float(location['lon']):.6f}")
                )
            lines.append("END:VEVENT")

    lines.append("END:VCALENDAR")
    return ("\r\n".join(lines) + "\r\n").encode("utf-8")


def _pdf_wrap_line(line: _PdfTextLine, width_points: float) -> list[_PdfTextLine]:
    if not line.text:
        return [line]
    approx_char_width = max(line.size * 0.56, 4.5)
    max_chars = max(int(width_points / approx_char_width), 1)
    wrapped = textwrap.wrap(
        line.text,
        width=max_chars,
        break_long_words=True,
        break_on_hyphens=False,
    )
    return [
        _PdfTextLine(
            text=segment,
            font=line.font,
            size=line.size,
            color=line.color,
            leading=line.leading,
        )
        for segment in (wrapped or [""])
    ]


def _prepare_pdf_block(block: _PdfBlock, *, width_points: float) -> _PreparedPdfBlock:
    wrapped_lines: list[_PdfTextLine] = []
    available_width = width_points - (block.padding_horizontal * 2)
    for line in block.lines:
        wrapped_lines.extend(_pdf_wrap_line(line, available_width))

    height = block.padding_top + block.padding_bottom
    for line in wrapped_lines:
        height += line.leading or (line.size + 5)

    return _PreparedPdfBlock(
        lines=wrapped_lines,
        fill_color=block.fill_color,
        border_color=block.border_color,
        padding_top=block.padding_top,
        padding_bottom=block.padding_bottom,
        padding_horizontal=block.padding_horizontal,
        spacing_after=block.spacing_after,
        height=height,
    )


def _pdf_block(
    *lines: _PdfTextLine,
    fill_color: tuple[float, float, float] | None = None,
    border_color: tuple[float, float, float] | None = (0.86, 0.89, 0.93),
    padding_top: float = 16,
    padding_bottom: float = 14,
    padding_horizontal: float = 16,
    spacing_after: float = 12,
) -> _PdfBlock:
    return _PdfBlock(
        lines=list(lines),
        fill_color=fill_color,
        border_color=border_color,
        padding_top=padding_top,
        padding_bottom=padding_bottom,
        padding_horizontal=padding_horizontal,
        spacing_after=spacing_after,
    )


def _build_pdf_blocks(payload: dict[str, Any]) -> list[_PdfBlock]:
    trip = payload["trip"]
    blocks: list[_PdfBlock] = []
    budget_label = _format_money(trip.get("budget_amount"), trip.get("budget_currency"))

    hero_meta = [
        f"Destination: {trip['destination_text']}",
        f"Dates: {trip['start_date']} -> {trip['end_date']}",
        f"Travel mode: {trip.get('route_travel_mode') or 'WALK'}",
        f"Budget: {budget_label}" if budget_label else "Budget: Not set",
        f"Version: {trip['version']}",
    ]
    blocks.append(
        _pdf_block(
            _PdfTextLine(
                "Voyager itinerary", font="F2", size=11, color=(0.64, 0.35, 0.18), leading=16
            ),
            _PdfTextLine(
                str(trip["title"]), font="F2", size=22, color=(0.10, 0.14, 0.18), leading=28
            ),
            *[
                _PdfTextLine(line, font="F1", size=11, color=(0.29, 0.35, 0.42), leading=16)
                for line in hero_meta
            ],
            fill_color=(0.97, 0.98, 0.99),
            border_color=(0.84, 0.88, 0.94),
            padding_top=18,
            padding_bottom=16,
            spacing_after=16,
        )
    )

    for day in payload["days"]:
        day_lines = [
            _PdfTextLine(
                f"Day {day['day_index'] + 1} - {day['date']}",
                font="F2",
                size=15,
                color=(0.12, 0.15, 0.20),
                leading=20,
            )
        ]
        if day.get("notes"):
            day_lines.append(
                _PdfTextLine(
                    f"Notes: {day['notes']}",
                    font="F1",
                    size=10.5,
                    color=(0.33, 0.39, 0.47),
                    leading=16,
                )
            )
        if day["activities"]:
            day_lines.append(
                _PdfTextLine(
                    f"Activities: {len(day['activities'])}",
                    font="F1",
                    size=10.5,
                    color=(0.33, 0.39, 0.47),
                    leading=16,
                )
            )
        else:
            day_lines.append(
                _PdfTextLine(
                    "No activities scheduled yet.",
                    font="F1",
                    size=10.5,
                    color=(0.45, 0.49, 0.56),
                    leading=16,
                )
            )

        blocks.append(
            _pdf_block(
                *day_lines,
                fill_color=(1.0, 0.98, 0.95),
                border_color=(0.95, 0.88, 0.80),
                padding_top=14,
                padding_bottom=12,
                spacing_after=10,
            )
        )

        for activity in day["activities"]:
            card_lines = [
                _PdfTextLine(
                    f"{activity.get('start_time') or 'Flexible'}  {activity['title']}",
                    font="F2",
                    size=12.5,
                    color=(0.10, 0.14, 0.18),
                    leading=18,
                ),
                _PdfTextLine(
                    " / ".join(
                        part
                        for part in [
                            str(activity["category"]).title(),
                            f"{activity['duration_min']} min",
                            activity.get("cost_label"),
                        ]
                        if part
                    ),
                    font="F1",
                    size=10,
                    color=(0.38, 0.43, 0.50),
                    leading=15,
                ),
            ]

            if activity.get("location_text"):
                card_lines.append(
                    _PdfTextLine(
                        f"Location: {activity['location_text']}",
                        font="F1",
                        size=10.5,
                        color=(0.20, 0.25, 0.32),
                        leading=15,
                    )
                )
            if activity.get("description"):
                card_lines.append(
                    _PdfTextLine(
                        str(activity["description"]),
                        font="F1",
                        size=10.5,
                        color=(0.20, 0.25, 0.32),
                        leading=15,
                    )
                )
            if activity.get("notes"):
                card_lines.append(
                    _PdfTextLine(
                        f"Notes: {activity['notes']}",
                        font="F3",
                        size=10,
                        color=(0.36, 0.40, 0.47),
                        leading=15,
                    )
                )
            if activity.get("route_points"):
                route_text = " -> ".join(
                    str(point.get("label") or "").strip() for point in activity["route_points"]
                )
                card_lines.append(
                    _PdfTextLine(
                        f"Route: {route_text}",
                        font="F1",
                        size=10,
                        color=(0.20, 0.25, 0.32),
                        leading=15,
                    )
                )
            hotel_details = activity.get("hotel_details") or {}
            if hotel_details.get("checkin_date") or hotel_details.get("checkout_date"):
                stay_parts = [
                    f"Check-in {hotel_details['checkin_date']}"
                    if hotel_details.get("checkin_date")
                    else None,
                    f"Check-out {hotel_details['checkout_date']}"
                    if hotel_details.get("checkout_date")
                    else None,
                ]
                card_lines.append(
                    _PdfTextLine(
                        "Stay: " + " / ".join(part for part in stay_parts if part),
                        font="F1",
                        size=10,
                        color=(0.20, 0.25, 0.32),
                        leading=15,
                    )
                )

            blocks.append(
                _pdf_block(
                    *card_lines,
                    fill_color=(1.0, 1.0, 1.0),
                    border_color=(0.88, 0.90, 0.93),
                    padding_top=14,
                    padding_bottom=12,
                    spacing_after=10,
                )
            )

    inbox_activities = payload.get("inbox_activities") or []
    if inbox_activities:
        blocks.append(
            _pdf_block(
                _PdfTextLine(
                    "Inbox activities", font="F2", size=15, color=(0.12, 0.15, 0.20), leading=20
                ),
                _PdfTextLine(
                    "These items are saved on the trip but are not assigned to a day yet.",
                    font="F1",
                    size=10.5,
                    color=(0.33, 0.39, 0.47),
                    leading=16,
                ),
                fill_color=(0.96, 0.97, 0.99),
                border_color=(0.84, 0.88, 0.94),
                padding_top=14,
                padding_bottom=12,
                spacing_after=10,
            )
        )

        for activity in inbox_activities:
            card_lines = [
                _PdfTextLine(
                    str(activity["title"]),
                    font="F2",
                    size=12.5,
                    color=(0.10, 0.14, 0.18),
                    leading=18,
                ),
                _PdfTextLine(
                    " / ".join(
                        part
                        for part in [
                            str(activity["category"]).title(),
                            activity.get("cost_label"),
                        ]
                        if part
                    )
                    or "Unscheduled",
                    font="F1",
                    size=10,
                    color=(0.38, 0.43, 0.50),
                    leading=15,
                ),
            ]
            if activity.get("location_text"):
                card_lines.append(
                    _PdfTextLine(
                        f"Location: {activity['location_text']}",
                        font="F1",
                        size=10.5,
                        color=(0.20, 0.25, 0.32),
                        leading=15,
                    )
                )
            if activity.get("description"):
                card_lines.append(
                    _PdfTextLine(
                        str(activity["description"]),
                        font="F1",
                        size=10.5,
                        color=(0.20, 0.25, 0.32),
                        leading=15,
                    )
                )
            blocks.append(
                _pdf_block(
                    *card_lines,
                    fill_color=(1.0, 1.0, 1.0),
                    border_color=(0.88, 0.90, 0.93),
                    padding_top=14,
                    padding_bottom=12,
                    spacing_after=10,
                )
            )

    return blocks


def _render_pdf_page(
    blocks: list[_PreparedPdfBlock],
    *,
    page_width: float,
    page_height: float,
    margin_x: float,
    margin_top: float,
    margin_bottom: float,
) -> bytes:
    operations: list[str] = []
    content_width = page_width - (margin_x * 2)
    y = page_height - margin_top

    for block in blocks:
        bottom = y - block.height
        if block.fill_color is not None:
            operations.append(
                f"q {block.fill_color[0]:.3f} {block.fill_color[1]:.3f} {block.fill_color[2]:.3f} rg "
                f"{margin_x:.2f} {bottom:.2f} {content_width:.2f} {block.height:.2f} re f Q"
            )
        if block.border_color is not None:
            operations.append(
                f"q {block.border_color[0]:.3f} {block.border_color[1]:.3f} {block.border_color[2]:.3f} RG "
                f"1 w {margin_x:.2f} {bottom:.2f} {content_width:.2f} {block.height:.2f} re S Q"
            )

        text_y = y - block.padding_top
        for line in block.lines:
            text_y -= line.size
            operations.append(
                f"BT /{line.font} {line.size:.2f} Tf "
                f"{line.color[0]:.3f} {line.color[1]:.3f} {line.color[2]:.3f} rg "
                f"1 0 0 1 {margin_x + block.padding_horizontal:.2f} {text_y:.2f} Tm "
                f"({_escape_pdf_text(line.text)}) Tj ET"
            )
            text_y -= (line.leading or (line.size + 5)) - line.size

        y = bottom - block.spacing_after

    operations.append(
        f"BT /F1 9 Tf 0.500 0.550 0.620 rg 1 0 0 1 {margin_x:.2f} {margin_bottom - 18:.2f} Tm "
        f"(Generated by Voyager) Tj ET"
    )
    return ("\n".join(operations) + "\n").encode("utf-8")


def _serialize_pdf(payload: dict[str, Any]) -> bytes:
    page_width = 612.0
    page_height = 792.0
    margin_x = 42.0
    margin_top = 44.0
    margin_bottom = 42.0
    content_width = page_width - (margin_x * 2)

    prepared_blocks = [
        _prepare_pdf_block(block, width_points=content_width)
        for block in _build_pdf_blocks(payload)
    ]

    available_height = page_height - margin_top - margin_bottom
    pages: list[list[_PreparedPdfBlock]] = []
    current_page: list[_PreparedPdfBlock] = []
    current_height = 0.0
    for block in prepared_blocks:
        required = block.height + (block.spacing_after if current_page else 0)
        if current_page and current_height + required > available_height:
            pages.append(current_page)
            current_page = []
            current_height = 0.0
        current_page.append(block)
        current_height += block.height + block.spacing_after
    if current_page:
        pages.append(current_page)
    if not pages:
        pages = [[]]

    objects: list[bytes] = []
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    page_object_numbers = [6 + (index * 2) for index in range(len(pages))]
    kids = " ".join(f"{number} 0 R" for number in page_object_numbers).encode("ascii")
    objects.append(
        b"<< /Type /Pages /Kids ["
        + kids
        + b"] /Count "
        + str(len(page_object_numbers)).encode("ascii")
        + b" >>"
    )
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>")

    for index, page_blocks in enumerate(pages):
        page_object_number = page_object_numbers[index]
        content_object_number = page_object_number + 1
        stream_content = _render_pdf_page(
            page_blocks,
            page_width=page_width,
            page_height=page_height,
            margin_x=margin_x,
            margin_top=margin_top,
            margin_bottom=margin_bottom,
        )

        objects.append(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents "
            + str(content_object_number).encode("ascii")
            + b" 0 R >>"
        )
        objects.append(
            b"<< /Length "
            + str(len(stream_content)).encode("ascii")
            + b" >>\nstream\n"
            + stream_content
            + b"endstream"
        )

    data = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    offsets: list[int] = [0]
    for idx, obj in enumerate(objects, start=1):
        offsets.append(len(data))
        data += f"{idx} 0 obj\n".encode("ascii")
        data += obj
        data += b"\nendobj\n"

    xref_start = len(data)
    data += f"xref\n0 {len(objects) + 1}\n".encode("ascii")
    data += b"0000000000 65535 f \n"
    for offset in offsets[1:]:
        data += f"{offset:010d} 00000 n \n".encode("ascii")
    data += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_start}\n%%EOF\n".encode(
        "ascii"
    )
    return data


def _content_type_for(format_name: str) -> str:
    if format_name == "json":
        return "application/json"
    if format_name == "ics":
        return "text/calendar; charset=utf-8"
    return "application/pdf"


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


def _materialize_bytes(format_name: str, payload: dict[str, Any]) -> bytes:
    if format_name == "json":
        return _serialize_json(payload)
    if format_name == "ics":
        return _serialize_ics(payload)
    return _serialize_pdf(payload)


def _target_path(
    *, user_id: uuid.UUID, trip_id: uuid.UUID, export_id: uuid.UUID, format_name: str
) -> Path:
    root = Path(settings.exports_dir)
    return root / str(user_id) / str(trip_id) / f"{export_id}.{format_name}"


def _write_file_atomically(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("wb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp_path, path)


async def execute_export_job(db: AsyncSession, job: Job) -> ExportExecutionResult:
    payload = job.payload_json
    if not isinstance(payload, dict):
        raise NonRetryableJobError("JOB_PAYLOAD_INVALID", "Job payload must be an object")

    export_id = _as_uuid(payload.get("export_id"), field="export_id")
    trip_id = _as_uuid(payload.get("trip_id"), field="trip_id")
    user_id = _as_uuid(payload.get("user_id"), field="user_id")
    expected_version = int(payload.get("expected_trip_version"))
    format_name = _as_format(payload.get("format"))

    try:
        trip = await TripRepository.get_trip(db, user_id, trip_id)
    except NotFoundError:
        raise NonRetryableJobError("RESOURCE_NOT_FOUND", "Trip not found for export job") from None
    if trip.version != expected_version:
        raise NonRetryableJobError(
            "CONFLICT_VERSION_MISMATCH",
            "Trip version mismatch",
            {"latest_version": trip.version},
        )

    payload_obj = await _load_trip_payload(db, trip=trip)
    content = _materialize_bytes(format_name, payload_obj)
    digest = hashlib.sha256(content).hexdigest()
    file_path = _target_path(
        user_id=user_id, trip_id=trip_id, export_id=export_id, format_name=format_name
    )
    _write_file_atomically(file_path, content)

    await ExportRepository.mark_export_succeeded(
        db,
        export_id=export_id,
        file_path=str(file_path),
        content_type=_content_type_for(format_name),
        size_bytes=len(content),
        sha256=digest,
    )
    return ExportExecutionResult(
        export_id=str(export_id),
        format=format_name,
        trip_version=trip.version,
        sha256=digest,
        size_bytes=len(content),
        content_type=_content_type_for(format_name),
    )
