from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.redis_helpers import build_cache_key, cache_get_json, cache_set_json
from app.config import get_settings
from app.db.models import Job, LodgingOffer, TransportOffer, Trip
from app.db.repositories import OfferRepository
from app.db.session import redis_client
from app.models.offers import OfferKind
from app.rate_limit.limiter import enforce_limit
from app.services.itinerary_generation import NonRetryableJobError, RetryableJobError
from app.services.offers_provider import (
    OfferProviderLimitedError,
    OfferProviderNonRetryableError,
    OfferProviderRetryableError,
    get_provider,
    resolve_provider_availability,
    resolve_provider_order,
)

settings = get_settings()


@dataclass
class OffersExecutionResult:
    summary: dict[str, int]
    offer_ids: list[str]
    errors: list[dict[str, Any]]


def _as_uuid(value: Any, *, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise NonRetryableJobError("JOB_PAYLOAD_INVALID", f"{field} must be a valid UUID") from exc


def _as_kind(value: Any, *, required: bool = True) -> OfferKind | None:
    if value is None:
        if required:
            raise NonRetryableJobError("JOB_PAYLOAD_INVALID", "offer_kind is required")
        return None
    try:
        return OfferKind(str(value))
    except ValueError as exc:
        raise NonRetryableJobError("JOB_PAYLOAD_INVALID", "offer_kind is invalid") from exc


def _provider_failure_key(provider: str, endpoint: str) -> str:
    return f"offers:provider:fail:{provider}:{endpoint}"


def _provider_cooldown_key(provider: str, endpoint: str) -> str:
    return f"offers:provider:cooldown:{provider}:{endpoint}"


async def _raise_if_provider_on_cooldown(provider: str, endpoint: str) -> None:
    if redis_client is None:
        return
    cooldown_key = _provider_cooldown_key(provider, endpoint)
    is_cooling_down = await redis_client.get(cooldown_key)
    if is_cooling_down:
        raise OfferProviderLimitedError(
            "PROVIDER_LIMITED",
            "Provider is on cooldown",
            {"provider": provider, "endpoint": endpoint},
        )


async def _record_provider_failure(provider: str, endpoint: str) -> None:
    if redis_client is None:
        return
    fail_key = _provider_failure_key(provider, endpoint)
    failures = await redis_client.incr(fail_key)
    await redis_client.expire(fail_key, 600)
    if failures >= settings.offers_provider_failure_threshold:
        await redis_client.set(
            _provider_cooldown_key(provider, endpoint),
            "1",
            ex=settings.offers_provider_cooldown_sec,
        )


async def _clear_provider_failures(provider: str, endpoint: str) -> None:
    if redis_client is None:
        return
    await redis_client.delete(_provider_failure_key(provider, endpoint))


async def _assert_trip_owner(db: AsyncSession, *, trip_id: uuid.UUID, user_id: uuid.UUID) -> Trip:
    row = await db.execute(select(Trip).where(Trip.id == trip_id).where(Trip.user_id == user_id))
    trip = row.scalar_one_or_none()
    if not trip:
        raise NonRetryableJobError("RESOURCE_NOT_FOUND", "Trip not found for offers job")
    return trip


async def _create_transport_snapshot_from_candidate(
    db: AsyncSession,
    *,
    trip_id: uuid.UUID,
    trip_day_id: uuid.UUID | None,
    request_fingerprint: str | None,
    candidate: dict[str, Any],
) -> TransportOffer:
    return await OfferRepository.create_transport_snapshot(
        db,
        trip_id=trip_id,
        trip_day_id=trip_day_id,
        provider=candidate["provider"],
        request_fingerprint=request_fingerprint,
        provider_offer_ref=candidate.get("provider_offer_ref"),
        title=candidate["title"],
        transport_mode=candidate.get("transport_mode"),
        origin_text=candidate.get("origin_text"),
        destination_text=candidate.get("destination_text"),
        depart_at=candidate.get("depart_at"),
        arrive_at=candidate.get("arrive_at"),
        price_amount=candidate["price_amount"],
        currency=candidate["currency"],
        deep_link=candidate.get("deep_link"),
        expires_at=candidate["expires_at"],
        raw_payload_json=candidate.get("raw_payload_json") or {},
    )


async def _create_lodging_snapshot_from_candidate(
    db: AsyncSession,
    *,
    trip_id: uuid.UUID,
    trip_day_id: uuid.UUID | None,
    request_fingerprint: str | None,
    candidate: dict[str, Any],
) -> LodgingOffer:
    return await OfferRepository.create_lodging_snapshot(
        db,
        trip_id=trip_id,
        trip_day_id=trip_day_id,
        provider=candidate["provider"],
        request_fingerprint=request_fingerprint,
        provider_offer_ref=candidate.get("provider_offer_ref"),
        title=candidate["title"],
        lodging_type=candidate.get("lodging_type"),
        location_text=candidate.get("location_text"),
        room_type=candidate.get("room_type"),
        checkin_date=candidate.get("checkin_date"),
        checkout_date=candidate.get("checkout_date"),
        nights=candidate.get("nights"),
        price_amount=candidate["price_amount"],
        currency=candidate["currency"],
        deep_link=candidate.get("deep_link"),
        expires_at=candidate["expires_at"],
        raw_payload_json=candidate.get("raw_payload_json") or {},
    )


async def _execute_search_job(
    db: AsyncSession,
    *,
    kind: OfferKind,
    payload: dict[str, Any],
) -> OffersExecutionResult:
    trip_id = _as_uuid(payload.get("trip_id"), field="trip_id")
    user_id = _as_uuid(payload.get("user_id"), field="user_id")
    await _assert_trip_owner(db, trip_id=trip_id, user_id=user_id)

    request = payload.get("request")
    if not isinstance(request, dict):
        raise NonRetryableJobError("JOB_PAYLOAD_INVALID", "request payload must be an object")

    trip_day_id = request.get("trip_day_id")
    if trip_day_id is not None:
        trip_day_id = _as_uuid(trip_day_id, field="trip_day_id")

    order = resolve_provider_order(kind, payload.get("providers"))
    availability = resolve_provider_availability(kind, order)
    if not availability.configured:
        missing_vars = sorted(
            {var for item in availability.unavailable for var in item.get("missing_env_vars", [])}
        )
        raise NonRetryableJobError(
            "INTEGRATION_NOT_CONFIGURED",
            "No configured providers available",
            {
                "kind": kind.value,
                "providers": order,
                "missing_env_vars": missing_vars,
            },
        )

    request_fingerprint = payload.get("request_fingerprint")
    cache_key = None
    if request_fingerprint:
        cache_key = "offer:search:v1:" + build_cache_key(kind.value, str(request_fingerprint))
        cached = await cache_get_json(redis_client, cache_key)
        if cached:
            return OffersExecutionResult(
                summary=cached.get("summary", {}),
                offer_ids=cached.get("offer_ids", []),
                errors=cached.get("errors", []),
            )

    offer_ids: list[str] = []
    errors = list(availability.unavailable)
    success_count = 0
    completed_provider_count = 0

    endpoint = f"search:{kind.value}"
    for provider_name in availability.configured:
        provider = get_provider(kind, provider_name)
        try:
            await _raise_if_provider_on_cooldown(provider_name, endpoint)
            await enforce_limit(
                redis_client,
                prefix="rl:provider",
                identifier=provider_name,
                scope=endpoint,
                limit=settings.rate_limit_offers_provider_per_min,
                window_seconds=60,
            )
            candidates = await provider.search(request)
            for candidate in candidates:
                checked = await provider.price_check(candidate)
                if kind == OfferKind.TRANSPORT:
                    created = await _create_transport_snapshot_from_candidate(
                        db,
                        trip_id=trip_id,
                        trip_day_id=trip_day_id,
                        request_fingerprint=request_fingerprint,
                        candidate=checked,
                    )
                else:
                    created = await _create_lodging_snapshot_from_candidate(
                        db,
                        trip_id=trip_id,
                        trip_day_id=trip_day_id,
                        request_fingerprint=request_fingerprint,
                        candidate=checked,
                )
                offer_ids.append(str(created.id))
                success_count += 1
            completed_provider_count += 1
            await _clear_provider_failures(provider_name, endpoint)
        except OfferProviderLimitedError as exc:
            await _record_provider_failure(provider_name, endpoint)
            errors.append(
                {
                    "provider": provider_name,
                    "code": exc.code,
                    "message": exc.message,
                    "details": exc.details,
                }
            )
        except OfferProviderRetryableError as exc:
            await _record_provider_failure(provider_name, endpoint)
            errors.append(
                {
                    "provider": provider_name,
                    "code": exc.code,
                    "message": exc.message,
                    "details": exc.details,
                }
            )
        except OfferProviderNonRetryableError as exc:
            errors.append(
                {
                    "provider": provider_name,
                    "code": exc.code,
                    "message": exc.message,
                    "details": exc.details,
                }
            )

    if success_count == 0 and completed_provider_count == 0:
        raise NonRetryableJobError(
            "UPSTREAM_PROVIDER_ERROR",
            "No provider returned offers",
            {"kind": kind.value, "errors": errors},
        )

    summary = {
        "processed_providers": len(availability.configured),
        "completed_providers": completed_provider_count,
        "created": success_count,
        "errors": len(errors),
    }
    result = OffersExecutionResult(summary=summary, offer_ids=offer_ids, errors=errors)

    if cache_key:
        await cache_set_json(
            redis_client,
            cache_key,
            {
                "summary": summary,
                "offer_ids": offer_ids,
                "errors": errors,
            },
            settings.offer_search_cache_ttl_sec,
        )

    return result


def _transport_as_refresh_payload(offer: TransportOffer) -> dict[str, Any]:
    return {
        "id": str(offer.id),
        "provider": offer.provider,
        "provider_offer_ref": offer.provider_offer_ref,
        "title": offer.title,
        "transport_mode": offer.transport_mode,
        "origin_text": offer.origin_text,
        "destination_text": offer.destination_text,
        "depart_at": offer.depart_at,
        "arrive_at": offer.arrive_at,
        "price_amount": offer.price_amount,
        "currency": offer.currency,
        "deep_link": offer.deep_link,
        "expires_at": offer.expires_at,
        "raw_payload_json": offer.raw_payload_json,
    }


def _lodging_as_refresh_payload(offer: LodgingOffer) -> dict[str, Any]:
    return {
        "id": str(offer.id),
        "provider": offer.provider,
        "provider_offer_ref": offer.provider_offer_ref,
        "title": offer.title,
        "lodging_type": offer.lodging_type,
        "location_text": offer.location_text,
        "room_type": offer.room_type,
        "checkin_date": offer.checkin_date,
        "checkout_date": offer.checkout_date,
        "nights": offer.nights,
        "price_amount": offer.price_amount,
        "currency": offer.currency,
        "deep_link": offer.deep_link,
        "expires_at": offer.expires_at,
        "raw_payload_json": offer.raw_payload_json,
    }


async def _refresh_one_offer(
    db: AsyncSession,
    *,
    kind: OfferKind,
    offer: TransportOffer | LodgingOffer,
    constraints: dict[str, Any],
    request_fingerprint: str | None,
) -> tuple[str | None, bool, dict[str, Any] | None]:
    provider_name = str(offer.provider)
    availability = resolve_provider_availability(kind, [provider_name])
    if not availability.configured:
        return (
            None,
            False,
            {
                "provider": provider_name,
                "code": "INTEGRATION_NOT_CONFIGURED",
                "message": "Provider credentials are missing",
                "missing_env_vars": availability.unavailable[0].get("missing_env_vars", []),
            },
        )

    endpoint = f"refresh:{kind.value}"
    provider = get_provider(kind, provider_name)
    try:
        await _raise_if_provider_on_cooldown(provider_name, endpoint)
        await enforce_limit(
            redis_client,
            prefix="rl:provider",
            identifier=provider_name,
            scope=endpoint,
            limit=settings.rate_limit_offers_provider_per_min,
            window_seconds=60,
        )

        existing_payload = (
            _transport_as_refresh_payload(offer)
            if kind == OfferKind.TRANSPORT
            else _lodging_as_refresh_payload(offer)
        )
        refresh_result = await provider.refresh(existing_payload, constraints)
        status = refresh_result.get("status")
        if status == "expired":
            offer.is_current = False
            await db.flush()
            await _clear_provider_failures(provider_name, endpoint)
            return None, True, None

        candidate = refresh_result.get("offer")
        if not isinstance(candidate, dict):
            raise OfferProviderNonRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "refresh result does not include offer payload",
                {"provider": provider_name},
            )

        if kind == OfferKind.TRANSPORT:
            created = await _create_transport_snapshot_from_candidate(
                db,
                trip_id=offer.trip_id,
                trip_day_id=offer.trip_day_id,
                request_fingerprint=request_fingerprint,
                candidate=candidate,
            )
            await OfferRepository.mark_transport_offer_superseded(
                db,
                previous_offer_id=offer.id,
                new_offer_id=created.id,
            )
        else:
            created = await _create_lodging_snapshot_from_candidate(
                db,
                trip_id=offer.trip_id,
                trip_day_id=offer.trip_day_id,
                request_fingerprint=request_fingerprint,
                candidate=candidate,
            )
            await OfferRepository.mark_lodging_offer_superseded(
                db,
                previous_offer_id=offer.id,
                new_offer_id=created.id,
            )

        await _clear_provider_failures(provider_name, endpoint)
        return str(created.id), False, None
    except OfferProviderLimitedError as exc:
        await _record_provider_failure(provider_name, endpoint)
        return (
            None,
            False,
            {
                "provider": provider_name,
                "code": exc.code,
                "message": exc.message,
                "details": exc.details,
            },
        )
    except OfferProviderRetryableError as exc:
        await _record_provider_failure(provider_name, endpoint)
        raise RetryableJobError(exc.code, exc.message, exc.details) from exc
    except OfferProviderNonRetryableError as exc:
        return (
            None,
            False,
            {
                "provider": provider_name,
                "code": exc.code,
                "message": exc.message,
                "details": exc.details,
            },
        )


