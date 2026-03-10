import uuid

from fastapi import APIRouter, Depends, Header, Query
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
from app.db.repositories import JobRepository, OfferRepository, TripRepository
from app.db.session import get_db_session, get_redis
from app.errors import ServiceUnavailableError, ValidationApiError
from app.models.jobs import JobAcceptedResponse
from app.models.offers import (
    LodgingOfferSearchRequest,
    LodgingType,
    OfferAttachDayRequest,
    OfferKind,
    OfferListResponse,
    OfferRefreshRequest,
    OfferResponse,
    TransportMode,
    TransportOfferSearchRequest,
    TripOffersRefreshRequest,
)
from app.rate_limit.limiter import limit_user_request
from app.routers.utils import payload_fingerprint
from app.security.dependencies import AuthContext, get_auth_context
from app.services.offers_provider import (
    OfferProviderNonRetryableError,
    resolve_provider_availability,
    resolve_provider_order,
)

router = APIRouter(tags=["offers"])


async def _invalidate_offer_caches(redis: Redis) -> None:
    await cache_delete_prefix(redis, "offer:list:")
    await cache_delete_prefix(redis, "offer:search:v1:")


def _job_accepted(job_id: uuid.UUID) -> JobAcceptedResponse:
    return JobAcceptedResponse(job_id=job_id, status="PENDING", poll_url=f"/jobs/{job_id}")


def _service_unavailable_for_unconfigured(
    *,
    kind: OfferKind,
    providers: list[str],
    missing_env_vars: list[str],
) -> ServiceUnavailableError:
    return ServiceUnavailableError(
        code="INTEGRATION_NOT_CONFIGURED",
        message="No configured providers available",
        details={
            "kind": kind.value,
            "providers": providers,
            "missing_env_vars": sorted(set(missing_env_vars)),
        },
    )


def _resolve_provider_preflight(
    *,
    kind: OfferKind,
    requested: list[str] | None,
) -> tuple[list[str], list[dict]]:
    try:
        order = resolve_provider_order(kind, requested)
    except OfferProviderNonRetryableError as exc:
        raise ValidationApiError(exc.message, exc.details) from exc

    availability = resolve_provider_availability(kind, order)
    if not availability.configured:
        missing_vars = [
            env_var
            for item in availability.unavailable
            for env_var in item.get("missing_env_vars", [])
        ]
        raise _service_unavailable_for_unconfigured(
            kind=kind,
            providers=order,
            missing_env_vars=missing_vars,
        )
    return order, availability.unavailable


async def _assert_trip_day_in_trip(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    trip_id: uuid.UUID,
    trip_day_id: uuid.UUID | None,
) -> None:
    if trip_day_id is None:
        return
    days = await TripRepository.list_days(db, user_id, trip_id)
    if trip_day_id not in {day.id for day in days}:
        raise ValidationApiError("trip_day_id must belong to trip")


@router.post("/offers/transport/search", response_model=JobAcceptedResponse, status_code=202)
async def submit_transport_offer_search(
    payload: TransportOfferSearchRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> JobAcceptedResponse | JSONResponse:
    settings = get_settings()
    await limit_user_request(
        redis,
        str(auth.user_id),
        "offers:submit",
        settings.rate_limit_offers_submit_per_hour,
        window_seconds=3600,
    )

    trip = await TripRepository.get_trip(db, auth.user_id, payload.trip_id)
    await _assert_trip_day_in_trip(
        db,
        user_id=auth.user_id,
        trip_id=trip.id,
        trip_day_id=payload.trip_day_id,
    )

    provider_order, unavailable = _resolve_provider_preflight(
        kind=OfferKind.TRANSPORT,
        requested=payload.providers,
    )

    request_body = payload.model_dump(mode="json")
    request_body["destination_text"] = request_body.get("destination_text") or trip.destination_text
    request_body.pop("providers", None)

    request_fingerprint = payload_fingerprint(
        {
            "trip_id": str(trip.id),
            "kind": OfferKind.TRANSPORT.value,
            "providers": provider_order,
            "request": request_body,
        }
    )
    idem = IdempotencyService(redis)
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path="/offers/transport/search",
        idempotency_key=idempotency_key,
        fingerprint=request_fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    job = await JobRepository.create_job(
        db,
        auth.user_id,
        job_type="offers.search.transport",
        payload={
            "trip_id": str(trip.id),
            "user_id": str(auth.user_id),
            "providers": provider_order,
            "preflight_unavailable": unavailable,
            "request": request_body,
            "request_fingerprint": request_fingerprint,
        },
        max_attempts=settings.job_max_attempts,
    )
    response = _job_accepted(job.id)
    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path="/offers/transport/search",
            idempotency_key=idempotency_key,
            fingerprint=request_fingerprint,
            status_code=202,
            response_body=response.model_dump(mode="json"),
        )
    return response


