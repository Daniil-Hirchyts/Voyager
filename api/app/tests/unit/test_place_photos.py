from uuid import uuid4

import httpx
import pytest

from app.config import get_settings
from app.db.models import Place
from app.services import place_photos


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


def _place_fixture() -> Place:
    return Place(
        id=uuid4(),
        source="manual",
        name="Eiffel Tower",
        category="landmark",
        address_text="Paris, France",
        metadata_json={},
    )


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
                                            "LicenseUrl": {"value": "https://license.example/by-sa"},
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
async def test_place_photo_fetch_falls_back_to_openverse(monkeypatch):
    place = _place_fixture()

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

    monkeypatch.setattr(place_photos, "_fetch_wikimedia_candidates", _no_wikimedia)
    monkeypatch.setattr(place_photos, "_fetch_openverse_candidates", _openverse)

    provider_name, photos, errors = await place_photos._fetch_place_photos(place)

    assert provider_name == "openverse"
    assert len(photos) == 1
    assert photos[0]["license_code"] == "cc0"
    assert errors == []
