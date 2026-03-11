import json
import logging
import uuid

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
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
from app.db.repositories import JobRepository, PlacePhotoRepository, PlaceRepository
from app.db.session import get_db_session, get_redis
from app.errors import NotFoundError, ServiceUnavailableError, ValidationApiError
from app.models.jobs import JobAcceptedResponse
from app.models.places import (
    DestinationAutocompleteResponse,
    GooglePlaceCandidate,
    GooglePlaceDetailResponse,
    GooglePlaceSearchResponse,
    PlaceCreateRequest,
    PlaceDedupRunRequest,
    PlaceListResponse,
    PlaceMergeRequest,
    PlaceMergeResponse,
    PlaceMetadataPatchRequest,
    PlacePhotoListResponse,
    PlaceResponse,
)
from app.rate_limit.limiter import limit_user_request
from app.routers.utils import payload_fingerprint
from app.security.dependencies import (
    AuthContext,
    get_admin_auth_context,
    get_auth_context,
)
from app.services.google_maps import (
    GoogleMapsNotConfiguredError,
    fetch_google_place_detail,
    fetch_google_place_photo_asset,
    GoogleMapsRequestError,
    geocode_address,
    lookup_google_place,
    resolve_time_zone,
    search_google_places,
    validate_address,
)
from app.services.place_autocomplete import search_destination_suggestions
from app.services.place_photo_assets import ensure_place_photo_asset

router = APIRouter(prefix="/places", tags=["places"])
logger = logging.getLogger(__name__)


def _quantize(value: float) -> str:
    return f"{value:.4f}"


async def _invalidate_place_caches(redis: Redis) -> None:
    await cache_delete_prefix(redis, "place:list:")
    await cache_delete_prefix(redis, "place:get:")
    await cache_delete_prefix(redis, "place:photos:get:")
    await cache_delete_prefix(redis, "place:search:v1:")
    await cache_delete_prefix(redis, "place:nearby:v1:")
    await cache_delete_prefix(redis, "place:viewport:v1:")


def _place_response_from_place(
    place,
    *,
    distance_m: float | None = None,
    photo_count: int = 0,
    primary_photo=None,
) -> PlaceResponse:
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
        distance_m=distance_m,
        created_at=place.created_at,
        updated_at=place.updated_at,
    )


