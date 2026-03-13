from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from app.config import get_settings
from app.errors import ServiceUnavailableError


@dataclass(frozen=True)
class KeycloakAdminTarget:
    base_url: str
    realm: str


def derive_keycloak_admin_target() -> KeycloakAdminTarget:
    settings = get_settings()
    issuer = urlparse(settings.keycloak_issuer)
    issuer_parts = [part for part in issuer.path.split("/") if part]
    if not issuer.scheme or not issuer.netloc or len(issuer_parts) < 2 or issuer_parts[-2] != "realms":
        raise ServiceUnavailableError(
            code="INTEGRATION_NOT_CONFIGURED",
            message="Keycloak profile sync is unavailable",
            details={
                "provider": "keycloak",
                "missing_env_vars": ["VOYAGER_KEYCLOAK_ISSUER"],
            },
        )

    base_url = f"{issuer.scheme}://{issuer.netloc}"
    realm = issuer_parts[-1]

    # The API container validates tokens against an external issuer (`localhost`) but must reach
    # Keycloak over the Docker network for admin writes.
    jwks = urlparse(settings.keycloak_jwks_url)
    if issuer.hostname in {"localhost", "127.0.0.1"} and jwks.scheme and jwks.netloc:
        base_url = f"{jwks.scheme}://{jwks.netloc}"

    return KeycloakAdminTarget(base_url=base_url, realm=realm)


def _keycloak_not_configured() -> ServiceUnavailableError:
    return ServiceUnavailableError(
        code="INTEGRATION_NOT_CONFIGURED",
        message="Keycloak profile sync is unavailable",
        details={
            "provider": "keycloak",
            "missing_env_vars": ["KEYCLOAK_ADMIN", "KEYCLOAK_ADMIN_PASSWORD"],
        },
    )


def _keycloak_sync_failed(exc: Exception, *, status_code: int | None = None) -> ServiceUnavailableError:
    details: dict[str, object] = {
        "provider": "keycloak",
        "error": exc.__class__.__name__,
    }
    if status_code is not None:
        details["status_code"] = status_code
    return ServiceUnavailableError(
        code="KEYCLOAK_PROFILE_SYNC_FAILED",
        message="Could not synchronize the profile with Keycloak",
        details=details,
    )


async def sync_keycloak_user_names(*, user_id: str, first_name: str, last_name: str) -> None:
    settings = get_settings()
    if not settings.keycloak_admin_user or not settings.keycloak_admin_password:
        raise _keycloak_not_configured()

    target = derive_keycloak_admin_target()

    try:
        async with httpx.AsyncClient(
            base_url=target.base_url,
            timeout=10,
            trust_env=False,
        ) as client:
            token_response = await client.post(
                "/realms/master/protocol/openid-connect/token",
                data={
                    "grant_type": "password",
                    "client_id": "admin-cli",
                    "username": settings.keycloak_admin_user,
                    "password": settings.keycloak_admin_password,
                },
            )
            token_response.raise_for_status()
            access_token = token_response.json()["access_token"]

            headers = {"Authorization": f"Bearer {access_token}"}
            user_response = await client.get(
                f"/admin/realms/{target.realm}/users/{user_id}",
                headers=headers,
            )
            user_response.raise_for_status()
            payload = user_response.json()
            payload["firstName"] = first_name
            payload["lastName"] = last_name

            update_response = await client.put(
                f"/admin/realms/{target.realm}/users/{user_id}",
                headers=headers,
                json=payload,
            )
            update_response.raise_for_status()
    except KeyError as exc:
        raise _keycloak_sync_failed(exc) from exc
    except httpx.HTTPStatusError as exc:
        raise _keycloak_sync_failed(exc, status_code=exc.response.status_code) from exc
    except httpx.HTTPError as exc:
        raise _keycloak_sync_failed(exc) from exc

