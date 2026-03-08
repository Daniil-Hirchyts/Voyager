import httpx
import pytest

from app.config import get_settings
from app.services import place_autocomplete


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
async def test_destination_autocomplete_normalizes_city_country_results(monkeypatch):
    settings = get_settings()

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            assert kwargs["headers"]["User-Agent"] == settings.media_user_agent

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params=None):
            assert url == settings.places_autocomplete_base_url
            assert ("q", "Moscow") in params
            return httpx.Response(
                200,
                json={
                    "features": [
                        {
                            "properties": {
                                "osm_type": "R",
                                "osm_id": 2555133,
                                "osm_key": "place",
                                "osm_value": "city",
                                "type": "city",
                                "name": "Moscow",
                                "state": "Moscow",
                                "country": "Russia",
                            },
                            "geometry": {"coordinates": [37.617698, 55.755864]},
                        },
                        {
                            "properties": {
                                "osm_type": "R",
                                "osm_id": 60189,
                                "osm_key": "place",
                                "osm_value": "country",
                                "type": "country",
                                "name": "Russia",
                                "country": "Russia",
                            },
                            "geometry": {"coordinates": [105.318756, 61.52401]},
                        },
                        {
                            "properties": {
                                "osm_type": "W",
                                "osm_id": 999,
                                "osm_key": "tourism",
                                "osm_value": "attraction",
                                "type": "house",
                                "name": "Random Landmark",
                                "country": "Russia",
                            },
                            "geometry": {"coordinates": [37.6, 55.7]},
                        },
                    ]
                },
                request=httpx.Request("GET", settings.places_autocomplete_base_url),
            )

    monkeypatch.setattr(place_autocomplete.httpx, "AsyncClient", _FakeClient)

    items = await place_autocomplete.search_destination_suggestions("Moscow", limit=5)

    assert [item.label for item in items] == ["Moscow, Russia"]
    assert items[0].lat == pytest.approx(55.755864)
    assert items[0].lon == pytest.approx(37.617698)


@pytest.mark.anyio
async def test_destination_autocomplete_keeps_city_results_with_non_city_osm_value(monkeypatch):
    settings = get_settings()

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params=None):
            assert ("layer", "city") in params
            assert ("layer", "country") in params
            assert ("layer", "locality") not in params
            return httpx.Response(
                200,
                json={
                    "features": [
                        {
                            "properties": {
                                "osm_type": "R",
                                "osm_id": 1543125,
                                "osm_key": "place",
                                "osm_value": "province",
                                "type": "city",
                                "name": "Tokyo",
                                "country": "Japan",
                            },
                            "geometry": {"coordinates": [139.69171, 35.6895]},
                        }
                    ]
                },
                request=httpx.Request("GET", settings.places_autocomplete_base_url),
            )

    monkeypatch.setattr(place_autocomplete.httpx, "AsyncClient", _FakeClient)

    items = await place_autocomplete.search_destination_suggestions("Tokyo", limit=5)

    assert [item.label for item in items] == ["Tokyo, Japan"]
    assert items[0].lat == pytest.approx(35.6895)
    assert items[0].lon == pytest.approx(139.69171)


@pytest.mark.anyio
async def test_destination_autocomplete_prefers_exact_city_names_over_prefix_matches(monkeypatch):
    settings = get_settings()

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params=None):
            return httpx.Response(
                200,
                json={
                    "features": [
                        {
                            "properties": {
                                "osm_type": "R",
                                "osm_id": 7444,
                                "osm_key": "place",
                                "osm_value": "city",
                                "type": "city",
                                "name": "Parisi",
                                "country": "Brazil",
                            },
                            "geometry": {"coordinates": [-46.0, -21.7]},
                        },
                        {
                            "properties": {
                                "osm_type": "R",
                                "osm_id": 71525,
                                "osm_key": "place",
                                "osm_value": "city",
                                "type": "city",
                                "name": "Paris",
                                "country": "France",
                            },
                            "geometry": {"coordinates": [2.3522, 48.8566]},
                        },
                        {
                            "properties": {
                                "osm_type": "R",
                                "osm_id": 123,
                                "osm_key": "place",
                                "osm_value": "town",
                                "type": "city",
                                "name": "Paris",
                                "country": "United States",
                            },
                            "geometry": {"coordinates": [-95.5555, 33.6609]},
                        },
                    ]
                },
                request=httpx.Request("GET", settings.places_autocomplete_base_url),
            )

    monkeypatch.setattr(place_autocomplete.httpx, "AsyncClient", _FakeClient)

    items = await place_autocomplete.search_destination_suggestions("Paris", limit=5)

    assert [item.label for item in items] == [
        "Paris, France",
        "Paris, United States",
        "Parisi, Brazil",
    ]


@pytest.mark.anyio
async def test_destination_autocomplete_returns_empty_on_timeout(monkeypatch):
    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params=None):
            raise httpx.TimeoutException("timed out")

    monkeypatch.setattr(place_autocomplete.httpx, "AsyncClient", _FakeClient)

    items = await place_autocomplete.search_destination_suggestions("Paris", limit=5)

    assert items == []
