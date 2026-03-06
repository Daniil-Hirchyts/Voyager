import uuid

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import JSONResponse
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.redis_helpers import (
    IdempotencyService,
    build_cache_key,
    cache_delete_prefix,
    cache_get_json,
    cache_set_json,
)
from app.config import get_settings
from app.db.repositories import JobRepository, ProposalRepository, TripRepository
from app.db.session import get_db_session, get_redis
from app.errors import ValidationApiError
from app.models.jobs import JobAcceptedResponse
from app.models.proposals import (
    ProposalApplyResponse,
    ProposalListResponse,
    ProposalResponse,
    TripOptimizeRequest,
)
from app.rate_limit.limiter import limit_user_request
from app.routers.utils import parse_if_match, payload_fingerprint
from app.security.dependencies import AuthContext, get_auth_context
from app.services.itinerary_optimizer import apply_proposal

router = APIRouter(tags=["proposals"])


def _job_accepted(job_id: uuid.UUID) -> JobAcceptedResponse:
    return JobAcceptedResponse(job_id=job_id, status="PENDING", poll_url=f"/jobs/{job_id}")


async def _assert_scope_days(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    trip_id: uuid.UUID,
    day_ids: list[uuid.UUID] | None,
) -> None:
    if day_ids is None:
        return
    if not day_ids:
        raise ValidationApiError("day_ids cannot be empty")
    trip_days = await TripRepository.list_days(db, user_id, trip_id)
    allowed = {day.id for day in trip_days}
    invalid = [str(day_id) for day_id in day_ids if day_id not in allowed]
    if invalid:
        raise ValidationApiError("One or more day_ids are not part of the trip", {"day_ids": invalid})


@router.post("/trips/{trip_id}/optimize", response_model=JobAcceptedResponse, status_code=202)
async def optimize_trip(
    trip_id: uuid.UUID,
    payload: TripOptimizeRequest,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> JobAcceptedResponse | JSONResponse:
    settings = get_settings()
    await limit_user_request(
        redis,
        str(auth.user_id),
        "optimize:submit",
        settings.rate_limit_optimize_submit_per_hour,
        window_seconds=3600,
    )

    await TripRepository.get_trip(db, auth.user_id, trip_id)
    await _assert_scope_days(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        day_ids=payload.day_ids,
    )

    fingerprint = payload_fingerprint(
        {"trip_id": str(trip_id), **payload.model_dump(mode="json")}
    )
    idem = IdempotencyService(redis)
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path=f"/trips/{trip_id}/optimize",
        idempotency_key=idempotency_key,
        fingerprint=fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    job = await JobRepository.create_job(
        db,
        auth.user_id,
        job_type="itinerary.optimize",
        payload={
            "trip_id": str(trip_id),
            "user_id": str(auth.user_id),
            "request": payload.model_dump(mode="json"),
            "trace_id": getattr(request.state, "trace_id", None),
        },
        max_attempts=settings.job_max_attempts,
    )
    response = _job_accepted(job.id)
    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path=f"/trips/{trip_id}/optimize",
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            status_code=202,
            response_body=response.model_dump(mode="json"),
        )
    return response


@router.get("/trips/{trip_id}/proposals", response_model=ProposalListResponse)
async def list_trip_proposals(
    trip_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> ProposalListResponse:
    cache_key = "proposal:list:" + build_cache_key(
        str(auth.user_id),
        str(trip_id),
        str(limit),
        str(offset),
    )
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return ProposalListResponse.model_validate(cached)

    total, items = await ProposalRepository.list_trip_proposals(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        limit=limit,
        offset=offset,
    )
    response = ProposalListResponse(
        total=total,
        limit=limit,
        offset=offset,
        items=[ProposalRepository.to_response(item) for item in items],
    )
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        get_settings().proposal_cache_ttl_sec,
    )
    return response


@router.get("/proposals/{proposal_id}", response_model=ProposalResponse)
async def get_proposal(
    proposal_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> ProposalResponse:
    cache_key = "proposal:get:" + build_cache_key(str(auth.user_id), str(proposal_id))
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return ProposalResponse.model_validate(cached)

    proposal = await ProposalRepository.get_proposal(
        db,
        user_id=auth.user_id,
        proposal_id=proposal_id,
    )
    response = ProposalRepository.to_response(proposal)
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        get_settings().proposal_cache_ttl_sec,
    )
    return response


@router.post("/proposals/{proposal_id}/apply", response_model=ProposalApplyResponse)
async def apply_trip_proposal(
    proposal_id: uuid.UUID,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    if_match: str | None = Header(default=None, alias="If-Match"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> ProposalApplyResponse | JSONResponse:
    expected_version = parse_if_match(if_match)
    fingerprint = payload_fingerprint(
        {"proposal_id": str(proposal_id), "expected_version": expected_version}
    )
    idem = IdempotencyService(redis)
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path=f"/proposals/{proposal_id}/apply",
        idempotency_key=idempotency_key,
        fingerprint=fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    trip, applied_day_ids = await apply_proposal(
        db,
        user_id=auth.user_id,
        proposal_id=proposal_id,
        expected_version=expected_version,
    )
    response = ProposalApplyResponse(
        proposal_id=proposal_id,
        trip_id=trip.id,
        status="APPLIED",
        version=trip.version,
        applied_day_ids=applied_day_ids,
    )
    await cache_delete_prefix(redis, "trip:get:")
    await cache_delete_prefix(redis, "trip:list:")
    await cache_delete_prefix(redis, "proposal:get:")
    await cache_delete_prefix(redis, "proposal:list:")
    await cache_delete_prefix(redis, "audit:list:")
    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path=f"/proposals/{proposal_id}/apply",
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            status_code=200,
            response_body=response.model_dump(mode="json"),
        )
    return response
