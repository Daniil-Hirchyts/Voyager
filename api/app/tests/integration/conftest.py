import os
import time
import uuid

import httpx
import pytest
import redis as redis_sync

API_BASE = os.getenv("API_BASE", "http://localhost:8000")
KEYCLOAK_BASE = os.getenv("KEYCLOAK_BASE", "http://localhost:8080")
REALM = os.getenv("REALM", "travel")
CLIENT_ID = os.getenv("CLIENT_ID", "voyager-api")
PASSWORD = os.getenv("PASSWORD", "voyager_pass")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
KEYCLOAK_ADMIN_USER = os.getenv("KEYCLOAK_ADMIN", "admin")
KEYCLOAK_ADMIN_PASSWORD = os.getenv("KEYCLOAK_ADMIN_PASSWORD", "admin")

os.environ.setdefault("VOYAGER_DB_DSN", "postgresql+asyncpg://voyager:voyager@localhost:5432/voyager")
os.environ.setdefault("VOYAGER_REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("VOYAGER_KEYCLOAK_ISSUER", "http://localhost:8080/realms/travel")
os.environ.setdefault("VOYAGER_KEYCLOAK_AUDIENCE", "voyager-api")
os.environ.setdefault(
    "VOYAGER_KEYCLOAK_JWKS_URL",
    "http://localhost:8080/realms/travel/protocol/openid-connect/certs",
)
os.environ.setdefault("VOYAGER_KEYCLOAK_CLIENT_ID", "voyager-api")


@pytest.fixture(scope="session")
def api_client() -> httpx.Client:
    client = httpx.Client(base_url=API_BASE, timeout=30, trust_env=False)

    deadline = time.time() + 180
    while True:
        try:
            response = client.get("/health/live")
            if response.status_code == 200:
                break
        except Exception:
            pass
        if time.time() > deadline:
            raise RuntimeError("API not ready")
        time.sleep(1)

    return client


@pytest.fixture(scope="session")
def keycloak_client() -> httpx.Client:
    return httpx.Client(base_url=KEYCLOAK_BASE, timeout=30, trust_env=False)


@pytest.fixture(scope="session")
def token_user1(keycloak_client: httpx.Client) -> str:
    return _get_token(keycloak_client, "voyager_user")


@pytest.fixture(scope="session")
def token_user2(keycloak_client: httpx.Client) -> str:
    return _get_token(keycloak_client, "voyager_user_2")


@pytest.fixture(scope="session")
def token_admin(keycloak_client: httpx.Client) -> str:
    _ensure_user_roles(keycloak_client, "voyager_user_2", {"user", "admin"})
    return _get_token(keycloak_client, "voyager_user_2")


@pytest.fixture()
def headers_user1(token_user1: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token_user1}"}


@pytest.fixture()
def headers_user2(token_user2: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token_user2}"}


@pytest.fixture()
def headers_admin(token_admin: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token_admin}"}


@pytest.fixture()
def unique_idempotency_key() -> str:
    return f"test-{uuid.uuid4()}"


@pytest.fixture(autouse=True)
def reset_redis_for_phase2_tests(request):
    has_phase2 = request.node.get_closest_marker("phase2") is not None
    has_phase3 = request.node.get_closest_marker("phase3") is not None
    has_phase5 = request.node.get_closest_marker("phase5") is not None
    has_phase6 = request.node.get_closest_marker("phase6") is not None
    if not has_phase2 and not has_phase3 and not has_phase5 and not has_phase6:
        yield
        return

    client = redis_sync.Redis.from_url(REDIS_URL, decode_responses=True)
    client.flushdb()
    try:
        yield
    finally:
        client.close()


def _get_token(client: httpx.Client, username: str) -> str:
    data = {
        "grant_type": "password",
        "client_id": CLIENT_ID,
        "username": username,
        "password": PASSWORD,
    }
    response = client.post(f"/realms/{REALM}/protocol/openid-connect/token", data=data)
    response.raise_for_status()
    payload = response.json()
    return payload["access_token"]


def _get_master_admin_token(client: httpx.Client) -> str:
    response = client.post(
        "/realms/master/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": KEYCLOAK_ADMIN_USER,
            "password": KEYCLOAK_ADMIN_PASSWORD,
        },
    )
    response.raise_for_status()
    return response.json()["access_token"]


def _ensure_user_roles(client: httpx.Client, username: str, role_names: set[str]) -> None:
    admin_token = _get_master_admin_token(client)
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    users_resp = client.get(
        f"/admin/realms/{REALM}/users",
        params={"username": username},
        headers=admin_headers,
    )
    users_resp.raise_for_status()
    users = users_resp.json()
    if not users:
        raise RuntimeError(f"Required Keycloak test user not found: {username}")
    user_id = users[0]["id"]

    mapped_roles_resp = client.get(
        f"/admin/realms/{REALM}/users/{user_id}/role-mappings/realm",
        headers=admin_headers,
    )
    mapped_roles_resp.raise_for_status()
    existing_role_names = {item["name"] for item in mapped_roles_resp.json()}
    missing_role_names = sorted(role_names - existing_role_names)
    if not missing_role_names:
        return

    role_payloads = []
    for role_name in missing_role_names:
        role_resp = client.get(
            f"/admin/realms/{REALM}/roles/{role_name}",
            headers=admin_headers,
        )
        role_resp.raise_for_status()
        role = role_resp.json()
        role_payloads.append({"id": role["id"], "name": role["name"]})

    mapping_resp = client.post(
        f"/admin/realms/{REALM}/users/{user_id}/role-mappings/realm",
        headers=admin_headers,
        json=role_payloads,
    )
    if mapping_resp.status_code not in (204, 200):
        mapping_resp.raise_for_status()
