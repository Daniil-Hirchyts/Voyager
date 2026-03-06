from __future__ import annotations

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
        preferences_json=["museums", "food"],
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
    monkeypatch.setenv("VOYAGER_DB_DSN", "postgresql+asyncpg://voyager:voyager@localhost:5432/voyager")
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
