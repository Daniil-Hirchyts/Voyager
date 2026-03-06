import uuid

from fastapi import APIRouter, Depends, Query
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.redis_helpers import build_cache_key, cache_get_json, cache_set_json
from app.config import get_settings
from app.db.repositories import JobRepository, job_to_response
from app.db.session import get_db_session, get_redis
from app.models.jobs import JobListResponse, JobResponse
from app.security.dependencies import AuthContext, get_auth_context

router = APIRouter(prefix="/jobs", tags=["jobs"])


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
