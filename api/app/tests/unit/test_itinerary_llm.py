from __future__ import annotations

import json
from datetime import date
from uuid import uuid4

import httpx
import pytest

from app.config import get_settings
from app.db.models import Trip, TripDay
from app.services import itinerary_llm


def _trip_fixture() -> tuple[Trip, list[TripDay]]:
    trip = Trip(
        id=uuid4(),
        destination_text="Lisbon",
        trip_type="cultural",
        title="LLM test trip",
        start_date=date(2026, 11, 1),
        end_date=date(2026, 11, 2),
    )
    days = [
        TripDay(id=uuid4(), trip_id=trip.id, day_index=0, date=date(2026, 11, 1)),
        TripDay(id=uuid4(), trip_id=trip.id, day_index=1, date=date(2026, 11, 2)),
    ]
    return trip, days


@pytest.fixture(autouse=True)
def _stub_redis_and_metrics(monkeypatch):
    async def _noop_limit(*args, **kwargs):
        return None

    async def _noop_metric(*args, **kwargs):
        return None

    monkeypatch.setattr(itinerary_llm, "enforce_limit", _noop_limit)
    monkeypatch.setattr(itinerary_llm, "increment_itinerary_llm_metric", _noop_metric)


@pytest.fixture(autouse=True)
def _base_settings_env(monkeypatch):
    monkeypatch.setenv(
        "VOYAGER_DB_DSN", "postgresql+asyncpg://voyager:voyager@localhost:5432/voyager"
    )
    monkeypatch.setenv("VOYAGER_REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setenv("VOYAGER_KEYCLOAK_ISSUER", "http://localhost:8080/realms/travel")
    monkeypatch.setenv("VOYAGER_KEYCLOAK_AUDIENCE", "voyager-api")
    monkeypatch.setenv(
        "VOYAGER_KEYCLOAK_JWKS_URL",
        "http://localhost:8080/realms/travel/protocol/openid-connect/certs",
    )
    monkeypatch.setenv("VOYAGER_KEYCLOAK_CLIENT_ID", "voyager-api")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _configure_settings(
    *,
    enabled: bool = True,
    api_key: str | None = "test-key",
    model_order: str = "openai/gpt-oss-20b:free,qwen/qwen3-coder:free",
) -> None:
    settings = get_settings()
    settings.itinerary_llm_enabled = enabled
    settings.llm_openrouter_api_key = api_key
    settings.llm_openrouter_model_order_raw = model_order


@pytest.mark.anyio
async def test_openrouter_mock_success_returns_candidates(monkeypatch):
    trip, days = _trip_fixture()
    _configure_settings(api_key="live-key")

    result = await itinerary_llm.generate_with_openrouter(
        trip=trip,
        days=days,
        seed=7,
        constraints={"llm_mock_mode": "success"},
    )

    assert result.success is True
    assert result.model == "openai/gpt-oss-20b:free"
    assert set(result.candidates_by_day.keys()) == {day.id for day in days}
    for day_rows in result.candidates_by_day.values():
        assert len(day_rows) == 3
        assert all(isinstance(item["title"], str) and item["title"] for item in day_rows)
        assert all(isinstance(item["google_place_id"], str) and item["google_place_id"] for item in day_rows)
        assert all(isinstance(item["place_name"], str) and item["place_name"] for item in day_rows)
        assert all(isinstance(item["address_text"], str) and item["address_text"] for item in day_rows)


@pytest.mark.anyio
async def test_call_openrouter_executes_google_tools(monkeypatch):
    trip, days = _trip_fixture()
    _configure_settings(api_key="live-key", model_order="openai/gpt-oss-20b:free")
    payloads: list[dict] = []

    async def _fake_search(query: str, limit: int):
        assert query == "Jeronimos Monastery Lisbon"
        assert limit == 1
        return [
            type(
                "GoogleCandidate",
                (),
                {
                    "place_id": "google-place-1",
                    "name": "Jeronimos Monastery",
                    "label": "Praça do Império 1400-206 Lisboa, Portugal",
                    "address_text": "Praça do Império 1400-206 Lisboa, Portugal",
                    "category": "tourist_attraction",
                    "country": "Portugal",
                    "region": "Lisbon",
                    "lat": 38.6979,
                    "lon": -9.2066,
                    "metadata": {"google_maps_uri": "https://maps.google.com/?cid=1"},
                },
            )()
        ]

    monkeypatch.setattr(itinerary_llm, "search_google_places", _fake_search)

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, headers=None, json_body=None, **kwargs):
            payload = json_body if json_body is not None else kwargs.get("json")
            payloads.append(payload)
            request = httpx.Request("POST", url)
            if len(payloads) == 1:
                return httpx.Response(
                    200,
                    json={
                        "choices": [
                            {
                                "message": {
                                    "role": "assistant",
                                    "content": None,
                                    "tool_calls": [
                                        {
                                            "id": "call_1",
                                            "type": "function",
                                            "function": {
                                                "name": "google_places_search",
                                                "arguments": json_module.dumps(
                                                    {
                                                        "query": "Jeronimos Monastery Lisbon",
                                                        "limit": 1,
                                                    }
                                                ),
                                            },
                                        }
                                    ],
                                }
                            }
                        ]
                    },
                    request=request,
                )
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": json.dumps(
                                    {
                                        "days": [
                                            {
                                                "day_id": str(days[0].id),
                                                "activities": [
                                                    {
                                                        "slot": "morning",
                                                        "title": "Explore Jeronimos Monastery",
                                                        "description": "Spend the morning at the monastery cloisters.",
                                                        "duration_min": 120,
                                                        "tags": ["history", "architecture"],
                                                        "place_query": "Jeronimos Monastery Lisbon",
                                                        "google_place_id": "google-place-1",
                                                        "place_name": "Jeronimos Monastery",
                                                        "address_text": "Praça do Império 1400-206 Lisboa, Portugal",
                                                    },
                                                    {
                                                        "slot": "afternoon",
                                                        "title": "Pasteis de Belem stop",
                                                        "description": "Walk nearby for pastries after lunch.",
                                                        "duration_min": 90,
                                                        "tags": ["food"],
                                                        "place_query": "Pasteis de Belem Lisbon",
                                                        "google_place_id": "google-place-2",
                                                        "place_name": "Pastéis de Belém",
                                                        "address_text": "R. de Belém 84 92, 1300-085 Lisboa, Portugal",
                                                    },
                                                    {
                                                        "slot": "evening",
                                                        "title": "Belém riverfront sunset",
                                                        "description": "Finish with a walk by the waterfront.",
                                                        "duration_min": 90,
                                                        "tags": ["walk"],
                                                        "place_query": "Belem waterfront Lisbon",
                                                        "google_place_id": "google-place-3",
                                                        "place_name": "Belém",
                                                        "address_text": "Belém, Lisbon, Portugal",
                                                    },
                                                ],
                                            },
                                            {
                                                "day_id": str(days[1].id),
                                                "activities": [
                                                    {
                                                        "slot": "morning",
                                                        "title": "Alfama tram ride",
                                                        "description": "Ride tram 28 through Alfama.",
                                                        "duration_min": 90,
                                                        "tags": ["tram"],
                                                        "place_query": "Alfama Lisbon",
                                                        "google_place_id": "google-place-4",
                                                        "place_name": "Alfama",
                                                        "address_text": "Alfama, Lisbon, Portugal",
                                                    },
                                                    {
                                                        "slot": "afternoon",
                                                        "title": "Lisbon Cathedral visit",
                                                        "description": "Visit Se de Lisboa in the afternoon.",
                                                        "duration_min": 90,
                                                        "tags": ["cathedral"],
                                                        "place_query": "Lisbon Cathedral",
                                                        "google_place_id": "google-place-5",
                                                        "place_name": "Lisbon Cathedral",
                                                        "address_text": "Largo da Sé 1, 1100-585 Lisboa, Portugal",
                                                    },
                                                    {
                                                        "slot": "evening",
                                                        "title": "Miradouro sunset",
                                                        "description": "Watch sunset from a miradouro.",
                                                        "duration_min": 90,
                                                        "tags": ["viewpoint"],
                                                        "place_query": "Miradouro de Santa Luzia",
                                                        "google_place_id": "google-place-6",
                                                        "place_name": "Miradouro de Santa Luzia",
                                                        "address_text": "Largo de Santa Luzia, 1100-487 Lisboa, Portugal",
                                                    },
                                                ],
                                            },
                                        ]
                                    }
                                ),
                            }
                        }
                    ]
                },
                request=request,
            )

    json_module = json
    monkeypatch.setattr(itinerary_llm.httpx, "AsyncClient", _FakeClient)

    result = await itinerary_llm._call_openrouter(
        model="openai/gpt-oss-20b:free",
        trip=trip,
        days=days,
        seed=7,
    )

    assert len(payloads) == 2
    assert any(message["role"] == "tool" for message in payloads[1]["messages"])
    assert result[days[0].id][0]["google_place_id"] == "google-place-1"
    assert result[days[0].id][0]["place_query"] == "Jeronimos Monastery Lisbon"