async def _execute_refresh_single(
    db: AsyncSession,
    *,
    payload: dict[str, Any],
) -> OffersExecutionResult:
    user_id = _as_uuid(payload.get("user_id"), field="user_id")
    offer_id = _as_uuid(payload.get("offer_id"), field="offer_id")
    kind = _as_kind(payload.get("offer_kind"), required=True)
    constraints = payload.get("constraints") or {}
    if not isinstance(constraints, dict):
        raise NonRetryableJobError("JOB_PAYLOAD_INVALID", "constraints must be an object")

    offer = await OfferRepository.get_offer_for_user(
        db,
        user_id=user_id,
        offer_kind=kind,
        offer_id=offer_id,
    )

    refreshed_id, expired, error = await _refresh_one_offer(
        db,
        kind=kind,
        offer=offer,
        constraints=constraints,
        request_fingerprint=payload.get("request_fingerprint"),
    )
    if error:
        raise NonRetryableJobError(
            error.get("code", "UPSTREAM_PROVIDER_ERROR"),
            error.get("message", "Offer refresh failed"),
            error,
        )

    summary = {
        "refreshed": 1 if refreshed_id else 0,
        "expired": 1 if expired else 0,
        "failed": 0,
    }
    return OffersExecutionResult(
        summary=summary,
        offer_ids=[refreshed_id] if refreshed_id else [],
        errors=[],
    )


