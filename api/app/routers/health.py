from secrets import compare_digest

from fastapi import APIRouter, Depends, Header
from fastapi.responses import PlainTextResponse
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.repositories import JobRepository
from app.db.session import get_db_session, get_redis
from app.errors import ForbiddenError, NotFoundError
from app.metrics import api_metrics

router = APIRouter(tags=["health"])


def _assert_metrics_access(x_metrics_token: str | None) -> None:
    settings = get_settings()
    if settings.public_metrics_enabled:
        return
    if settings.metrics_token and x_metrics_token and compare_digest(x_metrics_token, settings.metrics_token):
        return
    if not settings.is_production and settings.public_metrics_enabled_override is None:
        return
    if not settings.metrics_token:
        raise NotFoundError("Metrics endpoint is not enabled")
    raise ForbiddenError("Metrics access denied")


@router.get("/health/live")
async def live() -> dict:
    return {"status": "ok"}


@router.get("/health/ready")
async def ready(
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> dict:
    await db.execute(text("SELECT 1"))
    await redis.ping()
    return {"status": "ok"}


@router.get("/metrics", response_class=PlainTextResponse)
async def metrics(
    x_metrics_token: str | None = Header(default=None, alias="X-Metrics-Token"),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> PlainTextResponse:
    _assert_metrics_access(x_metrics_token)
    pending, running = await JobRepository.queue_depths(db)
    body = await api_metrics.render_prometheus(
        redis=redis,
        job_queue_pending=pending,
        job_queue_running=running,
    )
    return PlainTextResponse(body, media_type="text/plain; version=0.0.4")
