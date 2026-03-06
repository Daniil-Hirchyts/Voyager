import uuid

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import JSONResponse
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.redis_helpers import IdempotencyService, cache_delete_prefix
from app.config import get_settings
from app.db.repositories import ActivityRepository
from app.db.session import get_db_session, get_redis
from app.models.trips import (
    ActivityCreateRequest,
    ActivityListResponse,
    ActivityMoveRequest,
    ActivityPatchRequest,
    ActivityReorderRequest,
    ActivityResponse,
)
from app.rate_limit.limiter import limit_user_request
from app.routers.utils import parse_if_match, payload_fingerprint
from app.security.dependencies import AuthContext, get_auth_context

router = APIRouter(tags=["activities"])


def _activity_response(activity) -> ActivityResponse:
    return ActivityResponse(
        id=activity.id,
        trip_day_id=activity.trip_day_id,
        order_index=activity.order_index,
        title=activity.title,
        description=activity.description,
        start_time=activity.start_time,
        duration_min=activity.duration_min,
        tags=activity.tags_json,
        estimated_cost_amount=activity.estimated_cost_amount,
        estimated_cost_currency=activity.estimated_cost_currency,
        place_id=activity.place_id,
        event_snapshot_id=activity.event_snapshot_id,
        notes=activity.notes,
        is_favorite=activity.is_favorite,
        source=activity.source,
        created_at=activity.created_at,
        updated_at=activity.updated_at,
    )


@router.post("/days/{day_id}/activities", response_model=ActivityResponse, status_code=201)
async def create_activity(
    day_id: uuid.UUID,
    payload: ActivityCreateRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> ActivityResponse | JSONResponse:
    settings = get_settings()
    await limit_user_request(
        redis,
        str(auth.user_id),
        "activities:create",
        settings.rate_limit_activity_create_per_min,
    )

    idem = IdempotencyService(redis)
    fingerprint = payload_fingerprint(payload.model_dump(mode="json") | {"day_id": str(day_id)})
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path=f"/days/{day_id}/activities",
        idempotency_key=idempotency_key,
        fingerprint=fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    activity = await ActivityRepository.create_activity(db, auth.user_id, day_id, payload)
    response = _activity_response(activity)
    await cache_delete_prefix(redis, "trip:get:")
    await cache_delete_prefix(redis, "trip:list:")

    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path=f"/days/{day_id}/activities",
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            status_code=201,
            response_body=response.model_dump(mode="json"),
        )

    return response


@router.get("/days/{day_id}/activities", response_model=ActivityListResponse)
async def list_activities(
    day_id: uuid.UUID,
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
) -> ActivityListResponse:
    total, items = await ActivityRepository.list_day_activities(
        db,
        auth.user_id,
        day_id,
        limit=limit,
        offset=offset,
    )
    return ActivityListResponse(
        total=total,
        limit=limit,
        offset=offset,
        items=[_activity_response(item) for item in items],
    )


@router.patch("/activities/{activity_id}", response_model=ActivityResponse)
async def patch_activity(
    activity_id: uuid.UUID,
    payload: ActivityPatchRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> ActivityResponse:
    activity = await ActivityRepository.patch_activity(db, auth.user_id, activity_id, payload)
    await cache_delete_prefix(redis, "trip:get:")
    await cache_delete_prefix(redis, "trip:list:")
    return _activity_response(activity)


@router.delete("/activities/{activity_id}", status_code=204)
async def delete_activity(
    activity_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> None:
    await ActivityRepository.delete_activity(db, auth.user_id, activity_id)
    await cache_delete_prefix(redis, "trip:get:")
    await cache_delete_prefix(redis, "trip:list:")


@router.post("/days/{day_id}/activities/reorder", response_model=ActivityListResponse)
async def reorder_activities(
    day_id: uuid.UUID,
    payload: ActivityReorderRequest,
    if_match: str | None = Header(default=None, alias="If-Match"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> ActivityListResponse:
    expected_version = parse_if_match(if_match)
    activities = await ActivityRepository.reorder_day(
        db, auth.user_id, day_id, expected_version, payload
    )
    await cache_delete_prefix(redis, "trip:get:")
    await cache_delete_prefix(redis, "trip:list:")
    return ActivityListResponse(
        total=len(activities),
        limit=len(activities),
        offset=0,
        items=[_activity_response(item) for item in activities],
    )


@router.post("/activities/{activity_id}/move", response_model=ActivityResponse)
async def move_activity(
    activity_id: uuid.UUID,
    payload: ActivityMoveRequest,
    if_match: str | None = Header(default=None, alias="If-Match"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> ActivityResponse:
    expected_version = parse_if_match(if_match)
    activity = await ActivityRepository.move_activity(
        db,
        auth.user_id,
        activity_id,
        expected_version,
        payload,
    )
    await cache_delete_prefix(redis, "trip:get:")
    await cache_delete_prefix(redis, "trip:list:")
    return _activity_response(activity)
