import hashlib
import json
from typing import Any

from redis.asyncio import Redis

from app.config import get_settings
from app.errors import ConflictError, ValidationApiError


def build_cache_key(*parts: str) -> str:
    raw = ":".join(parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def cache_get_json(redis: Redis | None, key: str) -> Any | None:
    if redis is None:
        return None
    raw = await redis.get(key)
    if raw is None:
        return None
    return json.loads(raw)


async def cache_set_json(redis: Redis | None, key: str, value: Any, ttl_seconds: int) -> None:
    if redis is None:
        return
    await redis.set(key, json.dumps(value, default=str), ex=ttl_seconds)


async def cache_delete(redis: Redis | None, key: str) -> None:
    if redis is None:
        return
    await redis.delete(key)


async def cache_delete_prefix(redis: Redis | None, prefix: str) -> None:
    if redis is None:
        return

    keys: list[str] = []
    async for key in redis.scan_iter(match=f"{prefix}*"):
        keys.append(key)

    if keys:
        await redis.delete(*keys)


class IdempotencyService:
    def __init__(self, redis: Redis | None):
        self.redis = redis
        self.settings = get_settings()

    async def check_or_replay(
        self,
        *,
        user_id: str,
        method: str,
        path: str,
        idempotency_key: str | None,
        fingerprint: str,
    ) -> dict | None:
        if not self.settings.require_idempotency_keys:
            return None

        if not idempotency_key:
            raise ValidationApiError("Idempotency-Key header is required")

        if not self.redis:
            return None

        key = f"idem:{user_id}:{method}:{path}:{idempotency_key}"
        raw = await self.redis.get(key)
        if not raw:
            return None

        stored = json.loads(raw)
        if stored["fingerprint"] != fingerprint:
            raise ConflictError(
                code="IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
                message="Idempotency key reuse with different payload",
            )
        return stored

    async def store_response(
        self,
        *,
        user_id: str,
        method: str,
        path: str,
        idempotency_key: str,
        fingerprint: str,
        status_code: int,
        response_body: dict,
    ) -> None:
        if not self.redis:
            return
        key = f"idem:{user_id}:{method}:{path}:{idempotency_key}"
        payload = {
            "fingerprint": fingerprint,
            "status_code": status_code,
            "response_body": response_body,
        }
        await self.redis.set(
            key, json.dumps(payload, default=str), ex=self.settings.idempotency_ttl_sec
        )
