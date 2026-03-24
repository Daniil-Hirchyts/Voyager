from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Activity, ActivityCategory, TripDay
from app.db.repositories import ActivityRepository


def _normalize_title(value: str) -> str:
    return " ".join(value.lower().split())


async def _fetch_day_activities(db: AsyncSession, day_id: uuid.UUID) -> list[Activity]:
    result = await db.execute(
        select(Activity).where(Activity.trip_day_id == day_id).order_by(Activity.order_index)
    )
    return list(result.scalars().all())


async def _normalize_day(db: AsyncSession, day_id: uuid.UUID) -> None:
    rows = await _fetch_day_activities(db, day_id)
    await ActivityRepository._apply_order_for_day(db, day_id, [row.id for row in rows])


async def _apply_replace(
    db: AsyncSession,
    *,
    days: list[TripDay],
    job_id: uuid.UUID,
    candidates_by_day: dict[uuid.UUID, list[dict[str, Any]]],
) -> tuple[dict[str, int], list[dict[str, Any]]]:
    summary = {"created": 0, "updated": 0, "skipped": 0, "deleted": 0}
    deltas: list[dict[str, Any]] = []

    for day in days:
        existing = await _fetch_day_activities(db, day.id)
        generated = [row for row in existing if row.source == "generated"]
        for row in generated:
            await db.delete(row)
        await db.flush()

        manual_rows = await _fetch_day_activities(db, day.id)
        manual_ids = [row.id for row in manual_rows]
        await ActivityRepository._apply_order_for_day(db, day.id, manual_ids)

        candidates = candidates_by_day.get(day.id, [])
        next_index = len(manual_ids)
        for candidate in candidates:
            db.add(
                Activity(
                    trip_id=day.trip_id,
                    trip_day_id=day.id,
                    order_index=next_index,
                    category=candidate.get("category", ActivityCategory.VISIT),
                    category_details_json={},
                    title=candidate["title"],
                    description=candidate["description"],
                    start_time=candidate["start_time"],
                    duration_min=candidate["duration_min"],
                    estimated_cost_amount=candidate.get("estimated_cost_amount"),
                    estimated_cost_currency=candidate.get("estimated_cost_currency"),
                    place_id=candidate.get("place_id"),
                    event_snapshot_id=candidate.get("event_snapshot_id"),
                    source="generated",
                    generation_batch_id=job_id,
                )
            )
            next_index += 1
            summary["created"] += 1

        summary["deleted"] += len(generated)
        deltas.append(
            {
                "day_id": str(day.id),
                "deleted_generated": len(generated),
                "created_generated": len(candidates),
                "updated_generated": 0,
                "skipped_generated": 0,
            }
        )

    return summary, deltas


async def _apply_merge(
    db: AsyncSession,
    *,
    days: list[TripDay],
    job_id: uuid.UUID,
    candidates_by_day: dict[uuid.UUID, list[dict[str, Any]]],
) -> tuple[dict[str, int], list[dict[str, Any]]]:
    summary = {"created": 0, "updated": 0, "skipped": 0, "deleted": 0}
    deltas: list[dict[str, Any]] = []

    for day in days:
        existing = await _fetch_day_activities(db, day.id)
        existing_generated = {
            _normalize_title(row.title): row for row in existing if row.source == "generated"
        }
        existing_all = {_normalize_title(row.title) for row in existing}
        candidates = candidates_by_day.get(day.id, [])

        created_day = 0
        updated_day = 0
        skipped_day = 0
        next_index = len(existing)

        for candidate in candidates:
            normalized = _normalize_title(candidate["title"])
            if normalized in existing_generated:
                row = existing_generated[normalized]
                row.title = candidate["title"]
                row.description = candidate["description"]
                row.start_time = candidate["start_time"]
                row.duration_min = candidate["duration_min"]
                row.category = candidate.get("category", ActivityCategory.VISIT)
                row.category_details_json = {}
                row.estimated_cost_amount = candidate.get("estimated_cost_amount")
                row.estimated_cost_currency = candidate.get("estimated_cost_currency")
                row.place_id = candidate.get("place_id")
                row.event_snapshot_id = candidate.get("event_snapshot_id")
                row.generation_batch_id = job_id
                row.source = "generated"
                summary["updated"] += 1
                updated_day += 1
                continue

            if normalized in existing_all:
                summary["skipped"] += 1
                skipped_day += 1
                continue

            db.add(
                Activity(
                    trip_id=day.trip_id,
                    trip_day_id=day.id,
                    order_index=next_index,
                    category=candidate.get("category", ActivityCategory.VISIT),
                    category_details_json={},
                    title=candidate["title"],
                    description=candidate["description"],
                    start_time=candidate["start_time"],
                    duration_min=candidate["duration_min"],
                    estimated_cost_amount=candidate.get("estimated_cost_amount"),
                    estimated_cost_currency=candidate.get("estimated_cost_currency"),
                    place_id=candidate.get("place_id"),
                    event_snapshot_id=candidate.get("event_snapshot_id"),
                    source="generated",
                    generation_batch_id=job_id,
                )
            )
            next_index += 1
            existing_all.add(normalized)
            summary["created"] += 1
            created_day += 1

        deltas.append(
            {
                "day_id": str(day.id),
                "deleted_generated": 0,
                "created_generated": created_day,
                "updated_generated": updated_day,
                "skipped_generated": skipped_day,
            }
        )

    return summary, deltas