def _place_response_from_row(
    row: dict,
    *,
    photo_count: int = 0,
    primary_photo=None,
) -> PlaceResponse:
    canonical_place_id = row.get("canonical_place_id")
    distance_m = row.get("distance_m")
    if distance_m is not None:
        distance_m = float(distance_m)
    metadata = row.get("metadata_json") or {}
    if isinstance(metadata, str):
        metadata = json.loads(metadata)
    return PlaceResponse(
        id=row["id"],
        source=row["source"],
        external_id=row.get("external_id"),
        name=row["name"],
        category=row.get("category"),
        address_text=row.get("address_text"),
        lat=row.get("lat"),
        lon=row.get("lon"),
        metadata=metadata,
        canonical_place_id=canonical_place_id,
        is_canonical=canonical_place_id is None,
        dedup_confidence=row.get("dedup_confidence"),
        merged_at=row.get("merged_at"),
        photo_count=photo_count,
        primary_photo=primary_photo,
        distance_m=distance_m,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _job_accepted(job_id: uuid.UUID) -> JobAcceptedResponse:
    return JobAcceptedResponse(job_id=job_id, status="PENDING", poll_url=f"/jobs/{job_id}")


def _merge_metadata(*items: dict | None) -> dict:
    merged: dict = {}
    for item in items:
        if isinstance(item, dict):
            merged.update(item)
    return merged


def _service_unavailable_for_google() -> ServiceUnavailableError:
    return ServiceUnavailableError(
        code="INTEGRATION_NOT_CONFIGURED",
        message="Google Maps integration is unavailable",
        details={"provider": "google_maps"},
    )


async def _enrich_place_payload(payload: PlaceCreateRequest) -> PlaceCreateRequest:
    next_payload = payload.model_copy(deep=True)
    metadata = _merge_metadata(next_payload.metadata)

    try:
        if next_payload.external_id and next_payload.source in {"google_places", "destination"}:
            details = await lookup_google_place(next_payload.external_id)
            if details is not None:
                next_payload.external_id = details.place_id
                next_payload.name = details.name or next_payload.name
                next_payload.category = details.category or next_payload.category
                next_payload.address_text = details.formatted_address or next_payload.address_text
                next_payload.lat = details.lat if details.lat is not None else next_payload.lat
                next_payload.lon = details.lng if details.lng is not None else next_payload.lon
                metadata = _merge_metadata(
                    metadata,
                    details.metadata,
                    {
                        "country": details.country,
                        "region": details.region,
                        "google_place_id": details.place_id,
                        "time_zone_id": details.timezone,
                    },
                )
        else:
            if next_payload.source == "user_custom" and next_payload.address_text:
                validation = await validate_address(next_payload.address_text)
                if validation is not None:
                    next_payload.address_text = validation.formatted_address or next_payload.address_text
                    metadata["google_address_validation"] = validation.metadata
                    if validation.region_code:
                        metadata["region_code"] = validation.region_code

            if next_payload.address_text and (next_payload.lat is None or next_payload.lon is None):
                geocode = await geocode_address(next_payload.address_text)
                if geocode is not None:
                    next_payload.address_text = geocode.formatted_address or next_payload.address_text
                    next_payload.lat = geocode.lat if geocode.lat is not None else next_payload.lat
                    next_payload.lon = geocode.lng if geocode.lng is not None else next_payload.lon
                    metadata = _merge_metadata(
                        metadata,
                        geocode.metadata,
                        {
                            "google_geocode_place_id": geocode.place_id,
                            "country": geocode.country,
                            "region": geocode.region,
                        },
                    )

        if next_payload.lat is not None and next_payload.lon is not None:
            timezone = await resolve_time_zone(lat=next_payload.lat, lng=next_payload.lon)
            if timezone:
                metadata["time_zone_id"] = timezone
    except GoogleMapsNotConfiguredError as exc:
        raise _service_unavailable_for_google() from exc
    except GoogleMapsRequestError:
        logger.warning("place enrichment skipped after Google Maps request failure")

    next_payload.metadata = metadata
    return next_payload


@router.post("", response_model=PlaceResponse, status_code=201)
async def create_place(
    payload: PlaceCreateRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> PlaceResponse | JSONResponse:
    idem = IdempotencyService(redis)
    fingerprint = payload_fingerprint(payload.model_dump(mode="json"))
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path="/places",
        idempotency_key=idempotency_key,
        fingerprint=fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    enriched_payload = await _enrich_place_payload(payload)
    if enriched_payload.external_id:
        place = await PlaceRepository.get_or_create_external_place(
            db,
            source=enriched_payload.source,
            external_id=enriched_payload.external_id,
            name=enriched_payload.name,
            category=enriched_payload.category,
            address_text=enriched_payload.address_text,
            lat=enriched_payload.lat,
            lon=enriched_payload.lon,
            metadata=enriched_payload.metadata,
        )
    else:
        place = await PlaceRepository.create_place(db, enriched_payload)
    response = _place_response_from_place(place, photo_count=0, primary_photo=None)
    await _invalidate_place_caches(redis)

    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path="/places",
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            status_code=201,
            response_body=response.model_dump(mode="json"),
    )
    return response


@router.get("/photos/{photo_id}/asset")
async def get_place_photo_asset(
    photo_id: uuid.UUID,
    variant: str = Query(default="full", pattern="^(full|thumb)$"),
    db: AsyncSession = Depends(get_db_session),
) -> FileResponse:
    photo = await PlacePhotoRepository.get_photo(db, photo_id=photo_id)
    try:
        asset_path = await ensure_place_photo_asset(photo, variant=variant)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Failed to fetch photo asset") from exc
    return FileResponse(asset_path)


@router.get("", response_model=PlaceListResponse)
async def list_places(
    q: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> PlaceListResponse:
    cache_key = "place:list:" + build_cache_key(str(q), str(limit), str(offset))
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return PlaceListResponse.model_validate(cached)

    total, items = await PlaceRepository.search_places(db, q=q, limit=limit, offset=offset)
    summary_map = await PlacePhotoRepository.photo_summaries_for_place_ids(
        db, [item.id for item in items]
    )
    response = PlaceListResponse(
        total=total,
        limit=limit,
        offset=offset,
        items=[
            _place_response_from_place(
                item,
                photo_count=summary_map.get(item.id, (0, None))[0],
                primary_photo=summary_map.get(item.id, (0, None))[1],
            )
            for item in items
        ],
    )
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        get_settings().place_cache_ttl_sec,
    )
    return response


@router.get("/search", response_model=PlaceListResponse)
async def search_places(
    q: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> PlaceListResponse:
    cache_key = "place:search:v1:" + build_cache_key(str(q), str(limit), str(offset))
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return PlaceListResponse.model_validate(cached)

    total, items = await PlaceRepository.search_places(db, q=q, limit=limit, offset=offset)
    summary_map = await PlacePhotoRepository.photo_summaries_for_place_ids(
        db, [item.id for item in items]
    )
    response = PlaceListResponse(
        total=total,
        limit=limit,
        offset=offset,
        items=[
            _place_response_from_place(
                item,
                photo_count=summary_map.get(item.id, (0, None))[0],
                primary_photo=summary_map.get(item.id, (0, None))[1],
            )
            for item in items
        ],
    )
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        get_settings().place_cache_ttl_sec,
    )
    return response


@router.get("/autocomplete", response_model=DestinationAutocompleteResponse)
async def autocomplete_destinations(
    q: str | None = Query(default=None),
    limit: int = Query(default=8, ge=1, le=20),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    redis: Redis = Depends(get_redis),
) -> DestinationAutocompleteResponse:
    settings = get_settings()
    await limit_user_request(
        redis,
        str(auth.user_id),
        "places:autocomplete",
        settings.rate_limit_places_autocomplete_per_min,
    )

    query = (q or "").strip()
    cache_key = "place:autocomplete:v3:" + build_cache_key(query, str(limit), str(offset))
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return DestinationAutocompleteResponse.model_validate(cached)

    fetch_limit = min(limit + offset, 20)
    try:
        suggestions = await search_destination_suggestions(query, fetch_limit)
    except GoogleMapsNotConfiguredError as exc:
        raise _service_unavailable_for_google() from exc
    except GoogleMapsRequestError:
        suggestions = []
    page_items = suggestions[offset : offset + limit]

    response = DestinationAutocompleteResponse(
        total=len(suggestions),
        limit=limit,
        offset=offset,
        items=page_items,
    )
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        settings.place_cache_ttl_sec,
    )
    return response