async def _execute_refresh_trip(
    db: AsyncSession,
    *,
    payload: dict[str, Any],
) -> OffersExecutionResult:
    user_id = _as_uuid(payload.get("user_id"), field="user_id")
    trip_id = _as_uuid(payload.get("trip_id"), field="trip_id")
    kind = _as_kind(payload.get("offer_kind"), required=False)
    current_only = bool(payload.get("current_only", True))
    constraints = payload.get("constraints") or {}
    if not isinstance(constraints, dict):
        raise NonRetryableJobError("JOB_PAYLOAD_INVALID", "constraints must be an object")

    offers = await OfferRepository.get_trip_offers_for_refresh(
        db,
        user_id=user_id,
        trip_id=trip_id,
        offer_kind=kind,
        current_only=current_only,
    )

    refreshed = 0
    expired = 0
    failed = 0
    ids: list[str] = []
    errors: list[dict[str, Any]] = []

    for item_kind, offer in offers:
        refreshed_id, was_expired, error = await _refresh_one_offer(
            db,
            kind=item_kind,
            offer=offer,
            constraints=constraints,
            request_fingerprint=payload.get("request_fingerprint"),
        )
        if error:
            failed += 1
            errors.append(error)
            continue
        if refreshed_id:
            refreshed += 1
            ids.append(refreshed_id)
        if was_expired:
            expired += 1

    summary = {
        "scanned": len(offers),
        "refreshed": refreshed,
        "expired": expired,
        "failed": failed,
    }
    return OffersExecutionResult(summary=summary, offer_ids=ids, errors=errors)