@pytest.mark.anyio
async def test_call_openrouter_allows_more_than_six_tool_turns(monkeypatch):
    trip, days = _trip_fixture()
    _configure_settings(api_key="live-key", model_order="stepfun/step-3.5-flash:free")
    call_count = 0

    async def _fake_execute_tool_call(name: str, arguments):
        return {
            "tool": name,
            "arguments": arguments,
        }

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, headers=None, json_body=None, **kwargs):
            nonlocal call_count
            call_count += 1
            request = httpx.Request("POST", url)
            if call_count <= 7:
                return httpx.Response(
                    200,
                    json={
                        "choices": [
                            {
                                "message": {
                                    "role": "assistant",
                                    "content": None,
                                    "tool_calls": [
                                        {
                                            "id": f"call_{call_count}",
                                            "type": "function",
                                            "function": {
                                                "name": (
                                                    "google_places_search"
                                                    if call_count % 2 == 1
                                                    else "google_place_details"
                                                ),
                                                "arguments": json.dumps(
                                                    {"query": f"query-{call_count}", "place_id": f"place-{call_count}"}
                                                ),
                                            },
                                        }
                                    ],
                                }
                            }
                        ]
                    },
                    request=request,
                )
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": json.dumps(
                                    {
                                        "days": [
                                            {
                                                "day_id": str(days[0].id),
                                                "activities": [
                                                    {
                                                        "slot": "morning",
                                                        "title": "Morning visit",
                                                        "description": "Morning museum block.",
                                                        "duration_min": 120,
                                                        "tags": ["museum"],
                                                        "place_query": "Morning place",
                                                        "google_place_id": "google-place-1",
                                                        "place_name": "Morning place",
                                                        "address_text": "1 Morning St, Paris, France",
                                                    },
                                                    {
                                                        "slot": "afternoon",
                                                        "title": "Afternoon cafe",
                                                        "description": "Afternoon cafe stop.",
                                                        "duration_min": 90,
                                                        "tags": ["food"],
                                                        "place_query": "Afternoon place",
                                                        "google_place_id": "google-place-2",
                                                        "place_name": "Afternoon place",
                                                        "address_text": "2 Afternoon St, Paris, France",
                                                    },
                                                    {
                                                        "slot": "evening",
                                                        "title": "Evening tower",
                                                        "description": "Evening landmark stop.",
                                                        "duration_min": 90,
                                                        "tags": ["landmark"],
                                                        "place_query": "Evening place",
                                                        "google_place_id": "google-place-3",
                                                        "place_name": "Evening place",
                                                        "address_text": "3 Evening St, Paris, France",
                                                    },
                                                ],
                                            },
                                            {
                                                "day_id": str(days[1].id),
                                                "activities": [
                                                    {
                                                        "slot": "morning",
                                                        "title": "Second morning walk",
                                                        "description": "Morning walk.",
                                                        "duration_min": 90,
                                                        "tags": ["walk"],
                                                        "place_query": "Second morning place",
                                                        "google_place_id": "google-place-4",
                                                        "place_name": "Second morning place",
                                                        "address_text": "4 Morning St, Paris, France",
                                                    },
                                                    {
                                                        "slot": "afternoon",
                                                        "title": "Second afternoon gallery",
                                                        "description": "Gallery visit.",
                                                        "duration_min": 90,
                                                        "tags": ["gallery"],
                                                        "place_query": "Second afternoon place",
                                                        "google_place_id": "google-place-5",
                                                        "place_name": "Second afternoon place",
                                                        "address_text": "5 Afternoon St, Paris, France",
                                                    },
                                                    {
                                                        "slot": "evening",
                                                        "title": "Second evening dinner",
                                                        "description": "Dinner stop.",
                                                        "duration_min": 90,
                                                        "tags": ["dinner"],
                                                        "place_query": "Second evening place",
                                                        "google_place_id": "google-place-6",
                                                        "place_name": "Second evening place",
                                                        "address_text": "6 Evening St, Paris, France",
                                                    },
                                                ],
                                            },
                                        ]
                                    }
                                ),
                            }
                        }
                    ]
                },
                request=request,
            )

    monkeypatch.setattr(itinerary_llm, "_execute_tool_call", _fake_execute_tool_call)
    monkeypatch.setattr(itinerary_llm.httpx, "AsyncClient", _FakeClient)

    result = await itinerary_llm._call_openrouter(
        model="stepfun/step-3.5-flash:free",
        trip=trip,
        days=days,
        seed=7,
    )

    assert call_count == 8
    assert len(result[days[0].id]) == 3
    assert result[days[0].id][0]["google_place_id"] == "google-place-1"


