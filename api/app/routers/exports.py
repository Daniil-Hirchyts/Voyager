import mimetypes
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import FileResponse, JSONResponse
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
from app.db.models import JobStatus
from app.db.repositories import ExportRepository, JobRepository, TripRepository
from app.db.session import get_db_session, get_redis
from app.errors import ConflictError, NotFoundError
from app.models.exports import ExportResponse, TripExportCreateRequest
from app.models.jobs import JobAcceptedResponse
from app.rate_limit.limiter import limit_user_request
from app.routers.utils import parse_if_match, payload_fingerprint
from app.security.dependencies import AuthContext, get_auth_context

router = APIRouter(tags=["exports"])


def _job_accepted(job_id: uuid.UUID) -> JobAcceptedResponse:
    return JobAcceptedResponse(job_id=job_id, status="PENDING", poll_url=f"/jobs/{job_id}")


def _to_export_response(*, export, job) -> ExportResponse:
    status = job.status.value if hasattr(job.status, "value") else str(job.status)
    download_url = None
    if status == JobStatus.SUCCEEDED.value and export.file_path and not export.deleted_at:
        download_url = f"/exports/{export.id}/content"
    return ExportResponse(
        id=export.id,
        job_id=export.job_id,
        user_id=export.user_id,
        trip_id=export.trip_id,
        format=export.format,
        status=status,
        trip_version=export.trip_version,
        content_type=export.content_type,
        size_bytes=export.size_bytes,
        sha256=export.sha256,
        error=export.error_json or job.error_json,
        created_at=export.created_at,
        finished_at=export.finished_at,
        expires_at=export.expires_at,
        deleted_at=export.deleted_at,
        download_url=download_url,
    )


@router.post("/trips/{trip_id}/exports", response_model=JobAcceptedResponse, status_code=202)
async def submit_trip_export(
    trip_id: uuid.UUID,
    payload: TripExportCreateRequest,
    request: Request,
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
        "exports:submit",
        settings.rate_limit_export_submit_per_hour,
        window_seconds=3600,
    )

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
            "format": payload.format.value,
            "expected_trip_version": expected_version,
        }
    )
    idem = IdempotencyService(redis)
    replay = await idem.check_or_replay(
        user_id=str(auth.user_id),
        method="POST",
        path=f"/trips/{trip_id}/exports",
        idempotency_key=idempotency_key,
        fingerprint=fingerprint,
    )
    if replay:
        return JSONResponse(status_code=replay["status_code"], content=replay["response_body"])

    export_id = uuid.uuid4()
    job = await JobRepository.create_job(
        db,
        auth.user_id,
        job_type=f"export.generate.{payload.format.value}",
        payload={
            "export_id": str(export_id),
            "trip_id": str(trip_id),
            "user_id": str(auth.user_id),
            "format": payload.format.value,
            "expected_trip_version": expected_version,
            "trace_id": getattr(request.state, "trace_id", None),
        },
        max_attempts=settings.job_max_attempts,
    )
    await ExportRepository.create_export(
        db,
        export_id=export_id,
        job_id=job.id,
        user_id=auth.user_id,
        trip_id=trip_id,
        format=payload.format.value,
        trip_version=expected_version,
        expires_at=datetime.now(UTC) + timedelta(days=settings.export_retention_days),
    )

    response = _job_accepted(job.id)
    if idempotency_key:
        await idem.store_response(
            user_id=str(auth.user_id),
            method="POST",
            path=f"/trips/{trip_id}/exports",
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            status_code=202,
            response_body=response.model_dump(mode="json"),
        )
    await cache_delete_prefix(redis, "export:get:")
    return response


@router.get("/exports/{export_id}", response_model=ExportResponse)
async def get_export_metadata(
    export_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> ExportResponse:
    cache_key = "export:get:" + build_cache_key(str(auth.user_id), str(export_id))
    cached = await cache_get_json(redis, cache_key)
    if cached:
        return ExportResponse.model_validate(cached)

    export, job = await ExportRepository.get_export_for_user(
        db,
        export_id=export_id,
        user_id=auth.user_id,
    )
    response = _to_export_response(export=export, job=job)
    await cache_set_json(
        redis,
        cache_key,
        response.model_dump(mode="json"),
        get_settings().export_cache_ttl_sec,
    )
    return response


@router.get("/exports/{export_id}/content")
async def download_export_content(
    export_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
) -> FileResponse:
    export, job = await ExportRepository.get_export_for_user(
        db,
        export_id=export_id,
        user_id=auth.user_id,
    )
    if (job.status.value if hasattr(job.status, "value") else str(job.status)) != JobStatus.SUCCEEDED.value:
        raise ConflictError(
            code="EXPORT_NOT_READY",
            message="Export artifact is not ready",
            details={"status": job.status.value if hasattr(job.status, "value") else str(job.status)},
        )
    if export.deleted_at is not None:
        raise NotFoundError("Export artifact has expired")
    if not export.file_path:
        raise NotFoundError("Export artifact path is missing")

    file_path = Path(export.file_path)
    if not file_path.exists():
        raise NotFoundError("Export artifact file not found")

    content_type = export.content_type or mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    filename = f"trip-{export.trip_id}-v{export.trip_version}.{export.format}"
    response = FileResponse(file_path, media_type=content_type)
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    response.headers["Cache-Control"] = "no-store"
    return response
