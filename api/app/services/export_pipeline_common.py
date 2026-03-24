from __future__ import annotations

import uuid
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any

from app.services.itinerary_generation import NonRetryableJobError


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


def _to_jsonable(value: Any) -> Any:
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def _as_record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _format_money(amount: Any, currency: Any) -> str | None:
    if amount in (None, ""):
        return None
    amount_text = str(amount)
    currency_text = str(currency).strip() if currency else ""
    return f"{amount_text} {currency_text}".strip()