@router.post("/offers/lodging/search", response_model=JobAcceptedResponse, status_code=202)
async def submit_lodging_offer_search(
    payload: LodgingOfferSearchRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> JobAcceptedResponse | JSONResponse:
    settings = get_settings()
    await limit_user_request(
        redis,
        str(auth.user_id),
        "offers:submit",
        settings.rate_limit_offers_submit_per_hour,
        window_seconds=3600,
    )

    trip = await TripRepository.get_trip(db, auth.user_id, payload.trip_id)
    await _assert_trip_day_in_trip(
        db,
        user_id=auth.user_id,
        trip_id=trip.id,
        trip_day_id=payload.trip_day_id,
    )

    provider_order, unavailable = _resolve_provider_preflight(
        kind=OfferKind.LODGING,
        requested=payload.providers,
    )

    request_body = payload.model_dump(mode="json")
    request_body["location_text"] = request_body.get("location_text") or trip.destination_text
    request_body.pop("providers", None)

    request_fingerprint = payload_fingerprint(
        {
            "trip_id": str(trip.id),
            "kind": OfferKind.LODGING.value,
            "providers": provider_order,
            "request": request_body,
        }
    )
    idem = IdempotencyService(redis)
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path="/offers/lodging/search",
        idempotency_key=idempotency_key,
        fingerprint=request_fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    job = await JobRepository.create_job(
        db,
        auth.user_id,
        job_type="offers.search.lodging",
        payload={
            "trip_id": str(trip.id),
            "user_id": str(auth.user_id),
            "providers": provider_order,
            "preflight_unavailable": unavailable,
            "request": request_body,
            "request_fingerprint": request_fingerprint,
        },
        max_attempts=settings.job_max_attempts,
    )
    response = _job_accepted(job.id)
    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path="/offers/lodging/search",
            idempotency_key=idempotency_key,
            fingerprint=request_fingerprint,
            status_code=202,
            response_body=response.model_dump(mode="json"),
        )
    return response


@router.get("/trips/{trip_id}/offers", response_model=OfferListResponse)
async def list_trip_offers(
    trip_id: uuid.UUID,
    kind: OfferKind | None = Query(default=None),
    transport_modes: list[TransportMode] | None = Query(default=None),
    lodging_types: list[LodgingType] | None = Query(default=None),
    current_only: bool = Query(default=True),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> OfferListResponse:
    transport_mode_values = [mode.value for mode in transport_modes] if transport_modes else None
    lodging_type_values = [kind_item.value for kind_item in lodging_types] if lodging_types else None
    cache_key = "offer:list:" + build_cache_key(
        str(auth.user_id),
        str(trip_id),
        str(kind.value if kind else "all"),
        ",".join(transport_mode_values or []),
        ",".join(lodging_type_values or []),
        str(current_only),
        str(limit),
        str(offset),
    )
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return OfferListResponse.model_validate(cached)

    total, items = await OfferRepository.list_offers(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        kind=kind,
        transport_modes=transport_mode_values,
        lodging_types=lodging_type_values,
        current_only=current_only,
        limit=limit,
        offset=offset,
    )
    response = OfferListResponse(total=total, limit=limit, offset=offset, items=items)
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        get_settings().offer_cache_ttl_sec,
    )
    return response


@router.post("/trips/{trip_id}/offers/{offer_id}/attach-day", response_model=OfferResponse)
async def attach_offer_to_day(
    trip_id: uuid.UUID,
    offer_id: uuid.UUID,
    payload: OfferAttachDayRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> OfferResponse | JSONResponse:
    idem = IdempotencyService(redis)
    fingerprint = payload_fingerprint(
        {
            "trip_id": str(trip_id),
            "offer_id": str(offer_id),
            "offer_kind": payload.offer_kind.value,
            "trip_day_id": str(payload.trip_day_id),
        }
    )
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path=f"/trips/{trip_id}/offers/{offer_id}/attach-day",
        idempotency_key=idempotency_key,
        fingerprint=fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    response = await OfferRepository.attach_offer_to_day(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        offer_kind=payload.offer_kind,
        offer_id=offer_id,
        trip_day_id=payload.trip_day_id,
    )
    await _invalidate_offer_caches(redis)

    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path=f"/trips/{trip_id}/offers/{offer_id}/attach-day",
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            status_code=200,
            response_body=response.model_dump(mode="json"),
        )
    return response