@pytest.mark.anyio
async def test_call_openrouter_repairs_invalid_final_output(monkeypatch):
    trip, days = _trip_fixture()
    _configure_settings(api_key="live-key", model_order="arcee-ai/trinity-large-preview:free")
    call_count = 0

    invalid_payload = {
        "days": [
            {
                "day_id": str(days[0].id),
                "activities": [
                    {
                        "slot": "morning",
                        "title": "Morning visit",
                        "description": "Morning museum block.",
                        "duration_min": 120,
                        "tags": ["museum"],
                        "place_query": "Morning place",
                        "google_place_id": "dup-place",
                        "place_name": "Morning place",
                        "address_text": "1 Morning St, Paris, France",
                    },
                    {
                        "slot": "afternoon",
                        "title": "Afternoon cafe",
                        "description": "Afternoon cafe stop.",
                        "duration_min": 90,
                        "tags": ["food"],
                        "place_query": "Afternoon place",
                        "google_place_id": "google-place-2",
                        "place_name": "Afternoon place",
                        "address_text": "2 Afternoon St, Paris, France",
                    },
                    {
                        "slot": "evening",
                        "title": "Evening tower",
                        "description": "Evening landmark stop.",
                        "duration_min": 90,
                        "tags": ["landmark"],
                        "place_query": "Evening place",
                        "google_place_id": "google-place-3",
                        "place_name": "Evening place",
                        "address_text": "3 Evening St, Paris, France",
                    },
                ],
            },
            {
                "day_id": str(days[1].id),
                "activities": [
                    {
                        "slot": "morning",
                        "title": "Second morning walk",
                        "description": "Morning walk.",
                        "duration_min": 90,
                        "tags": ["walk"],
                        "place_query": "Second morning place",
                        "google_place_id": "dup-place",
                        "place_name": "Second morning place",
                        "address_text": "4 Morning St, Paris, France",
                    },
                    {
                        "slot": "afternoon",
                        "title": "Second afternoon gallery",
                        "description": "Gallery visit.",
                        "duration_min": 90,
                        "tags": ["gallery"],
                        "place_query": "Second afternoon place",
                        "google_place_id": "google-place-5",
                        "place_name": "Second afternoon place",
                        "address_text": "5 Afternoon St, Paris, France",
                    },
                    {
                        "slot": "evening",
                        "title": "Second evening dinner",
                        "description": "Dinner stop.",
                        "duration_min": 90,
                        "tags": ["dinner"],
                        "place_query": "Second evening place",
                        "google_place_id": "google-place-6",
                        "place_name": "Second evening place",
                        "address_text": "6 Evening St, Paris, France",
                    },
                ],
            },
        ]
    }
    corrected_payload = {
        "days": [
            {
                "day_id": str(days[0].id),
                "activities": invalid_payload["days"][0]["activities"],
            },
            {
                "day_id": str(days[1].id),
                "activities": [
                    {
                        "slot": "morning",
                        "title": "Second morning walk",
                        "description": "Morning walk.",
                        "duration_min": 90,
                        "tags": ["walk"],
                        "place_query": "Second morning place",
                        "google_place_id": "google-place-4",
                        "place_name": "Second morning place",
                        "address_text": "4 Morning St, Paris, France",
                    },
                    {
                        "slot": "afternoon",
                        "title": "Second afternoon gallery",
                        "description": "Gallery visit.",
                        "duration_min": 90,
                        "tags": ["gallery"],
                        "place_query": "Second afternoon place",
                        "google_place_id": "google-place-5",
                        "place_name": "Second afternoon place",
                        "address_text": "5 Afternoon St, Paris, France",
                    },
                    {
                        "slot": "evening",
                        "title": "Second evening dinner",
                        "description": "Dinner stop.",
                        "duration_min": 90,
                        "tags": ["dinner"],
                        "place_query": "Second evening place",
                        "google_place_id": "google-place-6",
                        "place_name": "Second evening place",
                        "address_text": "6 Evening St, Paris, France",
                    },
                ],
            },
        ]
    }

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, headers=None, json_body=None, **kwargs):
            nonlocal call_count
            call_count += 1
            request = httpx.Request("POST", url)
            payload = invalid_payload if call_count == 1 else corrected_payload
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": json.dumps(payload),
                            }
                        }
                    ]
                },
                request=request,
            )

    monkeypatch.setattr(itinerary_llm.httpx, "AsyncClient", _FakeClient)

    result = await itinerary_llm._call_openrouter(
        model="arcee-ai/trinity-large-preview:free",
        trip=trip,
        days=days,
        seed=7,
    )

    assert call_count == 2
    assert result[days[1].id][0]["google_place_id"] == "google-place-4"


