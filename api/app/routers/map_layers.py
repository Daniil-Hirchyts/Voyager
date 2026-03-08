import uuid

from fastapi import APIRouter, Depends, Header, Query, Request, Response
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
from app.db.repositories import AuditRepository, TripMapLayerRepository
from app.db.session import get_db_session, get_redis
from app.models.map_layers import (
    TripMapLayerCreateRequest,
    TripMapLayerListResponse,
    TripMapLayerPatchRequest,
    TripMapLayerResponse,
)
from app.routers.utils import payload_fingerprint
from app.security.dependencies import AuthContext, get_auth_context

router = APIRouter(prefix="/trips/{trip_id}/map-layers", tags=["map-layers"])


def _map_layer_response(item) -> TripMapLayerResponse:
    return TripMapLayerResponse(
        id=item.id,
        trip_id=item.trip_id,
        name=item.name,
        source=item.source,
        renderer=item.renderer,
        feature_collection=item.feature_collection_json,
        style=item.style_json,
        metadata=item.metadata_json,
        is_visible=item.is_visible,
        is_locked=item.is_locked,
        order_index=item.order_index,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


async def _invalidate_trip_map_layer_caches(redis: Redis) -> None:
    await cache_delete_prefix(redis, "trip:map-layer:list:")
    await cache_delete_prefix(redis, "trip:map-layer:get:")
    await cache_delete_prefix(redis, "audit:list:")


@router.get("", response_model=TripMapLayerListResponse)
async def list_trip_map_layers(
    trip_id: uuid.UUID,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> TripMapLayerListResponse:
    cache_key = "trip:map-layer:list:" + build_cache_key(
        str(auth.user_id), str(trip_id), str(limit), str(offset)
    )
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return TripMapLayerListResponse.model_validate(cached)

    total, items = await TripMapLayerRepository.list_trip_map_layers(
        db, user_id=auth.user_id, trip_id=trip_id, limit=limit, offset=offset
    )
    response = TripMapLayerListResponse(
        total=total,
        limit=limit,
        offset=offset,
        items=[_map_layer_response(item) for item in items],
    )
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        get_settings().trip_cache_ttl_sec,
    )
    return response


@router.post("", response_model=TripMapLayerResponse, status_code=201)
async def create_trip_map_layer(
    trip_id: uuid.UUID,
    payload: TripMapLayerCreateRequest,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> TripMapLayerResponse | JSONResponse:
    idem = IdempotencyService(redis)
    fingerprint = payload_fingerprint(payload.model_dump(mode="json"))
    path = f"/trips/{trip_id}/map-layers"
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path=path,
        idempotency_key=idempotency_key,
        fingerprint=fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    item = await TripMapLayerRepository.create_trip_map_layer(
        db, user_id=auth.user_id, trip_id=trip_id, payload=payload
    )
    response = _map_layer_response(item)
    await AuditRepository.create_entry(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        entity_type="trip_map_layer",
        entity_id=item.id,
        action="CREATE",
        before=None,
        after=response.model_dump(mode="json"),
        correlation_id=getattr(request.state, "trace_id", None),
        request_path=str(request.url.path),
    )
    await _invalidate_trip_map_layer_caches(redis)

    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path=path,
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            status_code=201,
            response_body=response.model_dump(mode="json"),
        )

    return response


@router.get("/{layer_id}", response_model=TripMapLayerResponse)
async def get_trip_map_layer(
    trip_id: uuid.UUID,
    layer_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> TripMapLayerResponse:
    cache_key = "trip:map-layer:get:" + build_cache_key(
        str(auth.user_id), str(trip_id), str(layer_id)
    )
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return TripMapLayerResponse.model_validate(cached)

    item = await TripMapLayerRepository.get_trip_map_layer(
        db, user_id=auth.user_id, trip_id=trip_id, layer_id=layer_id
    )
    response = _map_layer_response(item)
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        get_settings().trip_cache_ttl_sec,
    )
    return response


@router.patch("/{layer_id}", response_model=TripMapLayerResponse)
async def patch_trip_map_layer(
    trip_id: uuid.UUID,
    layer_id: uuid.UUID,
    payload: TripMapLayerPatchRequest,
    request: Request,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> TripMapLayerResponse:
    before = _map_layer_response(
        await TripMapLayerRepository.get_trip_map_layer(
            db, user_id=auth.user_id, trip_id=trip_id, layer_id=layer_id
        )
    )
    item = await TripMapLayerRepository.patch_trip_map_layer(
        db, user_id=auth.user_id, trip_id=trip_id, layer_id=layer_id, payload=payload
    )
    response = _map_layer_response(item)
    await AuditRepository.create_entry(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        entity_type="trip_map_layer",
        entity_id=item.id,
        action="UPDATE",
        before=before.model_dump(mode="json"),
        after=response.model_dump(mode="json"),
        correlation_id=getattr(request.state, "trace_id", None),
        request_path=str(request.url.path),
    )
    await _invalidate_trip_map_layer_caches(redis)
    return response


@router.delete("/{layer_id}", status_code=204)
async def delete_trip_map_layer(
    trip_id: uuid.UUID,
    layer_id: uuid.UUID,
    request: Request,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> Response:
    before = _map_layer_response(
        await TripMapLayerRepository.get_trip_map_layer(
            db, user_id=auth.user_id, trip_id=trip_id, layer_id=layer_id
        )
    )
    await TripMapLayerRepository.delete_trip_map_layer(
        db, user_id=auth.user_id, trip_id=trip_id, layer_id=layer_id
    )
    await AuditRepository.create_entry(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        entity_type="trip_map_layer",
        entity_id=layer_id,
        action="DELETE",
        before=before.model_dump(mode="json"),
        after=None,
        correlation_id=getattr(request.state, "trace_id", None),
        request_path=str(request.url.path),
    )
    await _invalidate_trip_map_layer_caches(redis)
    return Response(status_code=204)