@router.post("/offers/{offer_id}/refresh", response_model=JobAcceptedResponse, status_code=202)
async def refresh_single_offer(
    offer_id: uuid.UUID,
    payload: OfferRefreshRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> JobAcceptedResponse | JSONResponse:
    settings = get_settings()
    await limit_user_request(
        redis,
        str(auth.user_id),
        "offers:submit",
        settings.rate_limit_offers_submit_per_hour,
        window_seconds=3600,
    )

    offer = await OfferRepository.get_offer_for_user(
        db,
        user_id=auth.user_id,
        offer_kind=payload.offer_kind,
        offer_id=offer_id,
    )
    _, unavailable = _resolve_provider_preflight(
        kind=payload.offer_kind,
        requested=[offer.provider],
    )

    request_fingerprint = payload_fingerprint(
        payload.model_dump(mode="json") | {"offer_id": str(offer_id)}
    )
    idem = IdempotencyService(redis)
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path=f"/offers/{offer_id}/refresh",
        idempotency_key=idempotency_key,
        fingerprint=request_fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    job = await JobRepository.create_job(
        db,
        auth.user_id,
        job_type="offers.refresh.single",
        payload={
            "user_id": str(auth.user_id),
            "offer_id": str(offer_id),
            "offer_kind": payload.offer_kind.value,
            "constraints": payload.constraints,
            "preflight_unavailable": unavailable,
            "request_fingerprint": request_fingerprint,
        },
        max_attempts=settings.job_max_attempts,
    )
    response = _job_accepted(job.id)
    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path=f"/offers/{offer_id}/refresh",
            idempotency_key=idempotency_key,
            fingerprint=request_fingerprint,
            status_code=202,
            response_body=response.model_dump(mode="json"),
        )
    return response


@router.post("/trips/{trip_id}/offers/refresh", response_model=JobAcceptedResponse, status_code=202)
async def refresh_trip_offers(
    trip_id: uuid.UUID,
    payload: TripOffersRefreshRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> JobAcceptedResponse | JSONResponse:
    settings = get_settings()
    await limit_user_request(
        redis,
        str(auth.user_id),
        "offers:submit",
        settings.rate_limit_offers_submit_per_hour,
        window_seconds=3600,
    )

    offers = await OfferRepository.get_trip_offers_for_refresh(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        offer_kind=payload.offer_kind,
        current_only=payload.current_only,
    )
    unavailable: list[dict] = []
    configured_found = False
    transport_providers = sorted(
        {str(offer.provider) for kind, offer in offers if kind == OfferKind.TRANSPORT}
    )
    lodging_providers = sorted(
        {str(offer.provider) for kind, offer in offers if kind == OfferKind.LODGING}
    )

    if transport_providers:
        transport_availability = resolve_provider_availability(
            OfferKind.TRANSPORT,
            transport_providers,
        )
        unavailable.extend(transport_availability.unavailable)
        configured_found = configured_found or bool(transport_availability.configured)

    if lodging_providers:
        lodging_availability = resolve_provider_availability(
            OfferKind.LODGING,
            lodging_providers,
        )
        unavailable.extend(lodging_availability.unavailable)
        configured_found = configured_found or bool(lodging_availability.configured)

    if offers and not configured_found:
        missing_vars = [
            env_var for item in unavailable for env_var in item.get("missing_env_vars", [])
        ]
        raise ServiceUnavailableError(
            code="INTEGRATION_NOT_CONFIGURED",
            message="No configured providers available",
            details={
                "providers": sorted({item["provider"] for item in unavailable}),
                "missing_env_vars": sorted(set(missing_vars)),
            },
        )

    request_fingerprint = payload_fingerprint(
        payload.model_dump(mode="json") | {"trip_id": str(trip_id)}
    )
    idem = IdempotencyService(redis)
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path=f"/trips/{trip_id}/offers/refresh",
        idempotency_key=idempotency_key,
        fingerprint=request_fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    job = await JobRepository.create_job(
        db,
        auth.user_id,
        job_type="offers.refresh.trip",
        payload={
            "trip_id": str(trip_id),
            "user_id": str(auth.user_id),
            "offer_kind": payload.offer_kind.value if payload.offer_kind else None,
            "current_only": payload.current_only,
            "constraints": payload.constraints,
            "preflight_unavailable": unavailable,
            "request_fingerprint": request_fingerprint,
        },
        max_attempts=settings.job_max_attempts,
    )
    response = _job_accepted(job.id)
    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path=f"/trips/{trip_id}/offers/refresh",
            idempotency_key=idempotency_key,
            fingerprint=request_fingerprint,
            status_code=202,
            response_body=response.model_dump(mode="json"),
        )
    return response