@router.get("/google-search", response_model=GooglePlaceSearchResponse)
async def google_place_search(
    q: str | None = Query(default=None),
    limit: int = Query(default=8, ge=1, le=20),
    offset: int = Query(default=0, ge=0),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lon: float | None = Query(default=None, ge=-180, le=180),
    radius_m: int | None = Query(default=None, ge=1, le=50_000),
    category: str | None = Query(default=None),
    auth: AuthContext = Depends(get_auth_context),
    redis: Redis = Depends(get_redis),
) -> GooglePlaceSearchResponse:
    settings = get_settings()
    await limit_user_request(
        redis,
        str(auth.user_id),
        "places:autocomplete",
        settings.rate_limit_places_autocomplete_per_min,
    )

    query = (q or "").strip()
    cache_key = "place:google-search:v2:" + build_cache_key(
        query,
        str(limit),
        str(offset),
        _quantize(lat) if lat is not None else "",
        _quantize(lon) if lon is not None else "",
        str(radius_m or ""),
        category or "",
    )
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return GooglePlaceSearchResponse.model_validate(cached)

    try:
        fetch_limit = min(limit + offset, 20)
        items = await search_google_places(
            query,
            fetch_limit,
            lat=lat,
            lng=lon,
            radius_m=radius_m,
            category=category,
        )
    except GoogleMapsNotConfiguredError as exc:
        raise _service_unavailable_for_google() from exc
    except GoogleMapsRequestError as exc:
        raise HTTPException(status_code=502, detail="Google Places search failed") from exc

    page_items = items[offset : offset + limit]
    response = GooglePlaceSearchResponse(
        total=len(items),
        limit=limit,
        offset=offset,
        items=page_items,
    )
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        settings.place_cache_ttl_sec,
    )
    return response


