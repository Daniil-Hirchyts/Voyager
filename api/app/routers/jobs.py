import asyncio
import json
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.redis_helpers import build_cache_key, cache_get_json, cache_set_json
from app.config import get_settings
from app.db.repositories import JobRepository, job_to_response
from app.db.session import get_db_session, get_redis
from app.models.jobs import JobListResponse, JobResponse
from app.security.dependencies import AuthContext, get_auth_context
from app.services.job_progress import PROGRESS_KEY_PREFIX

router = APIRouter(prefix="/jobs", tags=["jobs"])
SSE_POLL_INTERVAL_SEC = 0.5
SSE_IDLE_TIMEOUT_TICKS = 1200
SSE_HEARTBEAT_INTERVAL_TICKS = 30
SSE_IDLE_BACKOFF_SEC = 0.2


@router.get("", response_model=JobListResponse)
async def list_jobs(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
) -> JobListResponse:
    total, jobs = await JobRepository.list_jobs(db, auth.user_id, limit=limit, offset=offset)
    return JobListResponse(
        total=total,
        limit=limit,
        offset=offset,
        items=[job_to_response(item) for item in jobs],
    )


@router.get("/{job_id}/stream")
async def stream_job_progress(
    job_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> StreamingResponse:
    """SSE endpoint that streams job progress events from Redis."""
    await JobRepository.get_job(db, auth.user_id, job_id)

    key = f"{PROGRESS_KEY_PREFIX}{job_id}"

    async def generate() -> AsyncIterator[str]:
        cursor = 0
        idle_ticks = 0
        max_idle_ticks = SSE_IDLE_TIMEOUT_TICKS

        while idle_ticks < max_idle_ticks:
            events: list[str] = await redis.lrange(key, cursor, -1)

            if not events:
                idle_ticks += 1
                if idle_ticks % SSE_HEARTBEAT_INTERVAL_TICKS == 0:
                    yield ": heartbeat\n\n"
                await asyncio.sleep(SSE_POLL_INTERVAL_SEC)
                continue

            idle_ticks = 0
            for event_json in events:
                cursor += 1
                yield f"data: {event_json}\n\n"
                try:
                    event = json.loads(event_json)
                    if event.get("type") == "done":
                        return
                except json.JSONDecodeError:
                    pass

            await asyncio.sleep(SSE_IDLE_BACKOFF_SEC)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> JobResponse:
    cache_key = "job:get:" + build_cache_key(str(auth.user_id), str(job_id))
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return JobResponse.model_validate(cached)

    job = await JobRepository.get_job(db, auth.user_id, job_id)
    response = job_to_response(job)
    await cache_set_json(
        redis, cache_key, response.model_dump(mode="json"), get_settings().job_cache_ttl_sec
    )
    return response
