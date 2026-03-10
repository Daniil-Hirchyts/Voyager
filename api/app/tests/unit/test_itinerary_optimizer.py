from datetime import date, datetime, time
from decimal import Decimal
from uuid import uuid4

import pytest

from app.db.models import EventSnapshot, Place, Trip
from app.services import itinerary_optimizer


def _trip_fixture() -> Trip:
    return Trip(
        id=uuid4(),
        user_id=uuid4(),
        title="Paris flow",
        destination_text="Paris",
        start_date=date(2026, 12, 10),
        end_date=date(2026, 12, 12),
        budget_amount=Decimal("400.00"),
        budget_currency="EUR",
        trip_type="cultural",
        preferences_json=["museums", "food"],
        version=1,
    )


def test_insert_event_candidate_avoids_time_conflicts():
    event = EventSnapshot(
        id=uuid4(),
        trip_id=uuid4(),
        provider="tripadvisor",
        entity_type="attraction",
        provider_event_ref="evt-1",
        title="Night concert",
        start_at=datetime(2026, 12, 10, 19, 0),
        place_id=None,
        raw_payload_json={},
    )

    proposal_items = [
        {
            "title": "Dinner",
            "start_time": time(18, 30),
            "tags_json": ["food"],
            "place_id": None,
        }
    ]

    inserted = itinerary_optimizer._insert_event_candidate(
        proposal_items,
        trip_day_id=uuid4(),
        event=event,
    )

    assert inserted is False
    assert len(proposal_items) == 1


def test_insert_event_candidate_adds_non_conflicting_event():
    event = EventSnapshot(
        id=uuid4(),
        trip_id=uuid4(),
        provider="tripadvisor",
        entity_type="restaurant",
        provider_event_ref="evt-2",
        title="Morning exhibit",
        start_at=datetime(2026, 12, 10, 10, 0),
        place_id=uuid4(),
        raw_payload_json={},
    )
    proposal_items = [
        {
            "title": "Breakfast",
            "start_time": time(8, 0),
            "tags_json": ["food"],
            "place_id": None,
        },
        {
            "title": "Lunch",
            "start_time": time(13, 0),
            "tags_json": ["food"],
            "place_id": None,
        },
    ]

    inserted = itinerary_optimizer._insert_event_candidate(
        proposal_items,
        trip_day_id=uuid4(),
        event=event,
    )

    assert inserted is True
    assert [item["title"] for item in proposal_items] == ["Breakfast", "Morning exhibit", "Lunch"]


@pytest.mark.asyncio
async def test_score_day_balances_distance_variety_and_budget(monkeypatch):
    trip = _trip_fixture()
    place_a = Place(
        id=uuid4(),
        source="manual",
        name="Louvre",
        lat=48.8606,
        lon=2.3376,
        metadata_json={},
    )
    place_b = Place(
        id=uuid4(),
        source="manual",
        name="Montmartre",
        lat=48.8867,
        lon=2.3431,
        metadata_json={},
    )

    items = [
        {
            "title": "Museum visit",
            "tags_json": ["museum", "culture"],
            "place_id": place_a.id,
            "estimated_cost_amount": Decimal("30.00"),
        },
        {
            "title": "Cafe stop",
            "tags_json": ["food"],
            "place_id": place_b.id,
            "estimated_cost_amount": Decimal("20.00"),
        },
    ]

    async def fake_compute_route_leg(*, origin, destination, travel_mode):
        assert origin == (place_a.lat, place_a.lon)
        assert destination == (place_b.lat, place_b.lon)
        assert travel_mode == itinerary_optimizer.RouteTravelMode.WALK
        return 3.2, 41.0

    monkeypatch.setattr(itinerary_optimizer, "compute_route_leg", fake_compute_route_leg)

    score = await itinerary_optimizer._score_day(
        trip=trip,
        items=items,
        places_by_id={place_a.id: place_a, place_b.id: place_b},
        route_cache={},
    )

    assert score["total_score"] > 0
    assert score["variety_score"] >= 20
    assert score["distance_km"] > 0
    assert items[1]["score_json"]["distance_km_from_previous"] > 0
    assert items[1]["score_json"]["travel_minutes_estimate"] == 41.0