@router.get("/google-photo-asset")
async def get_google_place_photo_asset(
    name: str = Query(min_length=1),
    max_width_px: int = Query(default=1600, ge=1, le=2400),
) -> Response:
    try:
        content, content_type = await fetch_google_place_photo_asset(
            name, max_width_px=max_width_px
        )
    except GoogleMapsNotConfiguredError as exc:
        raise _service_unavailable_for_google() from exc
    except GoogleMapsRequestError as exc:
        raise HTTPException(status_code=502, detail="Google Place photo lookup failed") from exc

    response = Response(content=content, media_type=content_type or "image/jpeg")
    response.headers["Cache-Control"] = "public, max-age=86400"
    return response


@router.get("/google/{place_id}", response_model=GooglePlaceCandidate)
async def get_google_place(
    place_id: str,
    auth: AuthContext = Depends(get_auth_context),
    redis: Redis = Depends(get_redis),
) -> GooglePlaceCandidate:
    settings = get_settings()
    await limit_user_request(
        redis,
        str(auth.user_id),
        "places:autocomplete",
        settings.rate_limit_places_autocomplete_per_min,
    )
    cache_key = "place:google:get:" + build_cache_key(place_id)
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return GooglePlaceCandidate.model_validate(cached)

    try:
        details = await lookup_google_place(place_id)
    except GoogleMapsNotConfiguredError as exc:
        raise _service_unavailable_for_google() from exc
    except GoogleMapsRequestError as exc:
        raise HTTPException(status_code=502, detail="Google Place lookup failed") from exc

    if details is None:
        raise NotFoundError("Google Place not found")

    response = GooglePlaceCandidate.model_validate(
        {
            "place_id": details.place_id,
            "label": details.formatted_address or details.name or details.place_id,
            "name": details.name or details.place_id,
            "address_text": details.formatted_address,
            "category": details.category,
            "country": details.country,
            "region": details.region,
            "lat": details.lat,
            "lon": details.lng,
            "timezone": details.timezone,
            "metadata": details.metadata,
        }
    )
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        settings.place_cache_ttl_sec,
    )
    return response


@router.get("/google/{place_id}/detail", response_model=GooglePlaceDetailResponse)
async def get_google_place_detail(
    place_id: str,
    auth: AuthContext = Depends(get_auth_context),
    redis: Redis = Depends(get_redis),
) -> GooglePlaceDetailResponse:
    settings = get_settings()
    await limit_user_request(
        redis,
        str(auth.user_id),
        "places:autocomplete",
        settings.rate_limit_places_autocomplete_per_min,
    )
    cache_key = "place:google:detail:get:" + build_cache_key(place_id)
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return GooglePlaceDetailResponse.model_validate(cached)

    try:
        details = await fetch_google_place_detail(place_id)
    except GoogleMapsNotConfiguredError as exc:
        raise _service_unavailable_for_google() from exc
    except GoogleMapsRequestError as exc:
        raise HTTPException(status_code=502, detail="Google Place detail lookup failed") from exc

    if details is None:
        raise NotFoundError("Google Place not found")

    response = GooglePlaceDetailResponse(
        place=details.place,
        summary=details.summary,
        rating=details.rating,
        review_count=details.review_count,
        status_text=details.status_text,
        price_label=details.price_label,
        photos=details.photos,
        reviews=details.reviews,
        hours=details.hours,
        booking_links=details.booking_links,
        tags=details.tags,
        mentions=details.mentions,
    )
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        settings.place_cache_ttl_sec,
    )
    return response


