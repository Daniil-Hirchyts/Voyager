import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import JSONResponse
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.cache.redis_helpers import (
    IdempotencyService,
    build_cache_key,
    cache_delete_prefix,
    cache_get_json,
    cache_set_json,
)
from app.config import get_settings
from app.db.models import EventSnapshot
from app.db.repositories import ActivityRepository, EventRepository, PlaceRepository, TripRepository
from app.db.session import get_db_session, get_redis
from app.errors import (
    ConflictError,
    ServiceUnavailableError,
    TooManyRequestsError,
    ValidationApiError,
)
from app.models.activity_discovery import (
    ActivityAttachDayRequest,
    ActivityDiscoveryDetail,
    ActivityDiscoveryItem,
    ActivityDiscoveryListResponse,
    ActivityEntityType,
    ActivityRecommendationRequest,
    ActivityRecommendationResponse,
    ActivityShortlistListResponse,
    ActivityShortlistSaveRequest,
)
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
from app.services.activity_discovery_provider import (
    ActivityProviderLimitedError,
    ActivityProviderNonRetryableError,
    ActivityProviderRetryableError,
    TripAdvisorActivityProvider,
    normalize_provider_item,
    resolve_activity_provider_availability,
)
from app.services.activity_recommendations import recommend_shortlist_items

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


def _coerce_decimal(value: str | None):
    from decimal import Decimal, InvalidOperation

    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _raise_if_provider_unavailable() -> None:
    availability = resolve_activity_provider_availability()
    if availability.configured:
        return
    raise ServiceUnavailableError(
        "INTEGRATION_NOT_CONFIGURED",
        "TripAdvisor activities are unavailable",
        {"missing_env_vars": availability.missing_env_vars, "providers": ["tripadvisor"]},
    )


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


def _provider_errors_to_api(exc: Exception) -> None:
    if isinstance(exc, ActivityProviderLimitedError):
        raise TooManyRequestsError(exc.message, exc.details)
    if isinstance(exc, ActivityProviderRetryableError):
        raise ServiceUnavailableError(exc.code, exc.message, exc.details)
    if isinstance(exc, ActivityProviderNonRetryableError):
        raise ValidationApiError(exc.message, exc.details)
    raise exc


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