@pytest.mark.anyio
async def test_openrouter_failover_moves_to_next_model(monkeypatch):
    trip, days = _trip_fixture()
    _configure_settings(api_key="live-key")
    calls: list[str] = []

    async def _fake_call(*, model: str, trip: Trip, days: list[TripDay], seed: int | None):
        calls.append(model)
        if model == "openai/gpt-oss-20b:free":
            raise RuntimeError("PROVIDER_ERROR:503")
        return itinerary_llm._deterministic_mock_candidates(
            trip=trip,
            days=days,
            model=model,
            seed=seed,
        )

    monkeypatch.setattr(itinerary_llm, "_call_openrouter", _fake_call)

    result = await itinerary_llm.generate_with_openrouter(
        trip=trip,
        days=days,
        seed=3,
        constraints={},
    )

    assert calls == ["openai/gpt-oss-20b:free", "qwen/qwen3-coder:free"]
    assert result.success is True
    assert result.model == "qwen/qwen3-coder:free"
    assert any(err["code"] == "UPSTREAM_PROVIDER_ERROR" for err in result.errors)


@pytest.mark.anyio
async def test_openrouter_timeout_returns_failure_with_errors(monkeypatch):
    trip, days = _trip_fixture()
    _configure_settings(api_key="live-key", model_order="openai/gpt-oss-20b:free")

    async def _timeout_call(*args, **kwargs):
        raise httpx.TimeoutException("timed out")

    monkeypatch.setattr(itinerary_llm, "_call_openrouter", _timeout_call)

    result = await itinerary_llm.generate_with_openrouter(
        trip=trip,
        days=days,
        seed=1,
        constraints={},
    )

    assert result.success is False
    assert result.candidates_by_day == {}
    assert result.errors and result.errors[0]["code"] == "UPSTREAM_PROVIDER_TIMEOUT"