@router.get("/nearby", response_model=PlaceListResponse)
async def nearby_places(
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=180),
    radius_m: int = Query(default=1000, ge=1, le=50_000),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> PlaceListResponse:
    settings = get_settings()
    await limit_user_request(
        redis,
        str(auth.user_id),
        "places:geo",
        settings.rate_limit_places_geo_per_min,
    )

    cache_key = "place:nearby:v1:" + build_cache_key(
        _quantize(lat),
        _quantize(lon),
        str(radius_m),
        str(limit),
        str(offset),
    )
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return PlaceListResponse.model_validate(cached)

    total, rows = await PlaceRepository.nearby_places(
        db,
        lat=lat,
        lon=lon,
        radius_m=radius_m,
        limit=limit,
        offset=offset,
    )
    summary_map = await PlacePhotoRepository.photo_summaries_for_place_ids(
        db, [row["id"] for row in rows]
    )
    response = PlaceListResponse(
        total=total,
        limit=limit,
        offset=offset,
        items=[
            _place_response_from_row(
                row,
                photo_count=summary_map.get(row["id"], (0, None))[0],
                primary_photo=summary_map.get(row["id"], (0, None))[1],
            )
            for row in rows
        ],
    )
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        settings.place_cache_ttl_sec,
    )
    return response


@router.get("/viewport", response_model=PlaceListResponse)
async def viewport_places(
    min_lat: float = Query(ge=-90, le=90),
    min_lon: float = Query(ge=-180, le=180),
    max_lat: float = Query(ge=-90, le=90),
    max_lon: float = Query(ge=-180, le=180),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> PlaceListResponse:
    if min_lat >= max_lat or min_lon >= max_lon:
        raise ValidationApiError("Invalid viewport bounds: min must be strictly lower than max")

    settings = get_settings()
    await limit_user_request(
        redis,
        str(auth.user_id),
        "places:geo",
        settings.rate_limit_places_geo_per_min,
    )

    cache_key = "place:viewport:v1:" + build_cache_key(
        _quantize(min_lat),
        _quantize(min_lon),
        _quantize(max_lat),
        _quantize(max_lon),
        str(limit),
        str(offset),
    )
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return PlaceListResponse.model_validate(cached)

    total, rows = await PlaceRepository.viewport_places(
        db,
        min_lat=min_lat,
        min_lon=min_lon,
        max_lat=max_lat,
        max_lon=max_lon,
        limit=limit,
        offset=offset,
    )
    summary_map = await PlacePhotoRepository.photo_summaries_for_place_ids(
        db, [row["id"] for row in rows]
    )
    response = PlaceListResponse(
        total=total,
        limit=limit,
        offset=offset,
        items=[
            _place_response_from_row(
                row,
                photo_count=summary_map.get(row["id"], (0, None))[0],
                primary_photo=summary_map.get(row["id"], (0, None))[1],
            )
            for row in rows
        ],
    )
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        settings.place_cache_ttl_sec,
    )
    return response


@router.get("/{place_id}", response_model=PlaceResponse)
async def get_place(
    place_id: uuid.UUID,
    _auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> PlaceResponse:
    cache_key = "place:get:" + build_cache_key(str(place_id))
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return PlaceResponse.model_validate(cached)

    place = await PlaceRepository.get_place(db, place_id)
    photo_count, primary_photo = await PlacePhotoRepository.get_photo_summary(
        db,
        place_id=place.id,
    )
    response = _place_response_from_place(
        place,
        photo_count=photo_count,
        primary_photo=primary_photo,
    )
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        get_settings().place_cache_ttl_sec,
    )
    return response


@router.get("/{place_id}/photos", response_model=PlacePhotoListResponse)
async def list_place_photos(
    place_id: uuid.UUID,
    _auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> PlacePhotoListResponse:
    cache_key = "place:photos:get:" + build_cache_key(str(place_id))
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return PlacePhotoListResponse.model_validate(cached)

    photos = await PlacePhotoRepository.list_photos(db, place_id=place_id)
    response = PlacePhotoListResponse(
        total=len(photos),
        items=[PlacePhotoRepository.to_response(item) for item in photos],
    )
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        get_settings().place_photo_cache_ttl_sec,
    )
    return response


