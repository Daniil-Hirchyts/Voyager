import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import JSONResponse
from redis.asyncio import Redis
from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.redis_helpers import (
    IdempotencyService,
    build_cache_key,
    cache_delete_prefix,
    cache_get_json,
    cache_set_json,
)
from app.config import get_settings
from app.db.models import Activity, Place, TripDay
from app.db.repositories import (
    ActivityRepository,
    AuditRepository,
    EventRepository,
    JobRepository,
    PlacePhotoRepository,
    TripRepository,
)
from app.db.session import get_db_session, get_redis
from app.errors import ConflictError, NotFoundError, ValidationApiError
from app.models.activity_discovery import ActivityDiscoveryPhoto
from app.models.audit import AuditLogEntry, AuditLogListResponse
from app.models.jobs import JobAcceptedResponse
from app.models.places import PlaceResponse
from app.models.planner_map import (
    PlannerMapMentionLink,
    PlannerMapPlaceDetailResponse,
    PlannerMapRelatedActivitySummary,
)
from app.models.trips import (
    DayListResponse,
    DayResponse,
    PlannerActivityResponse,
    PlannerDayResponse,
    PlannerPlaceSummary,
    TripCreateRequest,
    TripGenerateRequest,
    TripListResponse,
    TripPatchRequest,
    TripPlannerResponse,
    TripRegenerateRequest,
    TripResetItineraryRequest,
    TripResponse,
)
from app.rate_limit.limiter import limit_user_request
from app.routers.utils import parse_if_match, payload_fingerprint
from app.security.dependencies import AuthContext, get_auth_context

router = APIRouter(prefix="/trips", tags=["trips"])


def _trip_response(trip) -> TripResponse:
    return TripResponse(
        id=trip.id,
        user_id=trip.user_id,
        title=trip.title,
        destination_text=trip.destination_text,
        start_date=trip.start_date,
        end_date=trip.end_date,
        budget_amount=trip.budget_amount,
        budget_currency=trip.budget_currency,
        trip_type=trip.trip_type,
        version=trip.version,
        created_at=trip.created_at,
        updated_at=trip.updated_at,
    )


def _planner_place_summary(place, *, photo_count: int = 0, primary_photo=None) -> PlannerPlaceSummary:
    return PlannerPlaceSummary(
        id=place.id,
        name=place.name,
        category=place.category,
        address_text=place.address_text,
        lat=place.lat,
        lon=place.lon,
        photo_count=photo_count,
        primary_photo=primary_photo,
    )


