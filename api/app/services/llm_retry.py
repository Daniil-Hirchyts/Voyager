from __future__ import annotations

from datetime import UTC, datetime
from email.utils import parsedate_to_datetime


def _parse_retry_after_ms(raw: str | None) -> int | None:
    if raw is None:
        return None

    value = raw.strip()
    if not value:
        return None

    try:
        seconds = float(value)
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(value)
        except (TypeError, ValueError, IndexError, OverflowError):
            return None
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=UTC)
        seconds = (retry_at - datetime.now(UTC)).total_seconds()

    milliseconds = int(seconds * 1000)
    if milliseconds <= 0:
        return None
    return milliseconds


def llm_rate_limit_retry_delay_sec(
    *,
    attempt: int,
    retry_after: str | None,
    base_delay_ms: int,
    max_delay_ms: int,
) -> float:
    parsed_ms = _parse_retry_after_ms(retry_after)
    fallback_ms = min(max_delay_ms, base_delay_ms * (2 ** max(attempt - 1, 0)))
    chosen_ms = parsed_ms if parsed_ms is not None else fallback_ms
    bounded_ms = max(100, min(chosen_ms, max_delay_ms))
    return bounded_ms / 1000
