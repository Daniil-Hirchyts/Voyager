import asyncio
import logging
import uuid
from typing import Any

from app.cache.redis_helpers import build_cache_key, cache_delete, cache_delete_prefix
from app.config import get_settings
from app.db.audit_context import set_audit_context
from app.db.models import Trip
from app.db.repositories import ExportRepository, JobRepository
from app.db.session import AsyncSessionLocal, redis_client
from app.metrics import increment_job_metric
from app.services.export_pipeline import execute_export_job
from app.services.itinerary_generation import (
    NonRetryableJobError,
    RetryableJobError,
    execute_itinerary_job,
)
from app.services.itinerary_optimizer import execute_itinerary_optimization_job
from app.services.place_dedup import execute_places_dedup_job
from app.services.place_photos import execute_place_photo_refresh_job

logger = logging.getLogger(__name__)
settings = get_settings()
RETRY_BACKOFF_SECONDS = (5, 15, 45)


def _retry_backoff(attempts: int) -> int:
    idx = min(max(attempts - 1, 0), len(RETRY_BACKOFF_SECONDS) - 1)
    return RETRY_BACKOFF_SECONDS[idx]


def _error_payload(
    code: str, message: str, details: dict[str, Any] | None = None
) -> dict[str, Any]:
    return {"code": code, "message": message, "details": details or {}}


async def _invalidate_job_cache(*, user_id: uuid.UUID, job_id: uuid.UUID) -> None:
    key = "job:get:" + build_cache_key(str(user_id), str(job_id))
    await cache_delete(redis_client, key)


async def _invalidate_trip_caches() -> None:
    await cache_delete_prefix(redis_client, "trip:get:")
    await cache_delete_prefix(redis_client, "trip:list:")


async def _invalidate_place_caches() -> None:
    await cache_delete_prefix(redis_client, "place:list:")
    await cache_delete_prefix(redis_client, "place:get:")
    await cache_delete_prefix(redis_client, "place:photos:get:")
    await cache_delete_prefix(redis_client, "place:search:v1:")
    await cache_delete_prefix(redis_client, "place:nearby:v1:")
    await cache_delete_prefix(redis_client, "place:viewport:v1:")


async def _invalidate_activity_shortlist_caches() -> None:
    await cache_delete_prefix(redis_client, "activity:shortlist:get:")
    await cache_delete_prefix(redis_client, "activity:shortlist:list:")


async def _invalidate_proposal_caches() -> None:
    await cache_delete_prefix(redis_client, "proposal:get:")
    await cache_delete_prefix(redis_client, "proposal:list:")


async def _invalidate_export_caches() -> None:
    await cache_delete_prefix(redis_client, "export:get:")


async def _invalidate_audit_caches() -> None:
    await cache_delete_prefix(redis_client, "audit:list:")


async def _set_trip_generation_failed(payload: dict[str, Any]) -> None:
    trip_id_raw = payload.get("trip_id")
    user_id_raw = payload.get("user_id")
    if not trip_id_raw or not user_id_raw:
        return

    trip_id = uuid.UUID(str(trip_id_raw))
    user_id = uuid.UUID(str(user_id_raw))
    async with AsyncSessionLocal() as db:
        async with db.begin():
            trip = await db.get(Trip, trip_id)
            if not trip or trip.user_id != user_id:
                return
            trip.generation_state = "FAILED"
            await db.flush()


async def _claim_next_job_id() -> uuid.UUID | None:
    async with AsyncSessionLocal() as db:
        async with db.begin():
            job = await JobRepository.claim_next_pending_job(db)
            if not job:
                return None
            logger.info("job_claimed", extra={"trace_id": "-", "job_id": str(job.id)})
            await increment_job_metric(redis_client, "claimed")
            return job.id


