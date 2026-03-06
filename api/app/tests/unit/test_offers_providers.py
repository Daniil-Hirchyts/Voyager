import httpx
import pytest

from app.config import get_settings
from app.models.offers import OfferKind
from app.services.offers_provider import (
    AmadeusLodgingProvider,
    resolve_provider_availability,
)


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
async def test_amadeus_lodging_search_normalizes_offers(monkeypatch):
    provider = AmadeusLodgingProvider()

    calls: list[tuple[str, str, dict | None]] = []

    async def _fake_authorized_request(*, method, path, params=None, json_body=None, retry_on_unauthorized=True):
        calls.append((method, path, params))
        assert method == "GET"
        assert params is not None
        if path == "/v1/reference-data/locations/cities":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "name": "Paris",
                            "iataCode": "PAR",
                        }
                    ]
                },
            )
        if path == "/v1/reference-data/locations/hotels/by-city":
            assert params["cityCode"] == "PAR"
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"hotelId": "H1"},
                    ]
                },
            )
        assert path == "/v3/shopping/hotel-offers"
        assert params["hotelIds"] == "H1"
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "hotel": {"hotelId": "H1", "name": "Central Hotel"},
                        "offers": [
                            {
                                "id": "A1",
                                "checkInDate": "2026-12-10",
                                "checkOutDate": "2026-12-12",
                                "price": {"total": "210.00", "currency": "EUR"},
                                "room": {"typeEstimated": {"category": "STANDARD_ROOM"}},
                            }
                        ],
                    }
                ]
            },
        )

    monkeypatch.setattr(provider, "_authorized_request", _fake_authorized_request)

    offers = await provider.search(
        {
            "location_text": "Paris",
            "checkin_date": "2026-12-10",
            "checkout_date": "2026-12-12",
            "currency": "EUR",
            "guests": 2,
            "constraints": {},
        }
    )

    assert len(offers) == 1
    assert offers[0]["lodging_type"] == "hotel"
    assert offers[0]["provider_offer_ref"] == "A1"
    assert [path for _, path, _ in calls] == [
        "/v1/reference-data/locations/cities",
        "/v1/reference-data/locations/hotels/by-city",
        "/v3/shopping/hotel-offers",
    ]


def test_provider_availability_reports_missing_env_vars(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "flights_amadeus_client_id", None)
    monkeypatch.setattr(settings, "flights_amadeus_client_secret", None)

    transport_availability = resolve_provider_availability(
        OfferKind.TRANSPORT,
        ["amadeus_transport", "mock_transport"],
    )
    lodging_availability = resolve_provider_availability(
        OfferKind.LODGING,
        ["amadeus_lodging", "mock_lodging"],
    )

    assert transport_availability.configured == ["mock_transport"]
    assert any(
        item["provider"] == "amadeus_transport"
        and set(item["missing_env_vars"]) == {
            "VOYAGER_FLIGHTS_AMADEUS_CLIENT_ID",
            "VOYAGER_FLIGHTS_AMADEUS_CLIENT_SECRET",
        }
        for item in transport_availability.unavailable
    )

    assert lodging_availability.configured == ["mock_lodging"]
    missing_by_provider = {item["provider"]: set(item["missing_env_vars"]) for item in lodging_availability.unavailable}
    assert missing_by_provider["amadeus_lodging"] == {
        "VOYAGER_FLIGHTS_AMADEUS_CLIENT_ID",
        "VOYAGER_FLIGHTS_AMADEUS_CLIENT_SECRET",
    }
