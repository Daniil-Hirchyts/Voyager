from __future__ import annotations

from datetime import date
from uuid import uuid4

from app.db.models import Trip, TripDay
from app.services.itinerary_catalog import build_catalog_candidates


def _trip(destination_text: str) -> tuple[Trip, list[TripDay]]:
    trip = Trip(
        id=uuid4(),
        destination_text=destination_text,
        trip_type="city_break",
        title="Planner catalog test",
        start_date=date(2026, 4, 10),
        end_date=date(2026, 4, 12),
    )
    days = [
        TripDay(id=uuid4(), trip_id=trip.id, day_index=index, date=date(2026, 4, 10 + index))
        for index in range(3)
    ]
    return trip, days


def test_catalog_candidates_are_deterministic_for_supported_city():
    trip, days = _trip("Rome, Italy")

    first = build_catalog_candidates(trip=trip, days=days, seed=7)
    second = build_catalog_candidates(trip=trip, days=days, seed=7)

    assert first == second
    for rows in first.values():
        assert len(rows) == 3
        assert all(row["place_seed"] is not None for row in rows)
        assert all(row["start_time"] is not None for row in rows)


def test_catalog_candidates_fall_back_to_generic_destination_copy():
    trip, days = _trip("Reykjavik, Iceland")

    candidates = build_catalog_candidates(trip=trip, days=days[:1], seed=3)
    rows = candidates[days[0].id]

    assert len(rows) == 3
    assert all("Reykjavik" in row["title"] or "Reykjavik" in row["description"] for row in rows)
    assert all(row["place_seed"] is not None for row in rows)