@router.get("/trips/{trip_id}/activities/discover", response_model=ActivityDiscoveryListResponse)
async def discover_activities(
    trip_id: uuid.UUID,
    entity_type: ActivityEntityType = Query(default=ActivityEntityType.ATTRACTION),
    query: str | None = Query(default=None),
    page: int = Query(default=1, ge=1, le=20),
    limit: int = Query(default=12, ge=1, le=30),
    locale: str = Query(default="en-US"),
    currency: str | None = Query(default=None),
    min_rating: int | None = Query(default=None, ge=1, le=5),
    good_for: str | None = Query(default=None),
    establishment_type: str | None = Query(default=None),
    meal_type: str | None = Query(default=None),
    departure_date: str | None = Query(default=None),
    cruise_length: str | None = Query(default=None),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> ActivityDiscoveryListResponse:
    settings = get_settings()
    await limit_user_request(
        redis,
        str(auth.user_id),
        "activities:discover",
        settings.rate_limit_activities_discover_per_hour,
        window_seconds=3600,
    )

    _raise_if_provider_unavailable()
    trip = await TripRepository.get_trip(db, auth.user_id, trip_id)
    provider = TripAdvisorActivityProvider()
    search_query = (query or trip.destination_text or "").strip()

    try:
        total, items, _payload = await provider.discover(
            entity_type=entity_type,
            query=search_query,
            page=page,
            locale=locale,
            currency=currency or trip.budget_currency or "USD",
            trip_dates=(trip.start_date.isoformat(), trip.end_date.isoformat()),
            min_rating=min_rating,
            good_for=good_for,
            establishment_type=establishment_type,
            meal_type=meal_type,
            departure_date=departure_date,
            cruise_length=cruise_length,
        )
    except Exception as exc:  # pragma: no cover - routed through deterministic helper
        _provider_errors_to_api(exc)

    refs = [item["provider_ref"] for item in items if item.get("provider_ref")]
    existing_by_ref: dict[str, EventSnapshot] = {}
    if refs:
        rows = await db.execute(
            select(EventSnapshot)
            .where(EventSnapshot.trip_id == trip_id)
            .where(EventSnapshot.provider == "tripadvisor")
            .where(EventSnapshot.provider_event_ref.in_(refs))
        )
        existing_by_ref = {row.provider_event_ref: row for row in rows.scalars().all()}

    normalized_items: list[ActivityDiscoveryItem] = []
    for item in items[:limit]:
        existing = existing_by_ref.get(item["provider_ref"])
        if existing is not None:
            item["snapshot_id"] = existing.id
            item["id"] = str(existing.id)
            item["trip_id"] = existing.trip_id
            item["trip_day_id"] = existing.trip_day_id
            item["place_id"] = existing.place_id
            item["created_at"] = existing.created_at
            item["updated_at"] = existing.updated_at
        normalized_items.append(ActivityDiscoveryItem.model_validate(item))

    return ActivityDiscoveryListResponse(
        total=total,
        limit=limit,
        offset=(page - 1) * limit,
        page=page,
        entity_type=entity_type,
        items=normalized_items,
    )


@router.post("/trips/{trip_id}/activities/save", response_model=ActivityDiscoveryItem, status_code=201)
async def save_activity_to_shortlist(
    trip_id: uuid.UUID,
    payload: ActivityShortlistSaveRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> ActivityDiscoveryItem | JSONResponse:
    await TripRepository.get_trip(db, auth.user_id, trip_id)
    idem = IdempotencyService(redis)
    fingerprint = payload_fingerprint({"trip_id": str(trip_id), **payload.model_dump(mode="json")})
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path=f"/trips/{trip_id}/activities/save",
        idempotency_key=idempotency_key,
        fingerprint=fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    place_id = None
    if payload.lat is not None or payload.lon is not None or payload.address_text:
        place = await PlaceRepository.get_or_create_external_place(
            db,
            source=f"tripadvisor_{payload.entity_type.value}",
            external_id=payload.provider_ref,
            name=payload.title,
            category=payload.entity_type.value,
            address_text=payload.address_text,
            lat=payload.lat,
            lon=payload.lon,
            metadata={"provider": payload.provider, "detail_url": payload.detail_url},
        )
        place_id = place.id

    snapshot = await EventRepository.create_snapshot(
        db,
        trip_id=trip_id,
        trip_day_id=None,
        provider=payload.provider,
        entity_type=payload.entity_type.value,
        provider_event_ref=payload.provider_ref,
        title=payload.title,
        summary=payload.summary,
        start_at=payload.start_at,
        end_at=payload.end_at,
        timezone=payload.timezone,
        venue_name=payload.title,
        venue_address=payload.address_text,
        rating=payload.rating,
        review_count=payload.review_count,
        price_label=payload.price_label,
        place_id=place_id,
        segment=payload.tags[0] if payload.tags else None,
        genre=payload.tags[1] if len(payload.tags) > 1 else None,
        tags_json=payload.tags,
        status_text=payload.status_text,
        min_price=_coerce_decimal(payload.min_price),
        max_price=_coerce_decimal(payload.max_price),
        currency=payload.currency,
        image_url=payload.image_url,
        deep_link=payload.detail_url,
        sales_status=payload.status_text,
        request_fingerprint=fingerprint,
        raw_payload_json=payload.raw_payload,
        provider_detail_json={"provider_payload": payload.raw_payload},
        expires_at=datetime.now(UTC) + timedelta(hours=24),
    )
    response = EventRepository.to_discovery_item(snapshot)
    await cache_delete_prefix(redis, "activity:shortlist:")

    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path=f"/trips/{trip_id}/activities/save",
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            status_code=201,
            response_body=response.model_dump(mode="json"),
        )
    return response


@router.get("/trips/{trip_id}/activities", response_model=ActivityShortlistListResponse)
async def list_saved_activities(
    trip_id: uuid.UUID,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> ActivityShortlistListResponse:
    cache_key = "activity:shortlist:list:" + build_cache_key(
        str(auth.user_id), str(trip_id), str(limit), str(offset)
    )
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return ActivityShortlistListResponse.model_validate(cached)

    total, items = await EventRepository.list_trip_saved_activities(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        limit=limit,
        offset=offset,
    )
    response = ActivityShortlistListResponse(
        total=total,
        limit=limit,
        offset=offset,
        items=[EventRepository.to_discovery_item(item) for item in items],
    )
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        get_settings().activity_cache_ttl_sec,
    )
    return response


@router.get("/activities/{snapshot_id}", response_model=ActivityDiscoveryDetail)
async def get_saved_activity_detail(
    snapshot_id: uuid.UUID,
    locale: str = Query(default="en-US"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> ActivityDiscoveryDetail:
    cache_key = "activity:shortlist:get:" + build_cache_key(str(auth.user_id), str(snapshot_id), locale)
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return ActivityDiscoveryDetail.model_validate(cached)

    snapshot = await EventRepository.get_snapshot_for_user(
        db,
        user_id=auth.user_id,
        snapshot_id=snapshot_id,
    )
    if snapshot.provider == "tripadvisor":
        _raise_if_provider_unavailable()
        provider = TripAdvisorActivityProvider()
        try:
            detail_bundle = await provider.detail_bundle(
                entity_type=ActivityEntityType(snapshot.entity_type or "attraction"),
                query=snapshot.provider_event_ref,
                locale=locale,
            )
            snapshot.provider_detail_json = detail_bundle | {
                "provider_payload": detail_bundle.get("detail_payload") or {}
            }
            await db.flush()
        except Exception as exc:  # pragma: no cover - routed through deterministic helper
            _provider_errors_to_api(exc)

    response = EventRepository.to_discovery_detail(snapshot)
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        get_settings().activity_cache_ttl_sec,
    )
    return response


@router.post("/trips/{trip_id}/activities/{snapshot_id}/attach-day", response_model=ActivityResponse)
async def attach_saved_activity_to_day(
    trip_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    payload: ActivityAttachDayRequest,
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

    idem = IdempotencyService(redis)
    fingerprint = payload_fingerprint(
        {
            "trip_id": str(trip_id),
            "snapshot_id": str(snapshot_id),
            "trip_day_id": str(payload.trip_day_id),
            "expected_version": expected_version,
        }
    )
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path=f"/trips/{trip_id}/activities/{snapshot_id}/attach-day",
        idempotency_key=idempotency_key,
        fingerprint=fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    activity = await EventRepository.attach_snapshot_to_day(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        snapshot_id=snapshot_id,
        trip_day_id=payload.trip_day_id,
    )
    response = _activity_response(activity)
    await cache_delete_prefix(redis, "trip:get:")
    await cache_delete_prefix(redis, "trip:list:")
    await cache_delete_prefix(redis, "activity:shortlist:")

    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path=f"/trips/{trip_id}/activities/{snapshot_id}/attach-day",
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            status_code=200,
            response_body=response.model_dump(mode="json"),
        )
    return response


@router.post(
    "/trips/{trip_id}/activities/recommendations",
    response_model=ActivityRecommendationResponse,
)
async def recommend_saved_activities(
    trip_id: uuid.UUID,
    payload: ActivityRecommendationRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> ActivityRecommendationResponse:
    await TripRepository.get_trip(db, auth.user_id, trip_id)
    await _assert_scope_days(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        day_ids=payload.day_ids,
    )
    try:
        items = await recommend_shortlist_items(
            db,
            redis=redis,
            user_id=auth.user_id,
            trip_id=trip_id,
            day_ids=payload.day_ids,
            snapshot_ids=payload.snapshot_ids,
            limit=payload.limit,
            use_llm_rationale=payload.use_llm_rationale,
        )
    except ValueError as exc:
        raise ValidationApiError(str(exc)) from exc

    return ActivityRecommendationResponse(total=len(items), items=items)
