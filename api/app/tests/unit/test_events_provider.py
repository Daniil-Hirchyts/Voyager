from datetime import date

import httpx
import pytest

from app.config import get_settings
from app.services.events_provider import TicketmasterEventProvider, resolve_provider_availability


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


@pytest.mark.anyio
async def test_ticketmaster_search_normalizes_events(monkeypatch):
    settings = get_settings()
    settings.events_ticketmaster_api_key = "tm-test-key"
    provider = TicketmasterEventProvider()

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            self.base_url = kwargs.get("base_url")

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, path, params=None):
            assert path == "/events.json"
            assert params["city"] == "Paris"
            assert params["localStartDateTime"] == "2026-12-10T00:00:00,2026-12-10T23:59:59"
            return httpx.Response(
                200,
                json={
                    "_embedded": {
                        "events": [
                            {
                                "id": "evt-1",
                                "name": "Louvre Late Night",
                                "pleaseNote": "Timed entry.",
                                "url": "https://ticketmaster.example/evt-1",
                                "images": [
                                    {"url": "https://img.small", "width": 320, "height": 180},
                                    {"url": "https://img.large", "width": 1024, "height": 768},
                                ],
                                "dates": {
                                    "timezone": "Europe/Paris",
                                    "start": {
                                        "localDate": "2026-12-10",
                                        "dateTime": "2026-12-10T18:30:00Z",
                                    },
                                    "status": {"code": "onsale"},
                                },
                                "classifications": [
                                    {
                                        "segment": {"name": "Arts & Theatre"},
                                        "genre": {"name": "Museum"},
                                    }
                                ],
                                "priceRanges": [{"min": 18, "max": 24, "currency": "EUR"}],
                                "_embedded": {
                                    "venues": [
                                        {
                                            "id": "venue-1",
                                            "name": "Louvre Museum",
                                            "address": {"line1": "Rue de Rivoli"},
                                            "city": {"name": "Paris"},
                                            "country": {"name": "France"},
                                            "location": {"latitude": "48.8606", "longitude": "2.3376"},
                                        }
                                    ]
                                },
                            }
                        ]
                    }
                },
                request=httpx.Request("GET", "https://example.test/events.json"),
            )

    monkeypatch.setattr("app.services.events_provider.httpx.AsyncClient", _FakeClient)

    items = await provider.search(
        {
            "location_text": "Paris, France",
            "start_date": date(2026, 12, 10).isoformat(),
            "end_date": date(2026, 12, 10).isoformat(),
            "size": 10,
        }
    )

    assert len(items) == 1
    item = items[0]
    assert item["provider_event_ref"] == "evt-1"
    assert item["title"] == "Louvre Late Night"
    assert item["venue_name"] == "Louvre Museum"
    assert item["venue_external_id"] == "venue-1"
    assert item["image_url"] == "https://img.large"
    assert item["local_date"] == date(2026, 12, 10)
    assert item["segment"] == "Arts & Theatre"
    assert item["genre"] == "Museum"
    assert str(item["min_price"]) == "18.00"
    assert item["currency"] == "EUR"


def test_event_provider_availability_reports_missing_key(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "events_ticketmaster_api_key", None)

    availability = resolve_provider_availability(["ticketmaster"])

    assert availability.configured == []
    assert availability.unavailable == [
        {
            "provider": "ticketmaster",
            "code": "INTEGRATION_NOT_CONFIGURED",
            "message": "Provider credentials are missing",
            "details": {"missing_env_vars": ["VOYAGER_EVENTS_TICKETMASTER_API_KEY"]},
        }
    ]
