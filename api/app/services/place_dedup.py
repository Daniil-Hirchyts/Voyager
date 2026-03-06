from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Job, Place
from app.db.repositories import PlaceRepository
from app.services.itinerary_generation import NonRetryableJobError


@dataclass
class PlacesDedupExecutionResult:
    summary: dict[str, int]
    groups_processed: int
    merged_groups: int


def _canonical_sort_key(place: Place) -> tuple[int, datetime, str]:
    has_external = 0 if place.external_id else 1
    return has_external, place.created_at, str(place.id)


def _category_compatible(category_a: str | None, category_b: str | None) -> bool:
    if not category_a or not category_b:
        return True
    return category_a.strip().lower() == category_b.strip().lower()


def _as_uuid(value: Any, *, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError) as exc:
        raise NonRetryableJobError("JOB_PAYLOAD_INVALID", f"{field} must be a valid UUID") from exc


def _as_int(value: Any, *, field: str, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (ValueError, TypeError) as exc:
        raise NonRetryableJobError("JOB_PAYLOAD_INVALID", f"{field} must be an integer") from exc
    if parsed < minimum or parsed > maximum:
        raise NonRetryableJobError(
            "JOB_PAYLOAD_INVALID",
            f"{field} must be in range [{minimum}, {maximum}]",
        )
    return parsed


def _as_float(value: Any, *, field: str, minimum: float, maximum: float) -> float:
    try:
        parsed = float(value)
    except (ValueError, TypeError) as exc:
        raise NonRetryableJobError("JOB_PAYLOAD_INVALID", f"{field} must be a float") from exc
    if parsed < minimum or parsed > maximum:
        raise NonRetryableJobError(
            "JOB_PAYLOAD_INVALID",
            f"{field} must be in range [{minimum}, {maximum}]",
        )
    return parsed


async def execute_places_dedup_job(db: AsyncSession, job: Job) -> PlacesDedupExecutionResult:
    payload = job.payload_json
    if not isinstance(payload, dict):
        raise NonRetryableJobError("JOB_PAYLOAD_INVALID", "Job payload must be an object")

    _ = _as_uuid(payload.get("user_id"), field="user_id")
    _ = _as_uuid(payload.get("submitted_by"), field="submitted_by")

    radius_m = _as_int(payload.get("radius_m", 120), field="radius_m", minimum=1, maximum=50_000)
    max_groups = _as_int(
        payload.get("max_groups", 500), field="max_groups", minimum=1, maximum=10_000
    )
    dedup_confidence = _as_float(
        payload.get("dedup_confidence", 0.95),
        field="dedup_confidence",
        minimum=0.0,
        maximum=1.0,
    )

    groups = await PlaceRepository.candidate_groups_for_dedup(db, max_groups=max_groups)
    summary = {"processed": 0, "merged": 0, "skipped": 0, "failed": 0}
    merged_groups = 0

    for group_ids in groups:
        rows = await db.execute(select(Place).where(Place.id.in_(group_ids)).with_for_update())
        places = list(rows.scalars().all())
        if len(places) < 2:
            summary["skipped"] += len(places)
            continue

        summary["processed"] += len(places)
        ordered = sorted(places, key=_canonical_sort_key)
        canonical = ordered[0]
        source_ids: list[uuid.UUID] = []

        for candidate in ordered[1:]:
            if candidate.canonical_place_id is not None:
                summary["skipped"] += 1
                continue
            if not _category_compatible(canonical.category, candidate.category):
                summary["skipped"] += 1
                continue

            distance_m = await PlaceRepository.distance_between_places(
                db,
                place_a_id=canonical.id,
                place_b_id=candidate.id,
            )
            if distance_m is None or distance_m > radius_m:
                summary["skipped"] += 1
                continue

            source_ids.append(candidate.id)

        if not source_ids:
            continue

        try:
            merge_result = await PlaceRepository.merge_places(
                db,
                canonical_place_id=canonical.id,
                source_place_ids=source_ids,
                dedup_confidence=dedup_confidence,
            )
            summary["merged"] += int(merge_result["merged_places"])
            merged_groups += 1
        except Exception:
            summary["failed"] += len(source_ids)

    return PlacesDedupExecutionResult(
        summary=summary,
        groups_processed=len(groups),
        merged_groups=merged_groups,
    )
