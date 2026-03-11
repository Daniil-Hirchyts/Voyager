from uuid import uuid4

import httpx
import pytest

from app.config import get_settings
from app.db.models import Place
from app.services import place_photos


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


def _place_fixture() -> Place:
    return Place(
        id=uuid4(),
        source="manual",
        name="Eiffel Tower",
        category="landmark",
        address_text="Paris, France",
        metadata_json={},
    )


def test_normalize_license_code_accepts_provider_variants():
    assert place_photos._normalize_license_code("by") == "cc-by"
    assert place_photos._normalize_license_code("by-sa") == "cc-by-sa"
    assert place_photos._normalize_license_code("CC BY-SA 3.0") == "cc-by-sa"
    assert place_photos._normalize_license_code("CC0 1.0") == "cc0"
    assert place_photos._normalize_license_code("CC BY-NC 4.0") is None


@pytest.mark.anyio
async def test_place_photo_fetch_prefers_google_place_photos(monkeypatch):
    place = Place(
        id=uuid4(),
        source="google_places",
        external_id="google-place-1",
        name="Eiffel Tower",
        category="tourist_attraction",
        address_text="Paris, France",
        metadata_json={"google_place_id": "google-place-1"},
    )

    async def _google(place_id: str, *, limit: int = 8):
        assert place_id == "google-place-1"
        assert limit == 8
        return [
            {
                "source": "google_places",
                "source_media_ref": "places/google-place-1/photos/photo-1",
                "image_url": "https://places.googleapis.com/v1/places/google-place-1/photos/photo-1/media?maxWidthPx=1600",
                "thumbnail_url": "https://places.googleapis.com/v1/places/google-place-1/photos/photo-1/media?maxWidthPx=480",
                "width": 1600,
                "height": 1200,
                "license_code": None,
                "license_url": None,
                "author_name": "Google Contributor",
                "author_url": "https://maps.google.com",
                "attribution_text": "Google Contributor",
                "raw_payload_json": {"name": "places/google-place-1/photos/photo-1"},
            }
        ]

    async def _unexpected(_place):
        raise AssertionError("Fallback providers should not run when Google photos are available")

    monkeypatch.setattr(place_photos, "google_maps_enabled", lambda: True)
    monkeypatch.setattr(place_photos, "fetch_google_place_photos", _google)
    monkeypatch.setattr(place_photos, "_fetch_wikipedia_candidates", _unexpected)
    monkeypatch.setattr(place_photos, "_fetch_wikidata_candidates", _unexpected)
    monkeypatch.setattr(place_photos, "_fetch_wikimedia_candidates", _unexpected)
    monkeypatch.setattr(place_photos, "_fetch_openverse_candidates", _unexpected)

    provider_name, photos, errors = await place_photos._fetch_place_photos(place)

    assert provider_name == "google_places"
    assert len(photos) == 1
    assert photos[0]["source_media_ref"] == "places/google-place-1/photos/photo-1"
    assert errors == []


@pytest.mark.anyio
async def test_fetch_wikimedia_filters_to_open_license(monkeypatch):
    place = _place_fixture()

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, path, params=None):
            assert path == "/w/api.php"
            return httpx.Response(
                200,
                json={
                    "query": {
                        "pages": {
                            "1": {
                                "pageid": 1,
                                "title": "File:Eiffel Tower.jpg",
                                "imageinfo": [
                                    {
                                        "url": "https://img.open/eiffel.jpg",
                                        "thumburl": "https://img.open/eiffel-thumb.jpg",
                                        "width": 1200,
                                        "height": 800,
                                        "extmetadata": {
                                            "LicenseShortName": {"value": "CC BY-SA"},
                                            "LicenseUrl": {
                                                "value": "https://license.example/by-sa"
                                            },
                                            "Artist": {"value": "Photographer"},
                                        },
                                    }
                                ],
                            },
                            "2": {
                                "pageid": 2,
                                "title": "File:Blocked.jpg",
                                "imageinfo": [
                                    {
                                        "url": "https://img.closed/blocked.jpg",
                                        "thumburl": "https://img.closed/blocked-thumb.jpg",
                                        "width": 1600,
                                        "height": 1000,
                                        "extmetadata": {
                                            "LicenseShortName": {"value": "All rights reserved"},
                                        },
                                    }
                                ],
                            },
                        }
                    }
                },
                request=httpx.Request("GET", "https://commons.wikimedia.org/w/api.php"),
            )

    monkeypatch.setattr(place_photos.httpx, "AsyncClient", _FakeClient)

    photos = await place_photos._fetch_wikimedia_candidates(place)

    assert len(photos) == 1
    assert photos[0]["source"] == "wikimedia_commons"
    assert photos[0]["image_url"] == "https://img.open/eiffel.jpg"
    assert photos[0]["license_code"] == "cc-by-sa"


