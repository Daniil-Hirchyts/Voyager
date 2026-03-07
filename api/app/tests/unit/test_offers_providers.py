import httpx
import pytest

from app.config import get_settings
from app.models.offers import OfferKind
from app.services.offers_provider import (
    AmadeusLodgingProvider,
    AmadeusTransportProvider,
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
async def test_amadeus_transport_search_normalizes_segments_and_summary(monkeypatch):
    provider = AmadeusTransportProvider()

    calls: list[tuple[str, str, dict | None]] = []

    async def _fake_authorized_request(*, method, path, params=None, json_body=None, retry_on_unauthorized=True):
        calls.append((method, path, params))
        assert method == "GET"

        if path == "/v1/reference-data/locations":
            keyword = params["keyword"]
            if keyword == "CDG":
                return httpx.Response(
                    200,
                    json={
                        "data": [
                            {
                                "name": "Paris Charles de Gaulle",
                                "iataCode": "CDG",
                                "geoCode": {"latitude": 49.0097, "longitude": 2.5479},
                            }
                        ]
                    },
                )
            assert keyword == "MAD"
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "name": "Adolfo Suarez Madrid-Barajas",
                            "iataCode": "MAD",
                            "geoCode": {"latitude": 40.4722, "longitude": -3.5609},
                        }
                    ]
                },
            )

        assert path == "/v2/shopping/flight-offers"
        assert params["originLocationCode"] == "CDG"
        assert params["destinationLocationCode"] == "MAD"
        assert params["currencyCode"] == "EUR"

        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "flight-1",
                        "numberOfBookableSeats": 3,
                        "validatingAirlineCodes": ["AF"],
                        "lastTicketingDateTime": "2026-04-05T18:00:00Z",
                        "itineraries": [
                            {
                                "duration": "PT2H10M",
                                "segments": [
                                    {
                                        "id": "seg-1",
                                        "carrierCode": "AF",
                                        "number": "1300",
                                        "duration": "PT2H10M",
                                        "departure": {
                                            "iataCode": "CDG",
                                            "at": "2026-04-10T07:00:00",
                                            "terminal": "2F",
                                        },
                                        "arrival": {
                                            "iataCode": "MAD",
                                            "at": "2026-04-10T09:10:00",
                                            "terminal": "4",
                                        },
                                        "operating": {"carrierCode": "AF"},
                                        "co2Emissions": [{"weight": "113", "weightUnit": "KG"}],
                                    }
                                ],
                            }
                        ],
                        "travelerPricings": [
                            {
                                "fareDetailsBySegment": [
                                    {
                                        "segmentId": "seg-1",
                                        "cabin": "ECONOMY",
                                        "fareBasis": "LIGHT",
                                        "brandedFare": "LIGHT",
                                        "includedCheckedBags": {"quantity": 1},
                                    }
                                ]
                            }
                        ],
                        "price": {
                            "grandTotal": "211.00",
                            "currency": "EUR",
                            "additionalServices": {
                                "chargeableCheckedBags": {"amount": "35.00", "currencyCode": "EUR"}
                            },
                        },
                    }
                ],
                "dictionaries": {"carriers": {"AF": "Air France"}},
            },
        )

    monkeypatch.setattr(provider, "_authorized_request", _fake_authorized_request)

    offers = await provider.search(
        {
            "origin_text": "CDG",
            "destination_text": "MAD",
            "depart_date": "2026-04-10",
            "return_date": None,
            "adults": 1,
            "currency": "EUR",
            "transport_modes": ["flight"],
            "constraints": {},
        }
    )

    assert len(offers) == 1
    offer = offers[0]
    assert offer["title"] == "Air France Flight 1300 (Nonstop)"
    assert offer["origin_text"] == "CDG"
    assert offer["destination_text"] == "MAD"
    assert offer["raw_payload_json"]["total_duration_min"] == 130
    assert offer["raw_payload_json"]["stops_count"] == 0
    assert offer["raw_payload_json"]["cabin"] == "Economy"
    assert offer["raw_payload_json"]["baggage_summary"] == "1 checked bag"
    assert offer["raw_payload_json"]["bookable_seats"] == 3
    assert str(offer["raw_payload_json"]["additional_baggage_price"]) == "35.00"
    assert str(offer["raw_payload_json"]["emissions_kg"]) == "113.00"
    assert offer["raw_payload_json"]["origin_geo"] == {"latitude": 49.0097, "longitude": 2.5479}
    assert offer["raw_payload_json"]["destination_geo"] == {"latitude": 40.4722, "longitude": -3.5609}
    assert offer["raw_payload_json"]["segments"][0]["departure"]["terminal"] == "2F"
    assert offer["raw_payload_json"]["segments"][0]["arrival"]["terminal"] == "4"
    assert [path for _, path, _ in calls] == [
        "/v1/reference-data/locations",
        "/v1/reference-data/locations",
        "/v2/shopping/flight-offers",
    ]