@router.post("/{place_id}/photos/refresh", response_model=JobAcceptedResponse, status_code=202)
async def refresh_place_photos(
    place_id: uuid.UUID,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> JobAcceptedResponse | JSONResponse:
    await PlaceRepository.get_place(db, place_id)
    idem = IdempotencyService(redis)
    fingerprint = payload_fingerprint({"place_id": str(place_id)})
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path=f"/places/{place_id}/photos/refresh",
        idempotency_key=idempotency_key,
        fingerprint=fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    job = await JobRepository.create_job(
        db,
        auth.user_id,
        job_type="places.photos.refresh",
        payload={
            "place_id": str(place_id),
            "user_id": str(auth.user_id),
            "trace_id": getattr(request.state, "trace_id", None),
        },
        max_attempts=get_settings().job_max_attempts,
    )
    response = _job_accepted(job.id)
    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path=f"/places/{place_id}/photos/refresh",
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            status_code=202,
            response_body=response.model_dump(mode="json"),
        )
    return response


@router.patch("/{place_id}", response_model=PlaceResponse)
async def patch_place_metadata(
    place_id: uuid.UUID,
    payload: PlaceMetadataPatchRequest,
    _admin: AuthContext = Depends(get_admin_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> PlaceResponse:
    place = await PlaceRepository.patch_metadata(
        db, place_id=place_id, metadata_patch=payload.metadata
    )
    await _invalidate_place_caches(redis)
    photo_count, primary_photo = await PlacePhotoRepository.get_photo_summary(
        db,
        place_id=place.id,
    )
    return _place_response_from_place(
        place,
        photo_count=photo_count,
        primary_photo=primary_photo,
    )


@router.post("/{place_id}/merge", response_model=PlaceMergeResponse, status_code=200)
async def merge_places(
    place_id: uuid.UUID,
    payload: PlaceMergeRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    auth: AuthContext = Depends(get_admin_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> PlaceMergeResponse | JSONResponse:
    idem = IdempotencyService(redis)
    fingerprint = payload_fingerprint(
        payload.model_dump(mode="json") | {"target_place_id": str(place_id)}
    )
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path=f"/places/{place_id}/merge",
        idempotency_key=idempotency_key,
        fingerprint=fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    result = await PlaceRepository.merge_places(
        db,
        canonical_place_id=place_id,
        source_place_ids=payload.source_place_ids,
        dedup_confidence=payload.dedup_confidence,
    )
    await _invalidate_place_caches(redis)
    response = PlaceMergeResponse(**result)

    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path=f"/places/{place_id}/merge",
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            status_code=200,
            response_body=response.model_dump(mode="json"),
        )
    return response


@router.post("/dedup/run", response_model=JobAcceptedResponse, status_code=202)
async def run_places_dedup(
    payload: PlaceDedupRunRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    auth: AuthContext = Depends(get_admin_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> JobAcceptedResponse | JSONResponse:
    settings = get_settings()
    await limit_user_request(
        redis,
        str(auth.user_id),
        "places:dedup:submit",
        settings.rate_limit_places_dedup_per_hour,
        window_seconds=3600,
    )

    idem = IdempotencyService(redis)
    fingerprint = payload_fingerprint(payload.model_dump(mode="json"))
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path="/places/dedup/run",
        idempotency_key=idempotency_key,
        fingerprint=fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    job = await JobRepository.create_job(
        db,
        auth.user_id,
        job_type="places.dedup.run",
        payload={
            "user_id": str(auth.user_id),
            "submitted_by": str(auth.user_id),
            "radius_m": payload.radius_m,
            "max_groups": payload.max_groups,
            "dedup_confidence": 0.95,
        },
        max_attempts=settings.job_max_attempts,
    )
    response = _job_accepted(job.id)
    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path="/places/dedup/run",
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            status_code=202,
            response_body=response.model_dump(mode="json"),
        )
    return response