@pytest.mark.anyio
async def test_openrouter_missing_key_returns_not_configured():
    trip, days = _trip_fixture()
    _configure_settings(api_key=None, model_order="openai/gpt-oss-20b:free")

    result = await itinerary_llm.generate_with_openrouter(
        trip=trip,
        days=days,
        seed=1,
        constraints={"llm_mock_mode": "success"},
    )

    assert result.success is False
    assert result.errors and result.errors[0]["code"] == "INTEGRATION_NOT_CONFIGURED"


def test_normalize_day_candidates_requires_google_grounding_fields():
    _, days = _trip_fixture()

    with pytest.raises(ValueError, match="missing google_place_id"):
        itinerary_llm._normalize_day_candidates(
            day_payload={
                "activities": [
                    {
                        "slot": "morning",
                        "title": "Morning museum",
                        "description": "Visit a museum.",
                        "duration_min": 120,
                        "tags": ["museum"],
                        "place_query": "Museum Lisbon",
                        "google_place_id": None,
                        "place_name": "Museum",
                        "address_text": "Rua Example 1, Lisbon, Portugal",
                    },
                    {
                        "slot": "afternoon",
                        "title": "Lunch stop",
                        "description": "Have lunch nearby.",
                        "duration_min": 90,
                        "tags": ["food"],
                        "place_query": "Lunch Lisbon",
                        "google_place_id": "google-place-2",
                        "place_name": "Lunch Stop",
                        "address_text": "Rua Example 2, Lisbon, Portugal",
                    },
                    {
                        "slot": "evening",
                        "title": "Sunset walk",
                        "description": "Walk at sunset.",
                        "duration_min": 90,
                        "tags": ["walk"],
                        "place_query": "Sunset Lisbon",
                        "google_place_id": "google-place-3",
                        "place_name": "Sunset Walk",
                        "address_text": "Rua Example 3, Lisbon, Portugal",
                    },
                ]
            },
            day_id=days[0].id,
        )


