import uuid
from datetime import UTC, date, datetime

from app.services.events_pipeline import _resolve_matched_day_id


def test_resolve_matched_day_id_uses_local_date_before_utc_date():
    day_id = uuid.uuid4()
    result = _resolve_matched_day_id(
        candidate={
            "local_date": date(2026, 6, 12),
            "start_at": datetime(2026, 6, 11, 23, 30, tzinfo=UTC),
        },
        scope_day_by_date={date(2026, 6, 12): day_id},
        resolved_trip_day_id=None,
    )

    assert result == day_id


def test_resolve_matched_day_id_prefers_explicit_trip_day():
    explicit_day_id = uuid.uuid4()
    other_day_id = uuid.uuid4()
    result = _resolve_matched_day_id(
        candidate={
            "local_date": date(2026, 6, 12),
            "start_at": datetime(2026, 6, 12, 2, 0, tzinfo=UTC),
        },
        scope_day_by_date={date(2026, 6, 12): other_day_id},
        resolved_trip_day_id=explicit_day_id,
    )

    assert result == explicit_day_id
