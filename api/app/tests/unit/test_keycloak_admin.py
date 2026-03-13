import httpx
import pytest

from app.config import get_settings
from app.errors import ServiceUnavailableError
from app.services import keycloak_admin


@pytest.fixture(autouse=True)
def _base_keycloak_settings(monkeypatch):
    monkeypatch.setenv(
        "VOYAGER_DB_DSN", "postgresql+asyncpg://voyager:voyager@localhost:5432/voyager"
    )
    monkeypatch.setenv("VOYAGER_REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setenv("VOYAGER_KEYCLOAK_ISSUER", "http://localhost:8080/realms/travel")
    monkeypatch.setenv("VOYAGER_KEYCLOAK_AUDIENCE", "voyager-api")
    monkeypatch.setenv(
        "VOYAGER_KEYCLOAK_JWKS_URL",
        "http://keycloak:8080/realms/travel/protocol/openid-connect/certs",
    )
    monkeypatch.setenv("VOYAGER_KEYCLOAK_CLIENT_ID", "voyager-api")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_derive_keycloak_admin_target_prefers_internal_jwks_host():
    target = keycloak_admin.derive_keycloak_admin_target()

    assert target.realm == "travel"
    assert target.base_url == "http://keycloak:8080"


@pytest.mark.asyncio
async def test_sync_keycloak_user_names_updates_user(monkeypatch):
    monkeypatch.setenv("KEYCLOAK_ADMIN", "admin")
    monkeypatch.setenv("KEYCLOAK_ADMIN_PASSWORD", "admin")
    get_settings.cache_clear()

    calls: list[tuple[str, str, object | None]] = []

    class _FakeAsyncClient:
        def __init__(self, *, base_url: str, timeout: int, trust_env: bool):
            assert base_url == "http://keycloak:8080"
            assert timeout == 10
            assert trust_env is False

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url: str, data: dict[str, str]):
            calls.append(("POST", url, data))
            return httpx.Response(
                200,
                json={"access_token": "admin-token"},
                request=httpx.Request("POST", f"http://keycloak:8080{url}"),
            )

        async def get(self, url: str, headers: dict[str, str]):
            calls.append(("GET", url, headers))
            return httpx.Response(
                200,
                json={"id": "user-123", "username": "voyager_user", "firstName": "Voyager", "lastName": "User"},
                request=httpx.Request("GET", f"http://keycloak:8080{url}"),
            )

        async def put(self, url: str, headers: dict[str, str], json: dict[str, str]):
            calls.append(("PUT", url, json))
            return httpx.Response(
                204,
                request=httpx.Request("PUT", f"http://keycloak:8080{url}"),
            )

    monkeypatch.setattr(keycloak_admin.httpx, "AsyncClient", _FakeAsyncClient)

    await keycloak_admin.sync_keycloak_user_names(
        user_id="user-123",
        first_name="Captain",
        last_name="Atlas",
    )

    assert calls == [
        (
            "POST",
            "/realms/master/protocol/openid-connect/token",
            {
                "grant_type": "password",
                "client_id": "admin-cli",
                "username": "admin",
                "password": "admin",
            },
        ),
        (
            "GET",
            "/admin/realms/travel/users/user-123",
            {"Authorization": "Bearer admin-token"},
        ),
        (
            "PUT",
            "/admin/realms/travel/users/user-123",
            {
                "id": "user-123",
                "username": "voyager_user",
                "firstName": "Captain",
                "lastName": "Atlas",
            },
        ),
    ]


@pytest.mark.asyncio
async def test_sync_keycloak_user_names_requires_admin_credentials(monkeypatch):
    monkeypatch.delenv("KEYCLOAK_ADMIN", raising=False)
    monkeypatch.delenv("KEYCLOAK_ADMIN_PASSWORD", raising=False)
    get_settings.cache_clear()

    with pytest.raises(ServiceUnavailableError) as exc_info:
        await keycloak_admin.sync_keycloak_user_names(
            user_id="user-123",
            first_name="Captain",
            last_name="Atlas",
        )

    assert exc_info.value.code == "INTEGRATION_NOT_CONFIGURED"
