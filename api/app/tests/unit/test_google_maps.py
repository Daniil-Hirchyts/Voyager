import pytest

from app.config import get_settings
from app.services import google_maps


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


@pytest.mark.anyio
async def test_fetch_google_place_detail_normalizes_live_payload(monkeypatch):
    async def _payload(place_id: str, *, field_mask: str):
        assert place_id == "google-place-1"
        assert "editorialSummary" in field_mask
        return {
            "id": "google-place-1",
            "displayName": {"text": "Grand Palais"},
            "formattedAddress": "3 Av. du Général Eisenhower, Paris",
            "location": {"latitude": 48.8661, "longitude": 2.3125},
            "primaryType": "tourist_attraction",
            "types": ["tourist_attraction", "museum"],
            "addressComponents": [
                {"longText": "France", "types": ["country"]},
                {"longText": "Paris", "types": ["locality"]},
            ],
            "googleMapsUri": "https://maps.google.com/?cid=grand-palais",
            "websiteUri": "https://www.grandpalais.fr",
            "businessStatus": "OPERATIONAL",
            "editorialSummary": {"text": "A monumental exhibition hall in central Paris."},
            "rating": 4.8,
            "userRatingCount": 1204,
            "priceLevel": "PRICE_LEVEL_MODERATE",
            "currentOpeningHours": {"openNow": True},
            "regularOpeningHours": {
                "weekdayDescriptions": [
                    "Monday: 10:00 AM - 8:00 PM",
                    "Tuesday: 10:00 AM - 8:00 PM",
                ]
            },
            "reviews": [
                {
                    "name": "places/google-place-1/reviews/review-1",
                    "rating": 5,
                    "publishTime": "2026-03-01T08:00:00Z",
                    "text": {"text": "Impressive exhibitions and architecture."},
                    "authorAttribution": {"displayName": "Voyager Guide"},
                }
            ],
            "photos": [
                {
                    "name": "places/google-place-1/photos/photo-1",
                    "widthPx": 1600,
                    "heightPx": 1200,
                    "authorAttributions": [{"displayName": "Google Contributor"}],
                }
            ],
        }

    async def _timezone(*, lat: float, lng: float):
        assert lat == 48.8661
        assert lng == 2.3125
        return "Europe/Paris"

    monkeypatch.setattr(google_maps, "_google_place_payload", _payload)
    monkeypatch.setattr(google_maps, "resolve_time_zone", _timezone)

    detail = await google_maps.fetch_google_place_detail("google-place-1")

    assert detail is not None
    assert detail.place.place_id == "google-place-1"
    assert detail.place.name == "Grand Palais"
    assert detail.place.timezone == "Europe/Paris"
    assert detail.summary == "A monumental exhibition hall in central Paris."
    assert detail.rating == 4.8
    assert detail.review_count == 1204
    assert detail.status_text == "Open now"
    assert detail.price_label == "$$"
    assert detail.photos[0]["image_url"].startswith("/places/google-photo-asset?")
    assert "max_width_px=1600" in detail.photos[0]["image_url"]
    assert "name=places%2Fgoogle-place-1%2Fphotos%2Fphoto-1" in detail.photos[0]["image_url"]
    assert detail.reviews[0]["reviewer_name"] == "Voyager Guide"
    assert detail.hours[0]["day"] == "Monday"
    assert {item["label"] for item in detail.booking_links} == {"Google Maps", "Website"}
    assert "Tourist Attraction" in detail.tags
    assert "Museum" in detail.tags


@pytest.mark.anyio
async def test_fetch_google_place_detail_handles_sparse_payload(monkeypatch):
    async def _payload(place_id: str, *, field_mask: str):
        assert place_id == "google-place-2"
        assert "reviews" in field_mask
        return {
            "id": "google-place-2",
            "displayName": {"text": "Quiet Landmark"},
            "formattedAddress": "Rome, Italy",
            "location": {"latitude": 41.9, "longitude": 12.5},
            "primaryType": "point_of_interest",
            "types": ["point_of_interest"],
            "addressComponents": [
                {"longText": "Italy", "types": ["country"]},
                {"longText": "Rome", "types": ["locality"]},
            ],
            "businessStatus": "CLOSED_TEMPORARILY",
        }

    async def _timezone(*, lat: float, lng: float):
        assert lat == 41.9
        assert lng == 12.5
        return "Europe/Rome"

    monkeypatch.setattr(google_maps, "_google_place_payload", _payload)
    monkeypatch.setattr(google_maps, "resolve_time_zone", _timezone)

    detail = await google_maps.fetch_google_place_detail("google-place-2")

    assert detail is not None
    assert detail.place.place_id == "google-place-2"
    assert detail.place.timezone == "Europe/Rome"
    assert detail.summary is None
    assert detail.rating is None
    assert detail.review_count is None
    assert detail.status_text == "Closed Temporarily"
    assert detail.price_label is None
    assert detail.photos == []
    assert detail.reviews == []
    assert detail.hours == []
    assert detail.booking_links == []
    assert detail.mentions == []
    assert detail.tags == ["Point Of Interest"]
