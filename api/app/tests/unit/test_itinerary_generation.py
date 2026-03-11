from __future__ import annotations

from datetime import date
from uuid import uuid4

import pytest

from app.db.models import Trip, TripDay
from app.services import itinerary_generation
from app.services.itinerary_llm import OpenRouterGenerationResult


def _trip_fixture() -> tuple[Trip, list[TripDay]]:
    trip = Trip(
        id=uuid4(),
        destination_text="Lisbon",
        trip_type="cultural",
        title="Generation test trip",
        start_date=date(2026, 11, 1),
        end_date=date(2026, 11, 2),
    )
    days = [
        TripDay(id=uuid4(), trip_id=trip.id, day_index=0, date=date(2026, 11, 1)),
        TripDay(id=uuid4(), trip_id=trip.id, day_index=1, date=date(2026, 11, 2)),
    ]
    return trip, days


@pytest.mark.anyio
async def test_resolve_google_place_requires_canonical_address(monkeypatch):
    async def _fake_lookup_google_place(place_id: str):
        return type(
            "Details",
            (),
            {
                "place_id": place_id,
                "name": "Jeronimos Monastery",
                "formatted_address": None,
                "category": "tourist_attraction",
                "country": "Portugal",
                "region": "Lisbon",
                "lat": 38.6979,
                "lng": -9.2066,
                "timezone": "Europe/Lisbon",
                "metadata": {},
            },
        )()

    async def _unexpected_get_or_create_external_place(*args, **kwargs):
        raise AssertionError("place persistence should not run without a canonical Google address")

    monkeypatch.setattr(itinerary_generation, "lookup_google_place", _fake_lookup_google_place)
    monkeypatch.setattr(
        itinerary_generation.PlaceRepository,
        "get_or_create_external_place",
        _unexpected_get_or_create_external_place,
    )

    place = await itinerary_generation._resolve_google_place(
        object(),
        google_place_id="google-place-1",
        place_cache={},
    )

    assert place is None


@pytest.mark.anyio
async def test_resolve_google_place_rejects_destination_level_place(monkeypatch):
    async def _fake_lookup_google_place(place_id: str):
        return type(
            "Details",
            (),
            {
                "place_id": place_id,
                "name": "Moscow",
                "formatted_address": "Moscow, Russia",
                "category": "locality",
                "country": "Russia",
                "region": "Moscow",
                "lat": 55.7558,
                "lng": 37.6173,
                "timezone": "Europe/Moscow",
                "metadata": {"types": ["locality", "political"]},
            },
        )()

    async def _unexpected_get_or_create_external_place(*args, **kwargs):
        raise AssertionError("place persistence should not run for destination-level Google places")

    monkeypatch.setattr(itinerary_generation, "lookup_google_place", _fake_lookup_google_place)
    monkeypatch.setattr(
        itinerary_generation.PlaceRepository,
        "get_or_create_external_place",
        _unexpected_get_or_create_external_place,
    )

    place = await itinerary_generation._resolve_google_place(
        object(),
        google_place_id="google-place-city",
        place_cache={},
    )

    assert place is None


@pytest.mark.anyio
async def test_resolve_candidates_for_scope_fails_when_llm_grounding_is_incomplete(monkeypatch):
    trip, days = _trip_fixture()

    async def _fake_generate_with_openrouter(*, trip: Trip, days: list[TripDay], seed, constraints):
        return OpenRouterGenerationResult(
            attempted=True,
            success=True,
            model="openai/gpt-oss-20b:free",
            candidates_by_day={day.id: [] for day in days},
            errors=[],
        )

    async def _fake_resolve_llm_candidates_for_scope(
        db,
        *,
        trip: Trip,
        days: list[TripDay],
        candidates_by_day,
        llm_model,
        constraints,
    ):
        return itinerary_generation.CandidateResolutionResult(
            candidates_by_day={day.id: [] for day in days},
            generator_engine="llm_google_grounded",
            llm_model=llm_model,
            fallback_used=False,
            provider_errors=[
                {
                    "provider": "google_maps",
                    "code": "PLACE_NOT_FOUND",
                    "message": "Google place grounding did not return a canonical address",
                    "details": {"title": "Morning museum"},
                }
            ],
            resolved_place_count=0,
            photo_enriched_place_count=0,
            unresolved_activity_count=1,
        )

    monkeypatch.setattr(
        itinerary_generation,
        "generate_with_openrouter",
        _fake_generate_with_openrouter,
    )
    monkeypatch.setattr(
        itinerary_generation,
        "_resolve_llm_candidates_for_scope",
        _fake_resolve_llm_candidates_for_scope,
    )

    with pytest.raises(itinerary_generation.NonRetryableJobError) as exc:
        await itinerary_generation._resolve_candidates_for_scope(
            object(),
            trip=trip,
            days=days,
            seed=7,
            constraints={},
        )

    assert exc.value.code == "ITINERARY_GROUNDING_REQUIRED"


@pytest.mark.anyio
async def test_resolve_candidates_for_scope_marks_provider_timeouts_retryable(monkeypatch):
    trip, days = _trip_fixture()

    async def _fake_generate_with_openrouter(*, trip: Trip, days: list[TripDay], seed, constraints):
        return OpenRouterGenerationResult(
            attempted=True,
            success=False,
            model="openai/gpt-oss-20b:free",
            candidates_by_day={},
            errors=[
                {
                    "provider": "openrouter",
                    "code": "UPSTREAM_PROVIDER_TIMEOUT",
                    "message": "OpenRouter request timed out",
                }
            ],
        )

    monkeypatch.setattr(
        itinerary_generation,
        "generate_with_openrouter",
        _fake_generate_with_openrouter,
    )

    with pytest.raises(itinerary_generation.RetryableJobError) as exc:
        await itinerary_generation._resolve_candidates_for_scope(
            object(),
            trip=trip,
            days=days,
            seed=7,
            constraints={},
        )

    assert exc.value.code == "ITINERARY_GROUNDING_UPSTREAM_ERROR"