@pytest.mark.anyio
async def test_fetch_wikidata_candidates_resolves_entity_images(monkeypatch):
    place = _place_fixture()

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            self.base_url = str(kwargs.get("base_url", ""))

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, path, params=None):
            request = httpx.Request("GET", f"{self.base_url}{path}")
            action = params.get("action") if params else None

            if "wikidata.org" in self.base_url and action == "wbsearchentities":
                return httpx.Response(
                    200,
                    json={"search": [{"id": "Q243"}]},
                    request=request,
                )

            if "wikidata.org" in self.base_url and action == "wbgetentities":
                return httpx.Response(
                    200,
                    json={
                        "entities": {
                            "Q243": {
                                "claims": {
                                    "P18": [
                                        {
                                            "mainsnak": {
                                                "datavalue": {
                                                    "value": "Eiffel Tower from below.jpg"
                                                }
                                            }
                                        }
                                    ]
                                }
                            }
                        }
                    },
                    request=request,
                )

            if "commons.wikimedia.org" in self.base_url and action == "query":
                return httpx.Response(
                    200,
                    json={
                        "query": {
                            "pages": {
                                "1": {
                                    "pageid": 1,
                                    "title": "File:Eiffel Tower from below.jpg",
                                    "imageinfo": [
                                        {
                                            "url": "https://img.open/eiffel-wikidata.jpg",
                                            "thumburl": "https://img.open/eiffel-wikidata-thumb.jpg",
                                            "width": 1400,
                                            "height": 1800,
                                            "extmetadata": {
                                                "LicenseShortName": {"value": "CC BY"},
                                                "LicenseUrl": {
                                                    "value": "https://license.example/by"
                                                },
                                                "Artist": {"value": "Commons Photographer"},
                                            },
                                        }
                                    ],
                                }
                            }
                        }
                    },
                    request=request,
                )

            raise AssertionError(
                f"Unexpected request: base={self.base_url} action={action} params={params}"
            )

    monkeypatch.setattr(place_photos.httpx, "AsyncClient", _FakeClient)

    photos = await place_photos._fetch_wikidata_candidates(place)

    assert len(photos) == 1
    assert photos[0]["source"] == "wikidata_commons"
    assert photos[0]["source_media_ref"] == "1"
    assert photos[0]["image_url"] == "https://img.open/eiffel-wikidata.jpg"
    assert photos[0]["license_code"] == "cc-by"


@pytest.mark.anyio
async def test_fetch_wikipedia_candidates_uses_page_lead_image(monkeypatch):
    place = _place_fixture()

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            self.base_url = str(kwargs.get("base_url", ""))

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, path, params=None):
            request = httpx.Request("GET", f"{self.base_url}{path}")
            action = params.get("action") if params else None

            if (
                "en.wikipedia.org" in self.base_url
                and action == "query"
                and params.get("prop") == "pageimages"
            ):
                return httpx.Response(
                    200,
                    json={
                        "query": {
                            "pages": {
                                "1": {
                                    "pageid": 1,
                                    "title": "Eiffel Tower",
                                    "pageimage": "Tour_Eiffel_Wikimedia_Commons.jpg",
                                }
                            }
                        }
                    },
                    request=request,
                )

            if "commons.wikimedia.org" in self.base_url and action == "query":
                return httpx.Response(
                    200,
                    json={
                        "query": {
                            "pages": {
                                "1": {
                                    "pageid": 1,
                                    "title": "File:Tour Eiffel Wikimedia Commons.jpg",
                                    "imageinfo": [
                                        {
                                            "url": "https://img.open/eiffel-lead.jpg",
                                            "thumburl": "https://img.open/eiffel-lead-thumb.jpg",
                                            "width": 1600,
                                            "height": 1000,
                                            "extmetadata": {
                                                "LicenseShortName": {"value": "CC BY-SA 4.0"},
                                                "LicenseUrl": {
                                                    "value": "https://license.example/by-sa"
                                                },
                                                "Artist": {"value": "Commons Photographer"},
                                            },
                                        }
                                    ],
                                }
                            }
                        }
                    },
                    request=request,
                )

            raise AssertionError(
                f"Unexpected request: base={self.base_url} action={action} params={params}"
            )

    monkeypatch.setattr(place_photos.httpx, "AsyncClient", _FakeClient)

    photos = await place_photos._fetch_wikipedia_candidates(place)

    assert len(photos) == 1
    assert photos[0]["source"] == "wikipedia_commons"
    assert photos[0]["image_url"] == "https://img.open/eiffel-lead.jpg"
    assert photos[0]["license_code"] == "cc-by-sa"


@pytest.mark.anyio
async def test_place_photo_fetch_falls_back_to_openverse(monkeypatch):
    place = _place_fixture()

    async def _no_wikipedia(_place):
        return []

    async def _no_wikidata(_place):
        return []

    async def _no_wikimedia(_place):
        return []

    async def _openverse(_place):
        return [
            {
                "source": "openverse",
                "source_media_ref": "ov-1",
                "image_url": "https://openverse.example/eiffel.jpg",
                "thumbnail_url": "https://openverse.example/eiffel-thumb.jpg",
                "width": 900,
                "height": 600,
                "license_code": "cc0",
                "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
                "author_name": "Openverse Author",
                "author_url": "https://example.com/author",
                "attribution_text": "Openverse Author",
                "raw_payload_json": {"id": "ov-1"},
            }
        ]

    monkeypatch.setattr(place_photos, "_fetch_wikipedia_candidates", _no_wikipedia)
    monkeypatch.setattr(place_photos, "_fetch_wikidata_candidates", _no_wikidata)
    monkeypatch.setattr(place_photos, "_fetch_wikimedia_candidates", _no_wikimedia)
    monkeypatch.setattr(place_photos, "_fetch_openverse_candidates", _openverse)

    provider_name, photos, errors = await place_photos._fetch_place_photos(place)

    assert provider_name == "openverse"
    assert len(photos) == 1
    assert photos[0]["license_code"] == "cc0"
    assert errors == []