async def _process_job(job_id: uuid.UUID) -> None:
    job_user_id: uuid.UUID | None = None
    job_type: str | None = None
    payload: dict[str, Any] = {}
    attempts = 0
    max_attempts = 0
    final_status: str | None = None

    try:
        async with AsyncSessionLocal() as db:
            async with db.begin():
                job = await JobRepository.get_job_by_id(db, job_id)
                if not job:
                    logger.warning("job_missing", extra={"trace_id": "-", "job_id": str(job_id)})
                    return

                job_user_id = job.user_id
                job_type = job.job_type
                attempts = job.attempts
                max_attempts = job.max_attempts
                payload = job.payload_json if isinstance(job.payload_json, dict) else {}

                await set_audit_context(
                    db,
                    user_id=job.user_id,
                    correlation_id=payload.get("trace_id") or str(job.id),
                    request_path=f"/worker/{job.job_type}",
                )

                if job.job_type == "itinerary.optimize":
                    result = await execute_itinerary_optimization_job(db, job)
                    result_payload = {
                        "proposal_id": result.proposal_id,
                        "summary": result.summary,
                        "score": result.score,
                        "based_on_trip_version": result.based_on_trip_version,
                    }
                elif job.job_type.startswith("itinerary."):
                    result = await execute_itinerary_job(db, job)
                    result_payload = {
                        "summary": result.summary,
                        "day_deltas": result.day_deltas,
                        "new_trip_version": result.new_trip_version,
                        "generator_engine": result.generator_engine,
                        "llm_model": result.llm_model,
                        "fallback_used": result.fallback_used,
                        "provider_errors": result.provider_errors,
                        "resolved_place_count": result.resolved_place_count,
                        "photo_enriched_place_count": result.photo_enriched_place_count,
                        "unresolved_activity_count": result.unresolved_activity_count,
                    }
                elif job.job_type == "places.dedup.run":
                    result = await execute_places_dedup_job(db, job)
                    result_payload = {
                        "summary": result.summary,
                        "groups_processed": result.groups_processed,
                        "merged_groups": result.merged_groups,
                    }
                elif job.job_type == "places.photos.refresh":
                    result = await execute_place_photo_refresh_job(db, job)
                    result_payload = {
                        "summary": result.summary,
                        "photo_ids": result.photo_ids,
                        "provider_used": result.provider_used,
                        "errors": result.errors,
                    }
                elif job.job_type.startswith("export.generate."):
                    result = await execute_export_job(db, job)
                    result_payload = {
                        "export_id": result.export_id,
                        "format": result.format,
                        "trip_version": result.trip_version,
                        "sha256": result.sha256,
                        "size_bytes": result.size_bytes,
                        "content_type": result.content_type,
                    }
                else:
                    raise NonRetryableJobError("JOB_TYPE_NOT_SUPPORTED", "Unsupported job type")

                await JobRepository.mark_job_succeeded(db, job=job, result_payload=result_payload)
                final_status = "SUCCEEDED"
                logger.info("job_succeeded", extra={"trace_id": "-", "job_id": str(job.id)})
                await increment_job_metric(redis_client, "succeeded")
    except RetryableJobError as exc:
        final_status = await _finalize_job_error(
            job_id=job_id,
            job_type=job_type,
            payload=payload,
            attempts=attempts,
            max_attempts=max_attempts,
            code=exc.code,
            message=exc.message,
            details=exc.details,
            retryable=True,
        )
    except NonRetryableJobError as exc:
        final_status = await _finalize_job_error(
            job_id=job_id,
            job_type=job_type,
            payload=payload,
            attempts=attempts,
            max_attempts=max_attempts,
            code=exc.code,
            message=exc.message,
            details=exc.details,
            retryable=False,
        )
    except Exception as exc:  # pragma: no cover - defensive fallback
        final_status = await _finalize_job_error(
            job_id=job_id,
            job_type=job_type,
            payload=payload,
            attempts=attempts,
            max_attempts=max_attempts,
            code="WORKER_UNEXPECTED_ERROR",
            message="Unexpected worker error",
            details={"error": str(exc)},
            retryable=True,
        )
        logger.exception("job_exception", extra={"trace_id": "-", "job_id": str(job_id)})

    if job_user_id is None or job_type is None or final_status is None:
        return

    await _invalidate_job_cache(user_id=job_user_id, job_id=job_id)
    if job_type.startswith("itinerary."):
        await _invalidate_trip_caches()
    if job_type == "itinerary.optimize" and final_status == "SUCCEEDED":
        await _invalidate_proposal_caches()
        await _invalidate_activity_shortlist_caches()
    if job_type.startswith("places.") and final_status == "SUCCEEDED":
        await _invalidate_place_caches()
    if job_type == "places.photos.refresh" and final_status == "SUCCEEDED":
        await _invalidate_place_caches()
    if job_type.startswith("export.generate."):
        await _invalidate_export_caches()
    await _invalidate_audit_caches()


async def _finalize_job_error(
    *,
    job_id: uuid.UUID,
    job_type: str | None,
    payload: dict[str, Any],
    attempts: int,
    max_attempts: int,
    code: str,
    message: str,
    details: dict[str, Any] | None,
    retryable: bool,
) -> str:
    error_payload = _error_payload(code, message, details)

    async with AsyncSessionLocal() as db:
        async with db.begin():
            job = await JobRepository.get_job_by_id(db, job_id)
            if not job:
                return "FAILED"

            if retryable and attempts < max_attempts:
                await JobRepository.mark_job_retry(
                    db,
                    job=job,
                    error_payload=error_payload,
                    backoff_seconds=_retry_backoff(attempts),
                )
                logger.warning(
                    "job_retry_scheduled",
                    extra={"trace_id": "-", "job_id": str(job_id), "attempts": attempts},
                )
                return "PENDING"

            await JobRepository.mark_job_failed(
                db,
                job=job,
                error_payload=error_payload,
                dead_letter=True,
            )
            if job_type and job_type.startswith("export.generate."):
                export_id_raw = payload.get("export_id")
                if export_id_raw:
                    await ExportRepository.mark_export_failed(
                        db,
                        export_id=uuid.UUID(str(export_id_raw)),
                        error_payload=error_payload,
                    )

    if job_type and job_type.startswith("itinerary."):
        await _set_trip_generation_failed(payload)

    logger.error("job_failed", extra={"trace_id": "-", "job_id": str(job_id)})
    await increment_job_metric(redis_client, "failed")
    if not (retryable and attempts < max_attempts):
        await increment_job_metric(redis_client, "dead_lettered")
    return "FAILED" if not (retryable and attempts < max_attempts) else "PENDING"


async def run_worker() -> None:
    while True:
        job_id = await _claim_next_job_id()
        if not job_id:
            await asyncio.sleep(settings.worker_poll_interval_sec)
            continue

        await _process_job(job_id)


def main() -> None:
    logging.basicConfig(level=settings.log_level)
    asyncio.run(run_worker())


if __name__ == "__main__":
    main()
