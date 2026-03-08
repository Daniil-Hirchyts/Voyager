from datetime import date
from decimal import Decimal
from uuid import uuid4

import httpx
import pytest

from app.config import get_settings
from app.db.models import EventSnapshot, Place, Trip, TripDay
from app.services.activity_discovery_provider import (
    TripAdvisorActivityProvider,
    resolve_activity_provider_availability,
)
from app.services.activity_recommendations import recommend_shortlist_items


@pytest.mark.anyio
async def test_tripadvisor_restaurant_discovery_normalizes_items(monkeypatch):
    settings = get_settings()
    settings.activities_tripadvisor_api_key = "tripadvisor-test-key"
    provider = TripAdvisorActivityProvider()

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            self.base_url = kwargs.get("base_url")

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, path, params=None):
            assert path == "/restaurants/list"
            assert params["query"] == "Paris"
            return httpx.Response(
                200,
                json={
                    "count": 1,
                    "results": [
                        {
                            "tripadvisor_entity_id": 655719,
                            "name": "Benjamin Steakhouse",
                            "link": "https://example.com/restaurant",
                            "rating": 4.3,
                            "reviews": 2546,
                            "featured_image": "https://example.com/restaurant.jpg",
                            "address": {"address": "52 East 41st Street, New York City, NY 10017"},
                            "coordinates": {"latitude": 40.75174, "longitude": -73.97906},
                            "price_range": "$$",
                            "status_text": "Open now",
                            "cuisines": ["Steakhouse", "Seafood"],
                            "establishment_types": [{"name": "Restaurants"}],
                        }
                    ],
                },
                request=httpx.Request("GET", "https://example.test/restaurants/list"),
            )

    monkeypatch.setattr(
        "app.services.activity_discovery_provider.httpx.AsyncClient",
        _FakeClient,
    )

    total, items, _payload = await provider.discover(
        entity_type="restaurant",
        query="Paris",
        page=1,
        locale="en-US",
        currency="USD",
        trip_dates=None,
    )

    assert total == 1
    assert len(items) == 1
    item = items[0]
    assert item["provider_ref"] == "655719"
    assert item["title"] == "Benjamin Steakhouse"
    assert item["review_count"] == 2546
    assert item["lat"] == pytest.approx(40.75174)
    assert item["lon"] == pytest.approx(-73.97906)
    assert item["price_label"] == "$$"
    assert item["is_attachable"] is True
    assert "Steakhouse" in item["tags"]


@pytest.mark.anyio
async def test_tripadvisor_attraction_discovery_handles_null_award(monkeypatch):
    settings = get_settings()
    settings.activities_tripadvisor_api_key = "tripadvisor-test-key"
    provider = TripAdvisorActivityProvider()

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            self.base_url = kwargs.get("base_url")

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, path, params=None):
            assert path == "/attractions/list"
            assert params["query"] == "Paris"
            return httpx.Response(
                200,
                json={
                    "count": 1,
                    "results": [
                        {
                            "tripadvisor_entity_id": 105127,
                            "name": "Central Park",
                            "link": "https://example.com/attraction",
                            "description": "Large urban park",
                            "rating": 4.7,
                            "reviews": 134359,
                            "categories": [{"name": "Parks"}],
                            "award": None,
                            "featured_image": "https://example.com/attraction.jpg",
                            "pricing_text": None,
                            "experiences": None,
                            "coordinates": {"latitude": 40.78, "longitude": -73.96},
                        }
                    ],
                },
                request=httpx.Request("GET", "https://example.test/attractions/list"),
            )

    monkeypatch.setattr(
        "app.services.activity_discovery_provider.httpx.AsyncClient",
        _FakeClient,
    )

    total, items, _payload = await provider.discover(
        entity_type="attraction",
        query="Paris",
        page=1,
        locale="en-US",
        currency="USD",
        trip_dates=None,
    )

    assert total == 1
    assert len(items) == 1
    item = items[0]
    assert item["provider_ref"] == "105127"
    assert item["title"] == "Central Park"
    assert item["status_text"] is None
    assert item["tags"] == ["Parks"]
    assert item["is_attachable"] is True


def test_activity_provider_availability_reports_missing_key(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "activities_tripadvisor_api_key", None)

    availability = resolve_activity_provider_availability()

    assert availability.configured is False
    assert availability.missing_env_vars == ["TRIPADVISOR_SCRAPER_API_KEY"]


@pytest.mark.anyio
async def test_recommend_shortlist_items_falls_back_when_llm_disabled(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "itinerary_llm_enabled", False)

    trip = Trip(
        id=uuid4(),
        user_id=uuid4(),
        title="Paris food trip",
        destination_text="Paris, France",
        start_date=date(2026, 5, 1),
        end_date=date(2026, 5, 3),
        budget_amount=Decimal("300.00"),
        budget_currency="EUR",
        trip_type="food",
        preferences_json=["food", "bistros"],
        version=1,
    )
    day = TripDay(id=uuid4(), trip_id=trip.id, day_index=0, date=date(2026, 5, 1))
    snapshot = EventSnapshot(
        id=uuid4(),
        trip_id=trip.id,
        provider="tripadvisor",
        entity_type="restaurant",
        provider_event_ref="655719",
        title="Le Petit Bistro",
        summary="Classic Parisian bistro",
        rating=Decimal("4.7"),
        review_count=1200,
        tags_json=["food", "bistro"],
        place_id=uuid4(),
        raw_payload_json={},
        provider_detail_json={},
        price_label="EUR 35 - 55",
        venue_address="Paris",
    )
    snapshot.__dict__["place"] = Place(
        id=snapshot.place_id,
        source="tripadvisor_restaurant",
        name="Le Petit Bistro",
        lat=48.8566,
        lon=2.3522,
        metadata_json={},
    )

    class _Scalars:
        def __init__(self, items):
            self._items = items

        def all(self):
            return self._items

    class _Result:
        def __init__(self, items):
            self._items = items

        def scalars(self):
            return _Scalars(self._items)

    class _FakeSession:
        def __init__(self):
            self._calls = 0

        async def execute(self, _query):
            self._calls += 1
            if self._calls == 1:
                return _Result([snapshot])
            return _Result([])

    async def _fake_get_trip(_db, user_id, trip_id):
        assert user_id == trip.user_id
        assert trip_id == trip.id
        return trip

    async def _fake_list_days(_db, user_id, trip_id):
        assert user_id == trip.user_id
        assert trip_id == trip.id
        return [day]

    monkeypatch.setattr("app.services.activity_recommendations.TripRepository.get_trip", _fake_get_trip)
    monkeypatch.setattr("app.services.activity_recommendations.TripRepository.list_days", _fake_list_days)

    items = await recommend_shortlist_items(
        _FakeSession(),
        redis=None,
        user_id=trip.user_id,
        trip_id=trip.id,
        day_ids=None,
        snapshot_ids=None,
        limit=5,
        use_llm_rationale=True,
    )

    assert len(items) == 1
    assert items[0]["snapshot_id"] == snapshot.id
    assert items[0]["trip_day_id"] == day.id
    assert "Le Petit Bistro" in items[0]["rationale"]
