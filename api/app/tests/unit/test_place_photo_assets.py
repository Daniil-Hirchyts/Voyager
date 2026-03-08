from uuid import uuid4

import httpx
import pytest

from app.config import get_settings
from app.db.models import PlacePhoto
from app.services import place_photo_assets


@pytest.fixture(autouse=True)
def _base_settings_env(monkeypatch, tmp_path):
    monkeypatch.setenv("VOYAGER_DB_DSN", "postgresql+asyncpg://voyager:voyager@localhost:5432/voyager")
    monkeypatch.setenv("VOYAGER_REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setenv("VOYAGER_KEYCLOAK_ISSUER", "http://localhost:8080/realms/travel")
    monkeypatch.setenv("VOYAGER_KEYCLOAK_AUDIENCE", "voyager-api")
    monkeypatch.setenv(
        "VOYAGER_KEYCLOAK_JWKS_URL",
        "http://localhost:8080/realms/travel/protocol/openid-connect/certs",
    )
    monkeypatch.setenv("VOYAGER_KEYCLOAK_CLIENT_ID", "voyager-api")
    monkeypatch.setenv("VOYAGER_MEDIA_CACHE_DIR", str(tmp_path))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _photo_fixture() -> PlacePhoto:
    return PlacePhoto(
        id=uuid4(),
        place_id=uuid4(),
        source="wikidata_commons",
        source_media_ref="photo-1",
        image_url="https://images.example.com/eiffel.jpg",
        thumbnail_url="https://images.example.com/eiffel-thumb.jpg",
        width=1400,
        height=900,
        license_code="cc-by",
        license_url="https://creativecommons.org/licenses/by/4.0/",
        author_name="Photographer",
        author_url=None,
        attribution_text="Photographer / CC BY 4.0",
        rank=0,
        is_primary=True,
        raw_payload_json={},
    )


@pytest.mark.anyio
async def test_ensure_place_photo_asset_caches_thumbnail(monkeypatch):
    photo = _photo_fixture()
    requested_urls: list[str] = []

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url):
            requested_urls.append(url)
            return httpx.Response(
                200,
                content=b"fake-image-bytes",
                headers={"content-type": "image/jpeg"},
                request=httpx.Request("GET", url),
            )

    monkeypatch.setattr(place_photo_assets.httpx, "AsyncClient", _FakeClient)

    first_path = await place_photo_assets.ensure_place_photo_asset(photo, variant="thumb")
    second_path = await place_photo_assets.ensure_place_photo_asset(photo, variant="thumb")

    assert first_path == second_path
    assert first_path.exists()
    assert first_path.read_bytes() == b"fake-image-bytes"
    assert requested_urls == ["https://images.example.com/eiffel-thumb.jpg"]
    assert first_path.name == "thumb.jpg"
