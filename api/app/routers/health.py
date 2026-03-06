from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.repositories import JobRepository
from app.db.session import get_db_session, get_redis
from app.metrics import api_metrics

router = APIRouter(tags=["health"])


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
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> PlainTextResponse:
    pending, running = await JobRepository.queue_depths(db)
    body = await api_metrics.render_prometheus(
        redis=redis,
        job_queue_pending=pending,
        job_queue_running=running,
    )
    return PlainTextResponse(body, media_type="text/plain; version=0.0.4")