def _planner_activity_response(
    activity,
    *,
    place=None,
    photo_count: int = 0,
    primary_photo=None,
) -> PlannerActivityResponse:
    return PlannerActivityResponse(
        id=activity.id,
        trip_day_id=activity.trip_day_id,
        order_index=activity.order_index,
        category=activity.category,
        category_details=activity.category_details_json or {},
        title=activity.title,
        description=activity.description,
        start_time=activity.start_time,
        duration_min=activity.duration_min,
        estimated_cost_amount=activity.estimated_cost_amount,
        estimated_cost_currency=activity.estimated_cost_currency,
        place_id=activity.place_id,
        place=(
            _planner_place_summary(place, photo_count=photo_count, primary_photo=primary_photo)
            if place is not None
            else None
        ),
        event_snapshot_id=activity.event_snapshot_id,
        notes=activity.notes,
        is_favorite=activity.is_favorite,
        visited_at=activity.visited_at,
        source=activity.source,
        created_at=activity.created_at,
        updated_at=activity.updated_at,
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
        raise ValidationApiError(
            "One or more day_ids are not part of the trip", {"day_ids": invalid}
        )


def _job_accepted(job_id: uuid.UUID) -> JobAcceptedResponse:
    return JobAcceptedResponse(job_id=job_id, status="PENDING", poll_url=f"/jobs/{job_id}")


def _audit_entry_response(entry) -> AuditLogEntry:
    return AuditLogEntry(
        id=entry.id,
        user_id=entry.user_id,
        trip_id=entry.trip_id,
        entity_type=entry.entity_type,
        entity_id=entry.entity_id,
        action=entry.action,
        before=entry.before_json,
        after=entry.after_json,
        correlation_id=entry.correlation_id,
        request_path=entry.request_path,
        created_at=entry.created_at,
    )


def _coerce_float(value) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _string_list(*values) -> list[str]:
    items: list[str] = []
    for value in values:
        if isinstance(value, str):
            normalized = value.strip()
            if normalized:
                items.append(normalized)
        elif isinstance(value, list):
            for item in value:
                items.extend(_string_list(item))
        elif isinstance(value, dict):
            items.extend(
                _string_list(
                    value.get("name"),
                    value.get("label"),
                    value.get("text"),
                    value.get("title"),
                )
            )

    seen: set[str] = set()
    deduped: list[str] = []
    for item in items:
        lowered = item.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        deduped.append(item)
    return deduped


def _place_response(place, *, photo_count: int = 0, primary_photo=None) -> PlaceResponse:
    return PlaceResponse(
        id=place.id,
        source=place.source,
        external_id=place.external_id,
        name=place.name,
        category=place.category,
        address_text=place.address_text,
        lat=place.lat,
        lon=place.lon,
        metadata=place.metadata_json,
        canonical_place_id=place.canonical_place_id,
        is_canonical=place.canonical_place_id is None,
        dedup_confidence=place.dedup_confidence,
        merged_at=place.merged_at,
        photo_count=photo_count,
        primary_photo=primary_photo,
        distance_m=None,
        created_at=place.created_at,
        updated_at=place.updated_at,
    )


def _place_photo_to_discovery_photo(photo) -> ActivityDiscoveryPhoto:
    return ActivityDiscoveryPhoto(
        image_url=photo.image_url,
        thumbnail_url=photo.thumbnail_url,
        width=photo.width,
        height=photo.height,
        caption=photo.attribution_text,
    )


def _place_mentions(place, snapshot) -> list[PlannerMapMentionLink]:
    metadata = place.metadata_json or {}
    snapshot_detail = snapshot.provider_detail_json if snapshot is not None else {}
    links: list[PlannerMapMentionLink] = []

    google_maps_uri = metadata.get("google_maps_uri")
    if isinstance(google_maps_uri, str) and google_maps_uri.strip():
        links.append(PlannerMapMentionLink(label="Google Maps", url=google_maps_uri))

    website = metadata.get("website") or metadata.get("website_uri")
    if isinstance(website, str) and website.strip():
        links.append(PlannerMapMentionLink(label="Website", url=website))

    if snapshot is not None and isinstance(snapshot.deep_link, str) and snapshot.deep_link.strip():
        provider_name = snapshot.provider.title() if snapshot.provider else "Provider"
        links.append(PlannerMapMentionLink(label=provider_name, url=snapshot.deep_link))

    for booking_link in (snapshot_detail or {}).get("booking_links") or []:
        if not isinstance(booking_link, dict):
            continue
        label = str(booking_link.get("label") or "Booking").strip()
        url = booking_link.get("url")
        links.append(
            PlannerMapMentionLink(label=label, url=str(url) if isinstance(url, str) else None)
        )

    deduped: list[PlannerMapMentionLink] = []
    seen: set[tuple[str, str | None]] = set()
    for item in links:
        key = (item.label.lower(), item.url)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


@router.post("", response_model=TripResponse, status_code=201)
async def create_trip(
    payload: TripCreateRequest,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> TripResponse | JSONResponse:
    settings = get_settings()
    await limit_user_request(
        redis, str(auth.user_id), "trips:create", settings.rate_limit_trip_create_per_min
    )

    idem = IdempotencyService(redis)
    fingerprint = payload_fingerprint(payload.model_dump(mode="json"))
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path="/trips",
        idempotency_key=idempotency_key,
        fingerprint=fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    trip = await TripRepository.create_trip(db, auth.user_id, payload)
    response = _trip_response(trip)
    await cache_delete_prefix(redis, "trip:get:")
    await cache_delete_prefix(redis, "trip:list:")

    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path="/trips",
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            status_code=201,
            response_body=response.model_dump(mode="json"),
        )

    return response


@router.get("", response_model=TripListResponse)
async def list_trips(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> TripListResponse:
    cache_key = "trip:list:" + build_cache_key(str(auth.user_id), str(limit), str(offset))
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return TripListResponse.model_validate(cached)

    total, items = await TripRepository.list_trips(db, auth.user_id, limit=limit, offset=offset)
    response = TripListResponse(
        total=total,
        limit=limit,
        offset=offset,
        items=[_trip_response(item) for item in items],
    )
    await cache_set_json(
        redis, cache_key, response.model_dump(mode="json"), get_settings().trip_cache_ttl_sec
    )
    return response


@router.get("/{trip_id}", response_model=TripResponse)
async def get_trip(
    trip_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> TripResponse:
    cache_key = "trip:get:" + build_cache_key(str(auth.user_id), str(trip_id))
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return TripResponse.model_validate(cached)

    trip = await TripRepository.get_trip(db, auth.user_id, trip_id)
    response = _trip_response(trip)
    await cache_set_json(
        redis, cache_key, response.model_dump(mode="json"), get_settings().trip_cache_ttl_sec
    )
    return response


@router.get("/{trip_id}/planner", response_model=TripPlannerResponse)
async def get_trip_planner(
    trip_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
) -> TripPlannerResponse:
    trip = await TripRepository.get_trip(db, auth.user_id, trip_id)
    days = await TripRepository.list_days(db, auth.user_id, trip_id)
    activities = await ActivityRepository.list_trip_activities(db, auth.user_id, trip_id)

    place_ids = list(dict.fromkeys(activity.place_id for activity in activities if activity.place_id))
    photo_summaries = await PlacePhotoRepository.photo_summaries_for_place_ids(db, place_ids)

    places_by_id: dict[uuid.UUID, Place] = {}
    if place_ids:
        rows = await db.execute(select(Place).where(Place.id.in_(place_ids)))
        places_by_id = {place.id: place for place in rows.scalars().all()}

    activities_by_day: dict[uuid.UUID, list[PlannerActivityResponse]] = {day.id: [] for day in days}
    inbox_activities: list[PlannerActivityResponse] = []
    for activity in activities:
        photo_count = 0
        primary_photo = None
        place = places_by_id.get(activity.place_id) if activity.place_id else None
        if activity.place_id:
            photo_count, primary_photo = photo_summaries.get(activity.place_id, (0, None))
        response_activity = _planner_activity_response(
            activity,
            place=place,
            photo_count=photo_count,
            primary_photo=primary_photo,
        )
        if activity.trip_day_id is None:
            inbox_activities.append(response_activity)
            continue
        activities_by_day.setdefault(activity.trip_day_id, []).append(response_activity)

    return TripPlannerResponse(
        trip=_trip_response(trip),
        inbox_activities=inbox_activities,
        days=[
            PlannerDayResponse(
                id=day.id,
                trip_id=day.trip_id,
                day_index=day.day_index,
                date=day.date,
                notes=day.notes,
                created_at=day.created_at,
                updated_at=day.updated_at,
                activities=activities_by_day.get(day.id, []),
            )
            for day in days
        ],
    )


@router.get(
    "/{trip_id}/planner-map/places/{place_id}/detail",
    response_model=PlannerMapPlaceDetailResponse,
)
async def get_planner_map_place_detail(
    trip_id: uuid.UUID,
    place_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
) -> PlannerMapPlaceDetailResponse:
    await TripRepository.get_trip(db, auth.user_id, trip_id)
    place_record = await db.get(Place, place_id)
    if place_record is None:
        raise NotFoundError("Place not found")

    place_photos = await PlacePhotoRepository.list_photos(db, place_id=place_id)
    photo_count = len(place_photos)
    primary_photo = next(
        (item for item in place_photos if item.is_primary),
        place_photos[0] if place_photos else None,
    )

    activities_result = await db.execute(
        select(Activity, TripDay)
        .outerjoin(TripDay, Activity.trip_day_id == TripDay.id)
        .where(Activity.trip_id == trip_id)
        .where(Activity.place_id == place_id)
        .order_by(
            case((Activity.trip_day_id.is_(None), 1), else_=0),
            TripDay.day_index.asc().nulls_last(),
            Activity.order_index.asc(),
        )
    )
    related_rows = activities_result.all()
    related_activities = [row[0] for row in related_rows]

    snapshot = None
    snapshot_id = next(
        (
            activity.event_snapshot_id
            for activity in related_activities
            if activity.event_snapshot_id is not None
        ),
        None,
    )
    if snapshot_id is not None:
        snapshot = await EventRepository.get_snapshot_for_user(
            db,
            user_id=auth.user_id,
            snapshot_id=snapshot_id,
        )

    snapshot_detail = EventRepository.to_discovery_detail(snapshot) if snapshot is not None else None
    metadata = place_record.metadata_json or {}
    metadata_hours = metadata.get("hours") if isinstance(metadata.get("hours"), list) else []

    return PlannerMapPlaceDetailResponse(
        place=_place_response(
            place_record,
            photo_count=photo_count,
            primary_photo=PlacePhotoRepository._summary(primary_photo) if primary_photo else None,
        ),
        summary=(
            snapshot_detail.summary
            if snapshot_detail and snapshot_detail.summary
            else (
                str(metadata.get("description")).strip()
                if isinstance(metadata.get("description"), str) and metadata.get("description").strip()
                else None
            )
        ),
        rating=(
            snapshot_detail.rating
            if snapshot_detail and snapshot_detail.rating is not None
            else _coerce_float(metadata.get("rating"))
        ),
        review_count=snapshot_detail.review_count if snapshot_detail else None,
        status_text=snapshot_detail.status_text if snapshot_detail else None,
        price_label=snapshot_detail.price_label if snapshot_detail else None,
        photos=(
            snapshot_detail.photos
            if snapshot_detail and snapshot_detail.photos
            else [_place_photo_to_discovery_photo(photo) for photo in place_photos]
        ),
        reviews=snapshot_detail.reviews if snapshot_detail else [],
        hours=snapshot_detail.hours if snapshot_detail and snapshot_detail.hours else metadata_hours,
        booking_links=snapshot_detail.booking_links if snapshot_detail else [],
        tags=_string_list(
            metadata.get("tags"),
            metadata.get("cuisine"),
            metadata.get("opening_hours"),
            place_record.category,
            snapshot.raw_payload_json.get("categories")
            if snapshot is not None and isinstance(snapshot.raw_payload_json, dict)
            else [],
            snapshot.raw_payload_json.get("labels")
            if snapshot is not None and isinstance(snapshot.raw_payload_json, dict)
            else [],
        ),
        mentions=_place_mentions(place_record, snapshot),
        related_activities=[
            PlannerMapRelatedActivitySummary(
                activity_id=activity.id,
                trip_day_id=activity.trip_day_id,
                order_index=activity.order_index,
                title=activity.title,
                category=activity.category,
                visited_at=activity.visited_at,
            )
            for activity in related_activities
        ],
    )


@router.patch("/{trip_id}", response_model=TripResponse)
async def patch_trip(
    trip_id: uuid.UUID,
    payload: TripPatchRequest,
    if_match: str | None = Header(default=None, alias="If-Match"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> TripResponse:
    expected_version = parse_if_match(if_match)
    trip = await TripRepository.patch_trip(db, auth.user_id, trip_id, expected_version, payload)
    await cache_delete_prefix(redis, "trip:get:")
    await cache_delete_prefix(redis, "trip:list:")
    return _trip_response(trip)


@router.delete("/{trip_id}", status_code=204)
async def delete_trip(
    trip_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> None:
    await TripRepository.delete_trip(db, auth.user_id, trip_id)
    await cache_delete_prefix(redis, "trip:get:")
    await cache_delete_prefix(redis, "trip:list:")


@router.post("/{trip_id}/duplicate", response_model=TripResponse, status_code=201)
async def duplicate_trip(
    trip_id: uuid.UUID,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> TripResponse | JSONResponse:
    idem = IdempotencyService(redis)
    fingerprint = payload_fingerprint({"trip_id": str(trip_id)})
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path=f"/trips/{trip_id}/duplicate",
        idempotency_key=idempotency_key,
        fingerprint=fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    trip = await TripRepository.duplicate_trip(db, auth.user_id, trip_id)
    response = _trip_response(trip)
    await cache_delete_prefix(redis, "trip:get:")
    await cache_delete_prefix(redis, "trip:list:")

    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path=f"/trips/{trip_id}/duplicate",
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            status_code=201,
            response_body=response.model_dump(mode="json"),
        )
    return response


@router.get("/{trip_id}/days", response_model=DayListResponse)
async def list_trip_days(
    trip_id: uuid.UUID,
    limit: int = Query(default=365, ge=1, le=730),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
) -> DayListResponse:
    days = await TripRepository.list_days(db, auth.user_id, trip_id)
    sliced = days[offset : offset + limit]
    return DayListResponse(
        total=len(days),
        limit=limit,
        offset=offset,
        items=[
            DayResponse(
                id=day.id,
                trip_id=day.trip_id,
                day_index=day.day_index,
                date=day.date,
                notes=day.notes,
                created_at=day.created_at,
                updated_at=day.updated_at,
            )
            for day in sliced
        ],
    )


@router.get("/{trip_id}/audit", response_model=AuditLogListResponse)
async def list_trip_audit(
    trip_id: uuid.UUID,
    entity_type: str | None = Query(default=None),
    action: str | None = Query(default=None),
    from_dt: datetime | None = Query(default=None, alias="from"),
    to_dt: datetime | None = Query(default=None, alias="to"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> AuditLogListResponse:
    settings = get_settings()
    await limit_user_request(
        redis,
        str(auth.user_id),
        "audit:read",
        settings.rate_limit_audit_read_per_min,
        window_seconds=60,
    )
    cache_key = "audit:list:" + build_cache_key(
        str(auth.user_id),
        str(trip_id),
        entity_type or "",
        action or "",
        from_dt.isoformat() if from_dt else "",
        to_dt.isoformat() if to_dt else "",
        str(limit),
        str(offset),
    )
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return AuditLogListResponse.model_validate(cached)

    total, items = await AuditRepository.list_trip_audit(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        entity_type=entity_type,
        action=action,
        from_dt=from_dt,
        to_dt=to_dt,
        limit=limit,
        offset=offset,
    )
    response = AuditLogListResponse(
        total=total,
        limit=limit,
        offset=offset,
        items=[_audit_entry_response(item) for item in items],
    )
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        settings.audit_cache_ttl_sec,
    )
    return response


@router.post("/{trip_id}/generate", response_model=JobAcceptedResponse, status_code=202)
async def generate_trip_itinerary(
    trip_id: uuid.UUID,
    payload: TripGenerateRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    if_match: str | None = Header(default=None, alias="If-Match"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> JobAcceptedResponse | JSONResponse:
    settings = get_settings()
    await limit_user_request(
        redis,
        str(auth.user_id),
        "itinerary:submit",
        settings.rate_limit_generate_per_hour,
        window_seconds=3600,
    )

    expected_version = parse_if_match(if_match)
    fingerprint = payload_fingerprint(
        payload.model_dump(mode="json")
        | {"trip_id": str(trip_id), "expected_trip_version": expected_version}
    )
    idem = IdempotencyService(redis)
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path=f"/trips/{trip_id}/generate",
        idempotency_key=idempotency_key,
        fingerprint=fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    trip = await TripRepository.get_trip(db, auth.user_id, trip_id)
    if trip.version != expected_version:
        raise ConflictError(
            code="CONFLICT_VERSION_MISMATCH",
            message="Trip version mismatch",
            details={"latest_version": trip.version},
        )
    await _assert_scope_days(db, user_id=auth.user_id, trip_id=trip_id, day_ids=payload.day_ids)

    job = await JobRepository.create_job(
        db,
        auth.user_id,
        job_type="itinerary.generate",
        payload={
            "trip_id": str(trip_id),
            "user_id": str(auth.user_id),
            "mode": payload.mode.value,
            "day_ids": [str(day_id) for day_id in payload.day_ids] if payload.day_ids else None,
            "constraints": payload.constraints,
            "seed": payload.seed,
            "expected_trip_version": expected_version,
        },
        max_attempts=settings.job_max_attempts,
    )
    response = _job_accepted(job.id)
    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path=f"/trips/{trip_id}/generate",
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            status_code=202,
            response_body=response.model_dump(mode="json"),
        )
    return response


@router.post("/{trip_id}/regenerate", response_model=JobAcceptedResponse, status_code=202)
async def regenerate_trip_itinerary(
    trip_id: uuid.UUID,
    payload: TripRegenerateRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    if_match: str | None = Header(default=None, alias="If-Match"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> JobAcceptedResponse | JSONResponse:
    settings = get_settings()
    await limit_user_request(
        redis,
        str(auth.user_id),
        "itinerary:submit",
        settings.rate_limit_generate_per_hour,
        window_seconds=3600,
    )

    expected_version = parse_if_match(if_match)
    fingerprint = payload_fingerprint(
        payload.model_dump(mode="json")
        | {"trip_id": str(trip_id), "expected_trip_version": expected_version}
    )
    idem = IdempotencyService(redis)
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path=f"/trips/{trip_id}/regenerate",
        idempotency_key=idempotency_key,
        fingerprint=fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    trip = await TripRepository.get_trip(db, auth.user_id, trip_id)
    if trip.version != expected_version:
        raise ConflictError(
            code="CONFLICT_VERSION_MISMATCH",
            message="Trip version mismatch",
            details={"latest_version": trip.version},
        )
    await _assert_scope_days(db, user_id=auth.user_id, trip_id=trip_id, day_ids=payload.day_ids)

    job = await JobRepository.create_job(
        db,
        auth.user_id,
        job_type="itinerary.regenerate",
        payload={
            "trip_id": str(trip_id),
            "user_id": str(auth.user_id),
            "mode": payload.mode.value,
            "day_ids": [str(day_id) for day_id in payload.day_ids] if payload.day_ids else None,
            "constraints": payload.constraints,
            "seed": payload.seed,
            "expected_trip_version": expected_version,
        },
        max_attempts=settings.job_max_attempts,
    )
    response = _job_accepted(job.id)
    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path=f"/trips/{trip_id}/regenerate",
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            status_code=202,
            response_body=response.model_dump(mode="json"),
        )
    return response


@router.post("/{trip_id}/reset-itinerary", response_model=JobAcceptedResponse, status_code=202)
async def reset_trip_itinerary(
    trip_id: uuid.UUID,
    payload: TripResetItineraryRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    if_match: str | None = Header(default=None, alias="If-Match"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> JobAcceptedResponse | JSONResponse:
    settings = get_settings()
    await limit_user_request(
        redis,
        str(auth.user_id),
        "itinerary:submit",
        settings.rate_limit_generate_per_hour,
        window_seconds=3600,
    )

    expected_version = parse_if_match(if_match)
    fingerprint = payload_fingerprint(
        payload.model_dump(mode="json")
        | {"trip_id": str(trip_id), "expected_trip_version": expected_version}
    )
    idem = IdempotencyService(redis)
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path=f"/trips/{trip_id}/reset-itinerary",
        idempotency_key=idempotency_key,
        fingerprint=fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    trip = await TripRepository.get_trip(db, auth.user_id, trip_id)
    if trip.version != expected_version:
        raise ConflictError(
            code="CONFLICT_VERSION_MISMATCH",
            message="Trip version mismatch",
            details={"latest_version": trip.version},
        )
    await _assert_scope_days(db, user_id=auth.user_id, trip_id=trip_id, day_ids=payload.day_ids)

    job = await JobRepository.create_job(
        db,
        auth.user_id,
        job_type="itinerary.reset",
        payload={
            "trip_id": str(trip_id),
            "user_id": str(auth.user_id),
            "mode": "replace",
            "day_ids": [str(day_id) for day_id in payload.day_ids],
            "constraints": {},
            "seed": None,
            "expected_trip_version": expected_version,
        },
        max_attempts=settings.job_max_attempts,
    )
    response = _job_accepted(job.id)
    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path=f"/trips/{trip_id}/reset-itinerary",
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            status_code=202,
            response_body=response.model_dump(mode="json"),
        )
    return response
