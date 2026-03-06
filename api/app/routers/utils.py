import hashlib
import json
from typing import Any

from fastapi import Header

from app.errors import ValidationApiError


def parse_if_match(if_match: str | None) -> int:
    if if_match is None:
        raise ValidationApiError("If-Match header is required")
    try:
        return int(if_match)
    except ValueError as exc:
        raise ValidationApiError("If-Match header must be an integer") from exc


def payload_fingerprint(payload: Any) -> str:
    serialized = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


async def parse_idempotency_header(
    idempotency_key: str | None = Header(default=None),
) -> str | None:
    return idempotency_key
