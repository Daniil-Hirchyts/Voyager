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
from app.db.repositories import EventRepository, JobRepository, TripRepository
from app.db.session import get_db_session, get_redis
from app.errors import ConflictError, ServiceUnavailableError, ValidationApiError
from app.models.events import (
    EventAttachDayRequest,
    EventListResponse,
    EventResponse,
    EventSearchRequest,
)
from app.models.jobs import JobAcceptedResponse
from app.models.trips import ActivityResponse
from app.rate_limit.limiter import limit_user_request
from app.routers.utils import parse_if_match, payload_fingerprint
from app.security.dependencies import AuthContext, get_auth_context
from app.services.events_provider import resolve_provider_availability, resolve_provider_order

router = APIRouter(tags=["events"])


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
        raise ValidationApiError(
            "One or more day_ids are not part of the trip", {"day_ids": invalid}
        )


@router.post("/events/search", response_model=JobAcceptedResponse, status_code=202)
async def search_events(
    payload: EventSearchRequest,
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
        "events:submit",
        settings.rate_limit_events_submit_per_hour,
        window_seconds=3600,
    )

    await TripRepository.get_trip(db, auth.user_id, payload.trip_id)
    await _assert_scope_days(
        db,
        user_id=auth.user_id,
        trip_id=payload.trip_id,
        day_ids=payload.day_ids,
    )
    if payload.trip_day_id is not None:
        await _assert_scope_days(
            db,
            user_id=auth.user_id,
            trip_id=payload.trip_id,
            day_ids=[payload.trip_day_id],
        )

    availability = resolve_provider_availability(payload.providers)
    if not availability.configured:
        missing_vars = sorted(
            {
                env_name
                for item in availability.unavailable
                for env_name in item.get("details", {}).get("missing_env_vars", [])
            }
        )
        raise ServiceUnavailableError(
            "INTEGRATION_NOT_CONFIGURED",
            "No configured event providers available",
            {
                "providers": resolve_provider_order(payload.providers),
                "missing_env_vars": missing_vars,
            },
        )

    fingerprint = payload_fingerprint(payload.model_dump(mode="json"))
    idem = IdempotencyService(redis)
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path="/events/search",
        idempotency_key=idempotency_key,
        fingerprint=fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    job = await JobRepository.create_job(
        db,
        auth.user_id,
        job_type="events.search",
        payload={
            "trip_id": str(payload.trip_id),
            "user_id": str(auth.user_id),
            "providers": payload.providers,
            "request_fingerprint": fingerprint,
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
            path="/events/search",
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            status_code=202,
            response_body=response.model_dump(mode="json"),
        )
    return response


@router.get("/trips/{trip_id}/events", response_model=EventListResponse)
async def list_trip_events(
    trip_id: uuid.UUID,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> EventListResponse:
    cache_key = "event:list:" + build_cache_key(str(auth.user_id), str(trip_id), str(limit), str(offset))
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return EventListResponse.model_validate(cached)

    total, items = await EventRepository.list_trip_events(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        limit=limit,
        offset=offset,
    )
    response = EventListResponse(
        total=total,
        limit=limit,
        offset=offset,
        items=[EventRepository.to_response(item) for item in items],
    )
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        get_settings().event_cache_ttl_sec,
    )
    return response


@router.get("/events/{event_id}", response_model=EventResponse)
async def get_event(
    event_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> EventResponse:
    cache_key = "event:get:" + build_cache_key(str(auth.user_id), str(event_id))
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return EventResponse.model_validate(cached)

    event = await EventRepository.get_event_for_user(db, user_id=auth.user_id, event_id=event_id)
    response = EventRepository.to_response(event)
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        get_settings().event_cache_ttl_sec,
    )
    return response


@router.post("/trips/{trip_id}/events/{event_id}/attach-day", response_model=ActivityResponse)
async def attach_event_to_day(
    trip_id: uuid.UUID,
    event_id: uuid.UUID,
    payload: EventAttachDayRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    if_match: str | None = Header(default=None, alias="If-Match"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> ActivityResponse | JSONResponse:
    expected_version = parse_if_match(if_match)
    trip = await TripRepository.get_trip(db, auth.user_id, trip_id)
    if trip.version != expected_version:
        raise ConflictError(
            code="CONFLICT_VERSION_MISMATCH",
            message="Trip version mismatch",
            details={"latest_version": trip.version},
        )

    fingerprint = payload_fingerprint(
        {
            "trip_id": str(trip_id),
            "event_id": str(event_id),
            "trip_day_id": str(payload.trip_day_id),
            "expected_version": expected_version,
        }
    )
    idem = IdempotencyService(redis)
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path=f"/trips/{trip_id}/events/{event_id}/attach-day",
        idempotency_key=idempotency_key,
        fingerprint=fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    activity = await EventRepository.attach_event_to_day(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        event_id=event_id,
        trip_day_id=payload.trip_day_id,
    )
    response = _activity_response(activity)
    await cache_delete_prefix(redis, "trip:get:")
    await cache_delete_prefix(redis, "trip:list:")
    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path=f"/trips/{trip_id}/events/{event_id}/attach-day",
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            status_code=200,
            response_body=response.model_dump(mode="json"),
        )
    return response