async def _execute_expire_cleanup(db: AsyncSession) -> OffersExecutionResult:
    now = datetime.now(UTC)
    transport_result = await db.execute(
        update(TransportOffer)
        .where(TransportOffer.is_current.is_(True))
        .where(TransportOffer.expires_at <= now)
        .values(is_current=False)
    )
    lodging_result = await db.execute(
        update(LodgingOffer)
        .where(LodgingOffer.is_current.is_(True))
        .where(LodgingOffer.expires_at <= now)
        .values(is_current=False)
    )
    summary = {
        "transport_expired": int(transport_result.rowcount or 0),
        "lodging_expired": int(lodging_result.rowcount or 0),
    }
    return OffersExecutionResult(summary=summary, offer_ids=[], errors=[])


async def execute_offers_job(db: AsyncSession, job: Job) -> OffersExecutionResult:
    payload = job.payload_json
    if not isinstance(payload, dict):
        raise NonRetryableJobError("JOB_PAYLOAD_INVALID", "Job payload must be an object")

    if job.job_type == "offers.search.transport":
        return await _execute_search_job(db, kind=OfferKind.TRANSPORT, payload=payload)
    if job.job_type == "offers.search.lodging":
        return await _execute_search_job(db, kind=OfferKind.LODGING, payload=payload)
    if job.job_type == "offers.refresh.single":
        return await _execute_refresh_single(db, payload=payload)
    if job.job_type == "offers.refresh.trip":
        return await _execute_refresh_trip(db, payload=payload)
    if job.job_type == "offers.expire.cleanup":
        return await _execute_expire_cleanup(db)

    raise NonRetryableJobError("JOB_TYPE_NOT_SUPPORTED", "Unsupported offers job type")
