from __future__ import annotations

import hashlib
import json
import os
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import Activity, Job, LodgingOffer, TransportOffer, Trip, TripDay
from app.db.repositories import ExportRepository
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
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def _escape_pdf_text(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _to_jsonable(value: Any) -> Any:
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    return value


def _serialize_json(payload: dict[str, Any]) -> bytes:
    return json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        default=_to_jsonable,
    ).encode("utf-8")


def _serialize_ics(payload: dict[str, Any]) -> bytes:
    trip = payload["trip"]
    days = payload["days"]
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Voyager//EN",
        f"X-WR-CALNAME:{_escape_ics(trip['title'])}",
    ]
    for day in days:
        for activity in day["activities"]:
            start_dt = datetime.fromisoformat(activity["start_datetime"])
            end_dt = start_dt + timedelta(minutes=activity["duration_min"])
            uid_seed = f"{activity['id']}:{activity['order_index']}:{day['id']}"
            uid = hashlib.sha1(uid_seed.encode("utf-8")).hexdigest()  # nosec B324
            lines.extend(
                [
                    "BEGIN:VEVENT",
                    f"UID:{uid}@voyager.local",
                    "DTSTAMP:19700101T000000Z",
                    f"DTSTART:{start_dt.strftime('%Y%m%dT%H%M%S')}",
                    f"DTEND:{end_dt.strftime('%Y%m%dT%H%M%S')}",
                    f"SUMMARY:{_escape_ics(activity['title'])}",
                    f"DESCRIPTION:{_escape_ics(activity.get('description') or '')}",
                    "END:VEVENT",
                ]
            )
    lines.append("END:VCALENDAR")
    return ("\r\n".join(lines) + "\r\n").encode("utf-8")


def _serialize_pdf(payload: dict[str, Any]) -> bytes:
    trip = payload["trip"]
    lines: list[str] = [
        "Voyager Itinerary Export",
        f"Trip: {trip['title']}",
        f"Destination: {trip['destination_text']}",
        f"Dates: {trip['start_date']} -> {trip['end_date']}",
        f"Version: {trip['version']}",
        "",
    ]

    for day in payload["days"]:
        lines.append(f"Day {day['day_index'] + 1} - {day['date']}")
        if day.get("notes"):
            lines.append(f"Notes: {day['notes']}")
        for activity in day["activities"]:
            lines.append(
                f"  {activity['start_time']}  {activity['title']} ({activity['duration_min']} min)"
            )
        lines.append("")

    y_start = 770
    line_height = 14
    content_lines = ["BT", "/F1 12 Tf", f"72 {y_start} Td"]
    first = True
    for line in lines:
        escaped = _escape_pdf_text(line)
        if first:
            content_lines.append(f"({escaped}) Tj")
            first = False
        else:
            content_lines.append(f"0 -{line_height} Td")
            content_lines.append(f"({escaped}) Tj")
    content_lines.append("ET")
    stream_content = ("\n".join(content_lines) + "\n").encode("utf-8")

    objects: list[bytes] = []
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    objects.append(
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"
    )
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
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
    data += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_start}\n%%EOF\n".encode(
            "ascii"
        )
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
    day_ids = [day.id for day in days]

    activity_rows = await db.execute(
        select(Activity)
        .where(Activity.trip_day_id.in_(day_ids))
        .order_by(Activity.trip_day_id.asc(), Activity.order_index.asc())
    )
    activity_map: dict[uuid.UUID, list[Activity]] = {}
    for row in activity_rows.scalars().all():
        activity_map.setdefault(row.trip_day_id, []).append(row)

    transport_rows = await db.execute(
        select(TransportOffer)
        .where(TransportOffer.trip_id == trip.id)
        .where(TransportOffer.is_current.is_(True))
        .order_by(TransportOffer.created_at.desc(), TransportOffer.id.desc())
    )
    lodging_rows = await db.execute(
        select(LodgingOffer)
        .where(LodgingOffer.trip_id == trip.id)
        .where(LodgingOffer.is_current.is_(True))
        .order_by(LodgingOffer.created_at.desc(), LodgingOffer.id.desc())
    )

    payload_days: list[dict[str, Any]] = []
    for day in days:
        activities: list[dict[str, Any]] = []
        for idx, activity in enumerate(activity_map.get(day.id, [])):
            start_value = activity.start_time or time(9 + min(idx, 8), 0)
            start_dt = datetime.combine(day.date, start_value, tzinfo=UTC)
            activities.append(
                {
                    "id": str(activity.id),
                    "order_index": activity.order_index,
                    "title": activity.title,
                    "description": activity.description,
                    "start_time": start_value.strftime("%H:%M"),
                    "start_datetime": start_dt.isoformat(),
                    "duration_min": activity.duration_min or 60,
                    "source": activity.source,
                    "is_favorite": activity.is_favorite,
                    "notes": activity.notes,
                    "place_id": str(activity.place_id) if activity.place_id else None,
                    "tags": list(activity.tags_json or []),
                }
            )

        payload_days.append(
            {
                "id": str(day.id),
                "day_index": day.day_index,
                "date": day.date.isoformat(),
                "notes": day.notes,
                "activities": activities,
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
            "preferences": list(trip.preferences_json or []),
            "version": trip.version,
            "last_generated_at": trip.last_generated_at.isoformat()
            if trip.last_generated_at
            else None,
        },
        "days": payload_days,
        "offers": {
            "transport": [
                {
                    "id": str(offer.id),
                    "provider": offer.provider,
                    "title": offer.title,
                    "price_amount": str(offer.price_amount),
                    "currency": offer.currency,
                    "expires_at": offer.expires_at.isoformat(),
                }
                for offer in transport_rows.scalars().all()
            ],
            "lodging": [
                {
                    "id": str(offer.id),
                    "provider": offer.provider,
                    "title": offer.title,
                    "price_amount": str(offer.price_amount),
                    "currency": offer.currency,
                    "expires_at": offer.expires_at.isoformat(),
                }
                for offer in lodging_rows.scalars().all()
            ],
        },
    }


def _materialize_bytes(format_name: str, payload: dict[str, Any]) -> bytes:
    if format_name == "json":
        return _serialize_json(payload)
    if format_name == "ics":
        return _serialize_ics(payload)
    return _serialize_pdf(payload)


def _target_path(*, user_id: uuid.UUID, trip_id: uuid.UUID, export_id: uuid.UUID, format_name: str) -> Path:
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

    trip_row = await db.execute(select(Trip).where(Trip.id == trip_id).where(Trip.user_id == user_id))
    trip = trip_row.scalar_one_or_none()
    if not trip:
        raise NonRetryableJobError("RESOURCE_NOT_FOUND", "Trip not found for export job")
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
