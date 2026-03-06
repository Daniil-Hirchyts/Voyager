import time

from fastapi import Request
from redis.asyncio import Redis

from app.errors import TooManyRequestsError


def _window_key(prefix: str, identifier: str, scope: str, window_seconds: int) -> tuple[str, int]:
    current_window = int(time.time() // window_seconds)
    key = f"{prefix}:{identifier}:{scope}:{current_window}"
    return key, current_window


async def enforce_limit(
    redis: Redis | None,
    *,
    prefix: str,
    identifier: str,
    scope: str,
    limit: int,
    window_seconds: int = 60,
) -> None:
    if redis is None:
        return

    key, _ = _window_key(prefix, identifier, scope, window_seconds)
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, window_seconds + 1)

    if count > limit:
        raise TooManyRequestsError(
            "Rate limit exceeded",
            details={
                "scope": scope,
                "limit": limit,
                "window_seconds": window_seconds,
            },
        )


def get_client_ip(request: Request) -> str:
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


async def limit_ip_request(redis: Redis | None, request: Request, limit: int) -> None:
    ip = get_client_ip(request)
    await enforce_limit(redis, prefix="rl:ip", identifier=ip, scope=request.url.path, limit=limit)


async def limit_user_request(
    redis: Redis | None,
    user_id: str,
    scope: str,
    limit: int,
    *,
    window_seconds: int = 60,
) -> None:
    await enforce_limit(
        redis,
        prefix="rl:user",
        identifier=user_id,
        scope=scope,
        limit=limit,
        window_seconds=window_seconds,
    )
