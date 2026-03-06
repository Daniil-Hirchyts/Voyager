import json
import logging
import time
from dataclasses import dataclass

import httpx
import jwt
from jwt import InvalidTokenError
from jwt.algorithms import RSAAlgorithm

from app.config import get_settings
from app.errors import UnauthorizedError

logger = logging.getLogger(__name__)


@dataclass
class TokenPrincipal:
    sub: str
    roles: list[str]
    claims: dict


class JWKSCache:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._keys: dict[str, str] = {}
        self._expires_at: float = 0

    async def _refresh(self) -> None:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(self.settings.keycloak_jwks_url)
            response.raise_for_status()
            payload = response.json()

        keys: dict[str, str] = {}
        for item in payload.get("keys", []):
            kid = item.get("kid")
            if not kid:
                continue
            keys[kid] = RSAAlgorithm.from_jwk(json.dumps(item))

        self._keys = keys
        self._expires_at = time.time() + self.settings.jwks_cache_ttl_sec

    async def get_key(self, kid: str) -> str:
        now = time.time()
        if now >= self._expires_at or kid not in self._keys:
            await self._refresh()
        if kid not in self._keys:
            await self._refresh()
        key = self._keys.get(kid)
        if not key:
            raise UnauthorizedError("Unable to resolve signing key", {"kid": kid})
        return key


jwks_cache = JWKSCache()


async def validate_jwt_token(token: str) -> TokenPrincipal:
    settings = get_settings()

    try:
        header = jwt.get_unverified_header(token)
    except InvalidTokenError as exc:
        raise UnauthorizedError("Malformed token") from exc

    kid = header.get("kid")
    if not kid:
        raise UnauthorizedError("Token missing kid")

    key = await jwks_cache.get_key(kid)

    try:
        claims = jwt.decode(
            token,
            key=key,
            algorithms=["RS256"],
            issuer=settings.keycloak_issuer,
            options={"require": ["exp", "sub", "iss"], "verify_aud": False},
        )
    except InvalidTokenError as exc:
        logger.warning("token_validation_failed", extra={"trace_id": "-", "error": str(exc)})
        raise UnauthorizedError("Invalid token") from exc

    aud = claims.get("aud")
    azp = claims.get("azp")
    audience_ok = False
    if isinstance(aud, str):
        audience_ok = aud == settings.keycloak_audience
    elif isinstance(aud, list):
        audience_ok = settings.keycloak_audience in aud
    if not audience_ok:
        audience_ok = azp == settings.keycloak_audience
    if not audience_ok:
        raise UnauthorizedError("Invalid token audience")

    roles = claims.get("realm_access", {}).get("roles", [])
    return TokenPrincipal(sub=claims["sub"], roles=roles, claims=claims)
