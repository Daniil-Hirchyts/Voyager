from __future__ import annotations

import hashlib
import json
import textwrap
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from app.services.export_pipeline_common import _format_money, _to_jsonable


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


def _serialize_json(payload: dict[str, Any]) -> bytes:
    return json.dumps(
        payload,
        indent=2,
        ensure_ascii=False,
        sort_keys=True,
        default=_to_jsonable,
    ).encode("utf-8")


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
    budget_label = trip.get("budget_label") or _format_money(
        trip.get("budget_amount"),
        trip.get("budget_currency"),
    )

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


def _materialize_bytes(format_name: str, payload: dict[str, Any]) -> bytes:
    if format_name == "json":
        return _serialize_json(payload)
    if format_name == "ics":
        return _serialize_ics(payload)
    return _serialize_pdf(payload)