async def _apply_append(
    db: AsyncSession,
    *,
    days: list[TripDay],
    job_id: uuid.UUID,
    candidates_by_day: dict[uuid.UUID, list[dict[str, Any]]],
) -> tuple[dict[str, int], list[dict[str, Any]]]:
    summary = {"created": 0, "updated": 0, "skipped": 0, "deleted": 0}
    deltas: list[dict[str, Any]] = []

    for day in days:
        existing = await _fetch_day_activities(db, day.id)
        existing_all = {_normalize_title(row.title) for row in existing}
        candidates = candidates_by_day.get(day.id, [])

        created_day = 0
        skipped_day = 0
        next_index = len(existing)

        for candidate in candidates:
            normalized = _normalize_title(candidate["title"])
            if normalized in existing_all:
                summary["skipped"] += 1
                skipped_day += 1
                continue

            db.add(
                Activity(
                    trip_id=day.trip_id,
                    trip_day_id=day.id,
                    order_index=next_index,
                    category=candidate.get("category", ActivityCategory.VISIT),
                    category_details_json={},
                    title=candidate["title"],
                    description=candidate["description"],
                    start_time=candidate["start_time"],
                    duration_min=candidate["duration_min"],
                    estimated_cost_amount=candidate.get("estimated_cost_amount"),
                    estimated_cost_currency=candidate.get("estimated_cost_currency"),
                    place_id=candidate.get("place_id"),
                    event_snapshot_id=candidate.get("event_snapshot_id"),
                    source="generated",
                    generation_batch_id=job_id,
                )
            )
            next_index += 1
            existing_all.add(normalized)
            summary["created"] += 1
            created_day += 1

        deltas.append(
            {
                "day_id": str(day.id),
                "deleted_generated": 0,
                "created_generated": created_day,
                "updated_generated": 0,
                "skipped_generated": skipped_day,
            }
        )

    return summary, deltas


async def _apply_reset(
    db: AsyncSession,
    *,
    days: list[TripDay],
) -> tuple[dict[str, int], list[dict[str, Any]]]:
    summary = {"created": 0, "updated": 0, "skipped": 0, "deleted": 0}
    deltas: list[dict[str, Any]] = []

    for day in days:
        existing = await _fetch_day_activities(db, day.id)
        for row in existing:
            await db.delete(row)
        await db.flush()
        await _normalize_day(db, day.id)

        deleted_count = len(existing)
        summary["deleted"] += deleted_count
        deltas.append(
            {
                "day_id": str(day.id),
                "deleted_activities": deleted_count,
                "deleted_generated": deleted_count,
                "created_generated": 0,
                "updated_generated": 0,
                "skipped_generated": 0,
            }
        )

    return summary, deltas