@pytest.mark.anyio
async def test_amadeus_lodging_search_normalizes_offers_and_place_payload(monkeypatch):
    provider = AmadeusLodgingProvider()

    calls: list[tuple[str, str, dict | None]] = []

    async def _fake_authorized_request(*, method, path, params=None, json_body=None, retry_on_unauthorized=True):
        calls.append((method, path, params))
        assert method == "GET"
        assert params is not None

        if path == "/v1/reference-data/locations/cities":
            return httpx.Response(
                200,
                json={"data": [{"name": "Paris", "iataCode": "PAR"}]},
            )
        if path == "/v1/reference-data/locations/hotels/by-city":
            assert params["cityCode"] == "PAR"
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "hotelId": "H1",
                            "name": "Central Hotel",
                            "chainCode": "CH",
                            "rating": 4,
                            "cityCode": "PAR",
                            "amenities": ["WIFI", "POOL"],
                            "geoCode": {"latitude": 48.8566, "longitude": 2.3522},
                            "address": {
                                "lines": ["1 Rue de Paris"],
                                "label": "1 Rue de Paris, 75001 Paris",
                            },
                        }
                    ]
                },
            )
        if path == "/v2/e-reputation/hotel-sentiments":
            assert params["hotelIds"] == "H1"
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "hotelId": "H1",
                            "overallRating": 86,
                            "sentiments": {"service": 88},
                        }
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
                                "self": "https://providers.example/hotel/A1",
                                "price": {
                                    "total": "210.00",
                                    "base": "180.00",
                                    "currency": "EUR",
                                    "taxes": [{"amount": "30.00"}],
                                    "variations": {"average": {"total": "105.00"}},
                                },
                                "room": {
                                    "typeEstimated": {"category": "DELUXE_ROOM"},
                                    "description": "Deluxe room",
                                },
                                "roomDescription": {"text": "King room with courtyard view"},
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
    offer = offers[0]
    assert offer["lodging_type"] == "hotel"
    assert offer["provider_offer_ref"] == "A1"
    assert offer["title"] == "Central Hotel"
    assert offer["place_payload"]["source"] == "amadeus_hotel"
    assert offer["place_payload"]["external_id"] == "H1"
    assert offer["place_payload"]["lat"] == 48.8566
    assert offer["place_payload"]["metadata"]["amenities"] == ["WIFI", "POOL"]
    assert offer["raw_payload_json"]["nightly_rate"] == "105.00"
    assert offer["raw_payload_json"]["taxes_amount"] == "30.00"
    assert offer["raw_payload_json"]["room_description"] == "King room with courtyard view"
    assert offer["raw_payload_json"]["rating"]["overallRating"] == 86
    assert [path for _, path, _ in calls] == [
        "/v1/reference-data/locations/cities",
        "/v1/reference-data/locations/hotels/by-city",
        "/v3/shopping/hotel-offers",
        "/v2/e-reputation/hotel-sentiments",
    ]


@pytest.mark.anyio
async def test_amadeus_lodging_search_tolerates_ratings_failures(monkeypatch):
    provider = AmadeusLodgingProvider()

    async def _fake_authorized_request(*, method, path, params=None, json_body=None, retry_on_unauthorized=True):
        assert method == "GET"
        if path == "/v1/reference-data/locations/cities":
            return httpx.Response(200, json={"data": [{"name": "Paris", "iataCode": "PAR"}]})
        if path == "/v1/reference-data/locations/hotels/by-city":
            return httpx.Response(
                200,
                json={"data": [{"hotelId": "H1", "name": "Central Hotel", "geoCode": {"latitude": 48.8566, "longitude": 2.3522}}]},
            )
        if path == "/v2/e-reputation/hotel-sentiments":
            return httpx.Response(500, json={"errors": [{"title": "temporary"}]})

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
    assert offers[0]["title"] == "Central Hotel"
    assert offers[0]["raw_payload_json"]["rating"] == {}


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
