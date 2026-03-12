from __future__ import annotations

import asyncio
import uuid

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import Response
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.redis_helpers import cache_delete_prefix
from app.config import get_settings
from app.db.repositories import AuditRepository, TripAssetRepository
from app.db.session import get_db_session, get_redis
from app.errors import ServiceUnavailableError, ValidationApiError
from app.models.assets import TripAssetListResponse, TripAssetResponse
from app.security.dependencies import AuthContext, get_auth_context
from app.services.trip_assets import (
    build_trip_asset_access_urls,
    delete_trip_asset_objects,
    prepare_trip_asset_upload,
    trip_asset_record_payload,
    upload_prepared_trip_asset,
)

router = APIRouter(tags=["assets"])


def _storage_unavailable(exc: Exception) -> ServiceUnavailableError:
    return ServiceUnavailableError(
        code="OBJECT_STORAGE_UNAVAILABLE",
        message="RustFS object storage is unavailable",
        details={"provider": "rustfs", "error": exc.__class__.__name__},
    )


async def _invalidate_trip_asset_caches(redis: Redis) -> None:
    await cache_delete_prefix(redis, "trip:asset:")
    await cache_delete_prefix(redis, "trip:get:")
    await cache_delete_prefix(redis, "trip:list:")
    await cache_delete_prefix(redis, "audit:list:")


def _trip_asset_response(item) -> TripAssetResponse:
    preview_url, download_url = build_trip_asset_access_urls(
        object_key=item.object_key,
        thumbnail_object_key=item.thumbnail_object_key,
        original_filename=item.original_filename,
    )
    return TripAssetResponse.model_validate(
        trip_asset_record_payload(item)
        | {
            "preview_url": preview_url,
            "download_url": download_url,
        }
    )


@router.post("/trips/{trip_id}/assets", response_model=TripAssetResponse, status_code=201)
async def create_trip_asset(
    trip_id: uuid.UUID,
    request: Request,
    file: UploadFile = File(...),
    activity_id: uuid.UUID | None = Form(default=None),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> TripAssetResponse:
    settings = get_settings()
    filename = (file.filename or "").strip()
    if not filename:
        raise ValidationApiError("Uploaded file must have a filename")

    await TripAssetRepository.validate_trip_asset_scope(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        activity_id=activity_id,
    )

    content = await file.read(settings.object_storage_max_upload_bytes + 1)
    await file.close()
    if not content:
        raise ValidationApiError("Uploaded file is empty")
    if len(content) > settings.object_storage_max_upload_bytes:
        raise ValidationApiError(
            "Uploaded file exceeds the maximum allowed size",
            {"max_bytes": settings.object_storage_max_upload_bytes},
        )

    asset_id = uuid.uuid4()
    prepared = prepare_trip_asset_upload(
        user_id=auth.user_id,
        trip_id=trip_id,
        asset_id=asset_id,
        original_filename=filename,
        content_type=file.content_type,
        content=content,
    )

    try:
        await asyncio.to_thread(upload_prepared_trip_asset, prepared)
        item = await TripAssetRepository.create_trip_asset(
            db,
            asset_id=asset_id,
            user_id=auth.user_id,
            trip_id=trip_id,
            activity_id=activity_id,
            kind=prepared.kind,
            original_filename=filename,
            content_type=prepared.content_type,
            size_bytes=prepared.size_bytes,
            sha256=prepared.sha256,
            object_key=prepared.object_key,
            thumbnail_object_key=prepared.thumbnail_object_key,
            image_width=prepared.image_width,
            image_height=prepared.image_height,
        )
    except (BotoCoreError, ClientError, OSError) as exc:
        raise _storage_unavailable(exc) from exc
    except Exception:
        try:
            await asyncio.to_thread(
                delete_trip_asset_objects,
                object_key=prepared.object_key,
                thumbnail_object_key=prepared.thumbnail_object_key,
            )
        except Exception:
            pass
        raise

    response = _trip_asset_response(item)
    await AuditRepository.create_entry(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        entity_type="trip_asset",
        entity_id=item.id,
        action="CREATE",
        before=None,
        after=trip_asset_record_payload(item),
        correlation_id=getattr(request.state, "trace_id", None),
        request_path=str(request.url.path),
    )
    await _invalidate_trip_asset_caches(redis)
    return response


@router.get("/trips/{trip_id}/assets", response_model=TripAssetListResponse)
async def list_trip_assets(
    trip_id: uuid.UUID,
    activity_id: uuid.UUID | None = Query(default=None),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
) -> TripAssetListResponse:
    await TripAssetRepository.validate_trip_asset_scope(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        activity_id=activity_id,
    )
    items = await TripAssetRepository.list_trip_assets(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        activity_id=activity_id,
    )
    try:
        responses = [_trip_asset_response(item) for item in items]
    except (BotoCoreError, ClientError, OSError) as exc:
        raise _storage_unavailable(exc) from exc
    return TripAssetListResponse(total=len(responses), items=responses)


@router.get("/assets/{asset_id}", response_model=TripAssetResponse)
async def get_trip_asset(
    asset_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
) -> TripAssetResponse:
    item = await TripAssetRepository.get_trip_asset(
        db,
        asset_id=asset_id,
        user_id=auth.user_id,
    )
    try:
        return _trip_asset_response(item)
    except (BotoCoreError, ClientError, OSError) as exc:
        raise _storage_unavailable(exc) from exc


@router.delete("/assets/{asset_id}", status_code=204)
async def delete_trip_asset(
    asset_id: uuid.UUID,
    request: Request,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> Response:
    item = await TripAssetRepository.get_trip_asset(
        db,
        asset_id=asset_id,
        user_id=auth.user_id,
    )
    before = trip_asset_record_payload(item)
    try:
        await asyncio.to_thread(
            delete_trip_asset_objects,
            object_key=item.object_key,
            thumbnail_object_key=item.thumbnail_object_key,
        )
    except (BotoCoreError, ClientError, OSError) as exc:
        raise _storage_unavailable(exc) from exc

    await TripAssetRepository.delete_trip_asset(
        db,
        asset_id=asset_id,
        user_id=auth.user_id,
    )
    await AuditRepository.create_entry(
        db,
        user_id=auth.user_id,
        trip_id=item.trip_id,
        entity_type="trip_asset",
        entity_id=item.id,
        action="DELETE",
        before=before,
        after=None,
        correlation_id=getattr(request.state, "trace_id", None),
        request_path=str(request.url.path),
    )
    await _invalidate_trip_asset_caches(redis)
    return Response(status_code=204)