def test_normalize_output_rejects_duplicate_places_across_days():
    _, days = _trip_fixture()

    payload = {
        "days": [
            {
                "day_id": str(days[0].id),
                "activities": [
                    {
                        "slot": "morning",
                        "title": "Jeronimos Monastery visit",
                        "description": "Visit the monastery.",
                        "duration_min": 120,
                        "tags": ["history"],
                        "place_query": "Jeronimos Monastery Lisbon",
                        "google_place_id": "google-place-1",
                        "place_name": "Jeronimos Monastery",
                        "address_text": "Praça do Império 1400-206 Lisboa, Portugal",
                    },
                    {
                        "slot": "afternoon",
                        "title": "Belém pastry stop",
                        "description": "Eat pastries.",
                        "duration_min": 90,
                        "tags": ["food"],
                        "place_query": "Pastéis de Belém Lisbon",
                        "google_place_id": "google-place-2",
                        "place_name": "Pastéis de Belém",
                        "address_text": "R. de Belém 84 92, 1300-085 Lisboa, Portugal",
                    },
                    {
                        "slot": "evening",
                        "title": "Riverfront walk",
                        "description": "Walk by the river.",
                        "duration_min": 90,
                        "tags": ["walk"],
                        "place_query": "MAAT Lisbon",
                        "google_place_id": "google-place-3",
                        "place_name": "MAAT",
                        "address_text": "Av. Brasília, 1300-598 Lisboa, Portugal",
                    },
                ],
            },
            {
                "day_id": str(days[1].id),
                "activities": [
                    {
                        "slot": "morning",
                        "title": "Repeat monastery visit",
                        "description": "Repeat the same place.",
                        "duration_min": 120,
                        "tags": ["history"],
                        "place_query": "Jeronimos Monastery Lisbon",
                        "google_place_id": "google-place-1",
                        "place_name": "Jeronimos Monastery",
                        "address_text": "Praça do Império 1400-206 Lisboa, Portugal",
                    },
                    {
                        "slot": "afternoon",
                        "title": "Cathedral visit",
                        "description": "Visit the cathedral.",
                        "duration_min": 90,
                        "tags": ["cathedral"],
                        "place_query": "Lisbon Cathedral",
                        "google_place_id": "google-place-4",
                        "place_name": "Lisbon Cathedral",
                        "address_text": "Largo da Sé 1, 1100-585 Lisboa, Portugal",
                    },
                    {
                        "slot": "evening",
                        "title": "Viewpoint sunset",
                        "description": "Watch sunset.",
                        "duration_min": 90,
                        "tags": ["viewpoint"],
                        "place_query": "Miradouro de Santa Luzia",
                        "google_place_id": "google-place-5",
                        "place_name": "Miradouro de Santa Luzia",
                        "address_text": "Largo de Santa Luzia, 1100-487 Lisboa, Portugal",
                    },
                ],
            },
        ]
    }

    with pytest.raises(ValueError, match="reused the same google_place_id"):
        itinerary_llm._normalize_output(
            response_text=json.dumps(payload),
            days=days,
        )
