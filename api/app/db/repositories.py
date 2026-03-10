import re
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import case, func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import (
    Activity,
    AuditLog,
    EventSnapshot,
    ItineraryProposal,
    ItineraryProposalActivity,
    Job,
    JobStatus,
    LodgingOffer,
    Place,
    PlacePhoto,
    TransportOffer,
    Trip,
    TripDay,
    TripExport,
    TripMapLayer,
    UserProfile,
)
from app.errors import ConflictError, NotFoundError, ValidationApiError
from app.models.activity_discovery import ActivityDiscoveryDetail, ActivityDiscoveryItem
from app.models.jobs import JobResponse
from app.models.map_layers import TripMapLayerCreateRequest, TripMapLayerPatchRequest
from app.models.offers import (
    LodgingOfferDetails,
    OfferGeoPoint,
    OfferKind,
    OfferResponse,
    TransportLayoverDetail,
    TransportOfferDetails,
    TransportSegmentDetail,
)
from app.models.places import PlaceCreateRequest, PlacePhotoResponse, PlacePhotoSummary
from app.models.proposals import ProposalActivityResponse, ProposalResponse
from app.models.trips import (
    ActivityCreateRequest,
    ActivityMoveRequest,
    ActivityPatchRequest,
    ActivityReorderRequest,
    DayPatchRequest,
    TripCreateRequest,
    TripPatchRequest,
)
from app.services.place_photo_assets import build_place_photo_asset_url

_ISO_DURATION_RE = re.compile(
    r"^P(?:(?P<days>\d+)D)?(?:T(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?)?$"
)


def _coerce_string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    text = str(value).strip()
    return text or None


def _coerce_decimal(value: Any) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _coerce_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _coerce_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _iso_duration_to_minutes(value: Any) -> int | None:
    if not isinstance(value, str):
        return None
    match = _ISO_DURATION_RE.match(value.strip().upper())
    if not match:
        return None
    days = int(match.group("days") or 0)
    hours = int(match.group("hours") or 0)
    minutes = int(match.group("minutes") or 0)
    return (days * 24 * 60) + (hours * 60) + minutes


def _titleize_token(value: str) -> str:
    return value.replace("_", " ").replace("-", " ").strip().title()


def _unique_strings(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        item = _coerce_string(value)
        if not item:
            continue
        normalized = item.casefold()
        if normalized in seen:
            continue
        seen.add(normalized)
        result.append(item)
    return result


class UserRepository:
    @staticmethod
    async def get_by_sub(db: AsyncSession, keycloak_sub: str) -> UserProfile | None:
        result = await db.execute(
            select(UserProfile).where(UserProfile.keycloak_sub == keycloak_sub)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def update_preferences(
        db: AsyncSession, user: UserProfile, preferences: dict
    ) -> UserProfile:
        user.preferences_json = preferences
        await db.flush()
        await db.refresh(user)
        return user


class TripRepository:
    @staticmethod
    async def _validate_date_range(payload: TripCreateRequest | TripPatchRequest) -> None:
        start = payload.start_date
        end = payload.end_date
        if start and end and end < start:
            raise ValidationApiError("end_date must be greater than or equal to start_date")

    @staticmethod
    async def create_trip(db: AsyncSession, user_id: uuid.UUID, payload: TripCreateRequest) -> Trip:
        await TripRepository._validate_date_range(payload)

        trip = Trip(
            user_id=user_id,
            title=payload.title,
            destination_text=payload.destination_text,
            start_date=payload.start_date,
            end_date=payload.end_date,
            budget_amount=payload.budget_amount,
            budget_currency=payload.budget_currency,
            trip_type=payload.trip_type,
            preferences_json=payload.preferences,
            version=1,
        )
        db.add(trip)
        await db.flush()

        day_count = (payload.end_date - payload.start_date).days + 1
        for idx in range(day_count):
            day = TripDay(
                trip_id=trip.id,
                day_index=idx,
                date=payload.start_date + timedelta(days=idx),
                notes=None,
            )
            db.add(day)

        await db.flush()
        await db.refresh(trip)
        return trip

    @staticmethod
    async def list_trips(
        db: AsyncSession,
        user_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
    ) -> tuple[int, list[Trip]]:
        count_result = await db.execute(select(func.count(Trip.id)).where(Trip.user_id == user_id))
        total = int(count_result.scalar_one())

        result = await db.execute(
            select(Trip)
            .where(Trip.user_id == user_id)
            .order_by(Trip.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return total, list(result.scalars().all())

    @staticmethod
    async def get_trip(db: AsyncSession, user_id: uuid.UUID, trip_id: uuid.UUID) -> Trip:
        result = await db.execute(
            select(Trip).where(Trip.id == trip_id).where(Trip.user_id == user_id)
        )
        trip = result.scalar_one_or_none()
        if not trip:
            raise NotFoundError("Trip not found")
        return trip

    @staticmethod
    async def patch_trip(
        db: AsyncSession,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        expected_version: int,
        payload: TripPatchRequest,
    ) -> Trip:
        trip = await TripRepository.get_trip(db, user_id, trip_id)
        if trip.version != expected_version:
            raise ConflictError(
                code="CONFLICT_VERSION_MISMATCH",
                message="Trip version mismatch",
                details={"latest_version": trip.version},
            )

        await TripRepository._validate_date_range(payload)

        update_data = payload.model_dump(exclude_unset=True)
        if "preferences" in update_data:
            trip.preferences_json = update_data.pop("preferences")

        for key, value in update_data.items():
            setattr(trip, key, value)

        trip.version += 1

        if payload.start_date is not None and payload.end_date is not None:
            await TripRepository._sync_days_to_date_range(db, trip)

        await db.flush()
        await db.refresh(trip)
        return trip

    @staticmethod
    async def delete_trip(db: AsyncSession, user_id: uuid.UUID, trip_id: uuid.UUID) -> None:
        trip = await TripRepository.get_trip(db, user_id, trip_id)
        await db.delete(trip)
        await db.flush()

    @staticmethod
    async def duplicate_trip(db: AsyncSession, user_id: uuid.UUID, trip_id: uuid.UUID) -> Trip:
        source = await TripRepository.get_trip(db, user_id, trip_id)

        duplicate = Trip(
            user_id=source.user_id,
            title=f"{source.title} (Copy)",
            destination_text=source.destination_text,
            start_date=source.start_date,
            end_date=source.end_date,
            budget_amount=source.budget_amount,
            budget_currency=source.budget_currency,
            trip_type=source.trip_type,
            preferences_json=source.preferences_json,
            version=1,
        )
        db.add(duplicate)
        await db.flush()

        source_days_result = await db.execute(
            select(TripDay).where(TripDay.trip_id == source.id).order_by(TripDay.day_index)
        )
        source_days = list(source_days_result.scalars().all())

        old_to_new_day_id: dict[uuid.UUID, uuid.UUID] = {}
        for day in source_days:
            new_day = TripDay(
                trip_id=duplicate.id,
                day_index=day.day_index,
                date=day.date,
                notes=day.notes,
            )
            db.add(new_day)
            await db.flush()
            old_to_new_day_id[day.id] = new_day.id

        source_events_result = await db.execute(
            select(EventSnapshot)
            .where(EventSnapshot.trip_id == source.id)
            .order_by(EventSnapshot.created_at.asc(), EventSnapshot.id.asc())
        )
        old_to_new_event_id: dict[uuid.UUID, uuid.UUID] = {}
        for event in source_events_result.scalars().all():
            duplicated_event = EventSnapshot(
                trip_id=duplicate.id,
                trip_day_id=old_to_new_day_id.get(event.trip_day_id) if event.trip_day_id else None,
                provider=event.provider,
                provider_event_ref=event.provider_event_ref,
                title=event.title,
                summary=event.summary,
                start_at=event.start_at,
                end_at=event.end_at,
                timezone=event.timezone,
                venue_name=event.venue_name,
                venue_address=event.venue_address,
                place_id=event.place_id,
                segment=event.segment,
                genre=event.genre,
                min_price=event.min_price,
                max_price=event.max_price,
                currency=event.currency,
                image_url=event.image_url,
                deep_link=event.deep_link,
                sales_status=event.sales_status,
                request_fingerprint=event.request_fingerprint,
                raw_payload_json=event.raw_payload_json,
                expires_at=event.expires_at,
            )
            db.add(duplicated_event)
            await db.flush()
            old_to_new_event_id[event.id] = duplicated_event.id

        source_activities_result = await db.execute(
            select(Activity)
            .where(Activity.trip_id == source.id)
            .order_by(Activity.trip_day_id.asc().nulls_last(), Activity.order_index)
        )
        for activity in source_activities_result.scalars().all():
            db.add(
                Activity(
                    trip_id=duplicate.id,
                    trip_day_id=(
                        old_to_new_day_id[activity.trip_day_id]
                        if activity.trip_day_id is not None
                        else None
                    ),
                    order_index=activity.order_index,
                    title=activity.title,
                    description=activity.description,
                    start_time=activity.start_time,
                    duration_min=activity.duration_min,
                    tags_json=activity.tags_json,
                    estimated_cost_amount=activity.estimated_cost_amount,
                    estimated_cost_currency=activity.estimated_cost_currency,
                    place_id=activity.place_id,
                    event_snapshot_id=old_to_new_event_id.get(activity.event_snapshot_id),
                    notes=activity.notes,
                    is_favorite=activity.is_favorite,
                    source=activity.source,
                )
            )

        await db.flush()
        await db.refresh(duplicate)
        return duplicate

    @staticmethod
    async def _sync_days_to_date_range(db: AsyncSession, trip: Trip) -> None:
        existing_result = await db.execute(
            select(TripDay).where(TripDay.trip_id == trip.id).order_by(TripDay.day_index)
        )
        existing_days = list(existing_result.scalars().all())
        target_count = (trip.end_date - trip.start_date).days + 1

        if target_count < 1:
            raise ValidationApiError("Invalid date range")

        if len(existing_days) > target_count:
            to_delete = existing_days[target_count:]
            for day in to_delete:
                await db.delete(day)

        for idx in range(target_count):
            date_value = trip.start_date + timedelta(days=idx)
            if idx < len(existing_days):
                existing_days[idx].day_index = idx
                existing_days[idx].date = date_value
            else:
                db.add(TripDay(trip_id=trip.id, day_index=idx, date=date_value, notes=None))

    @staticmethod
    async def list_days(db: AsyncSession, user_id: uuid.UUID, trip_id: uuid.UUID) -> list[TripDay]:
        await TripRepository.get_trip(db, user_id, trip_id)
        result = await db.execute(
            select(TripDay).where(TripDay.trip_id == trip_id).order_by(TripDay.day_index)
        )
        return list(result.scalars().all())

    @staticmethod
    async def bump_version(db: AsyncSession, trip_id: uuid.UUID) -> int:
        result = await db.execute(
            update(Trip)
            .where(Trip.id == trip_id)
            .values(version=Trip.version + 1)
            .returning(Trip.version)
        )
        new_version = result.scalar_one()
        return int(new_version)


class DayRepository:
    @staticmethod
    async def get_day_for_user(db: AsyncSession, user_id: uuid.UUID, day_id: uuid.UUID) -> TripDay:
        result = await db.execute(
            select(TripDay)
            .join(Trip, TripDay.trip_id == Trip.id)
            .where(TripDay.id == day_id)
            .where(Trip.user_id == user_id)
        )
        day = result.scalar_one_or_none()
        if not day:
            raise NotFoundError("Day not found")
        return day

    @staticmethod
    async def patch_day(
        db: AsyncSession, user_id: uuid.UUID, day_id: uuid.UUID, payload: DayPatchRequest
    ) -> TripDay:
        day = await DayRepository.get_day_for_user(db, user_id, day_id)
        update_data = payload.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(day, key, value)

        await TripRepository.bump_version(db, day.trip_id)
        await db.flush()
        await db.refresh(day)
        return day


class TripMapLayerRepository:
    @staticmethod
    async def list_trip_map_layers(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        limit: int,
        offset: int,
    ) -> tuple[int, list[TripMapLayer]]:
        await TripRepository.get_trip(db, user_id, trip_id)

        total = int(
            (
                await db.execute(
                    select(func.count(TripMapLayer.id)).where(TripMapLayer.trip_id == trip_id)
                )
            ).scalar_one()
        )
        rows = await db.execute(
            select(TripMapLayer)
            .where(TripMapLayer.trip_id == trip_id)
            .order_by(TripMapLayer.order_index.asc(), TripMapLayer.created_at.asc())
            .limit(limit)
            .offset(offset)
        )
        return total, list(rows.scalars().all())

    @staticmethod
    async def get_trip_map_layer(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        layer_id: uuid.UUID,
    ) -> TripMapLayer:
        await TripRepository.get_trip(db, user_id, trip_id)

        row = await db.execute(
            select(TripMapLayer)
            .where(TripMapLayer.id == layer_id)
            .where(TripMapLayer.trip_id == trip_id)
        )
        item = row.scalar_one_or_none()
        if not item:
            raise NotFoundError("Trip map layer not found")
        return item

    @staticmethod
    async def create_trip_map_layer(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        payload: TripMapLayerCreateRequest,
    ) -> TripMapLayer:
        await TripRepository.get_trip(db, user_id, trip_id)

        order_index = payload.order_index
        if order_index is None:
            max_order = (
                await db.execute(
                    select(func.max(TripMapLayer.order_index)).where(
                        TripMapLayer.trip_id == trip_id
                    )
                )
            ).scalar_one_or_none()
            order_index = (int(max_order) if max_order is not None else -1) + 1

        item = TripMapLayer(
            trip_id=trip_id,
            name=payload.name,
            source=payload.source.value,
            renderer=payload.renderer.value,
            feature_collection_json=payload.feature_collection,
            style_json=payload.style,
            metadata_json=payload.metadata,
            is_visible=payload.is_visible,
            is_locked=payload.is_locked,
            order_index=order_index,
        )
        db.add(item)
        await db.flush()
        await db.refresh(item)
        return item

    @staticmethod
    async def patch_trip_map_layer(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        layer_id: uuid.UUID,
        payload: TripMapLayerPatchRequest,
    ) -> TripMapLayer:
        item = await TripMapLayerRepository.get_trip_map_layer(
            db, user_id=user_id, trip_id=trip_id, layer_id=layer_id
        )
        update_data = payload.model_dump(exclude_unset=True)

        for key, value in update_data.items():
            if key == "feature_collection":
                item.feature_collection_json = value or {}
            elif key == "style":
                item.style_json = value or {}
            elif key == "metadata":
                item.metadata_json = value or {}
            elif key == "source" and value is not None:
                item.source = value.value
            elif key == "renderer" and value is not None:
                item.renderer = value.value
            else:
                setattr(item, key, value)

        await db.flush()
        await db.refresh(item)
        return item

    @staticmethod
    async def delete_trip_map_layer(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        layer_id: uuid.UUID,
    ) -> None:
        item = await TripMapLayerRepository.get_trip_map_layer(
            db, user_id=user_id, trip_id=trip_id, layer_id=layer_id
        )
        await db.delete(item)
        await db.flush()


class ActivityRepository:
    @staticmethod
    def _bucket_select(
        *,
        trip_id: uuid.UUID,
        trip_day_id: uuid.UUID | None,
        columns: tuple = (Activity,),
    ):
        stmt = select(*columns).where(Activity.trip_id == trip_id)
        if trip_day_id is None:
            stmt = stmt.where(Activity.trip_day_id.is_(None))
        else:
            stmt = stmt.where(Activity.trip_day_id == trip_day_id)
        return stmt

    @staticmethod
    async def _bucket_ids(
        db: AsyncSession,
        *,
        trip_id: uuid.UUID,
        trip_day_id: uuid.UUID | None,
    ) -> list[uuid.UUID]:
        result = await db.execute(
            ActivityRepository._bucket_select(
                trip_id=trip_id,
                trip_day_id=trip_day_id,
                columns=(Activity.id,),
            ).order_by(Activity.order_index)
        )
        return list(result.scalars().all())

    @staticmethod
    async def _next_order_index(
        db: AsyncSession,
        *,
        trip_id: uuid.UUID,
        trip_day_id: uuid.UUID | None,
    ) -> int:
        result = await db.execute(
            ActivityRepository._bucket_select(
                trip_id=trip_id,
                trip_day_id=trip_day_id,
                columns=(func.max(Activity.order_index),),
            )
        )
        max_order = result.scalar_one()
        return int(max_order) + 1 if max_order is not None else 0

    @staticmethod
    async def _temporary_order_sentinel(
        db: AsyncSession,
        *,
        trip_id: uuid.UUID,
        trip_day_id: uuid.UUID | None,
    ) -> int:
        result = await db.execute(
            ActivityRepository._bucket_select(
                trip_id=trip_id,
                trip_day_id=trip_day_id,
                columns=(func.min(Activity.order_index),),
            )
        )
        min_order = result.scalar_one()
        return int(min_order) - 1 if min_order is not None else -1

    @staticmethod
    async def _set_snapshot_day(
        db: AsyncSession,
        *,
        snapshot_id: uuid.UUID | None,
        trip_day_id: uuid.UUID | None,
    ) -> None:
        if snapshot_id is None:
            return
        await db.execute(
            update(EventSnapshot)
            .where(EventSnapshot.id == snapshot_id)
            .values(trip_day_id=trip_day_id)
        )

    @staticmethod
    async def list_day_activities(
        db: AsyncSession,
        user_id: uuid.UUID,
        day_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
    ) -> tuple[int, list[Activity]]:
        day = await DayRepository.get_day_for_user(db, user_id, day_id)

        count_result = await db.execute(
            select(func.count(Activity.id)).where(Activity.trip_day_id == day.id)
        )
        total = int(count_result.scalar_one())

        result = await db.execute(
            select(Activity)
            .where(Activity.trip_day_id == day.id)
            .order_by(Activity.order_index)
            .limit(limit)
            .offset(offset)
        )
        return total, list(result.scalars().all())

    @staticmethod
    async def list_trip_activities(
        db: AsyncSession,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
    ) -> list[Activity]:
        await TripRepository.get_trip(db, user_id, trip_id)
        result = await db.execute(
            select(Activity)
            .outerjoin(TripDay, Activity.trip_day_id == TripDay.id)
            .where(Activity.trip_id == trip_id)
            .order_by(
                case((Activity.trip_day_id.is_(None), 1), else_=0),
                TripDay.day_index.asc().nulls_last(),
                Activity.order_index,
            )
        )
        return list(result.scalars().all())

    @staticmethod
    async def create_trip_activity(
        db: AsyncSession,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        payload: ActivityCreateRequest,
    ) -> Activity:
        trip = await TripRepository.get_trip(db, user_id, trip_id)
        target_day: TripDay | None = None
        if payload.trip_day_id is not None:
            target_day = await DayRepository.get_day_for_user(db, user_id, payload.trip_day_id)
            if target_day.trip_id != trip.id:
                raise ValidationApiError("trip_day_id must belong to the trip")

        order_index = await ActivityRepository._next_order_index(
            db,
            trip_id=trip.id,
            trip_day_id=target_day.id if target_day else None,
        )

        activity = Activity(
            trip_id=trip.id,
            trip_day_id=target_day.id if target_day else None,
            order_index=order_index,
            title=payload.title,
            description=payload.description,
            start_time=payload.start_time if target_day else None,
            duration_min=payload.duration_min,
            tags_json=payload.tags,
            estimated_cost_amount=payload.estimated_cost_amount,
            estimated_cost_currency=payload.estimated_cost_currency,
            place_id=payload.place_id,
            notes=payload.notes,
            is_favorite=payload.is_favorite,
            source=payload.source,
        )
        db.add(activity)

        await TripRepository.bump_version(db, trip.id)
        await db.flush()
        await db.refresh(activity)
        return activity

    @staticmethod
    async def create_activity(
        db: AsyncSession,
        user_id: uuid.UUID,
        day_id: uuid.UUID,
        payload: ActivityCreateRequest,
    ) -> Activity:
        day = await DayRepository.get_day_for_user(db, user_id, day_id)
        if payload.trip_day_id not in (None, day.id):
            raise ValidationApiError("trip_day_id must match the day in the request path")
        return await ActivityRepository.create_trip_activity(
            db,
            user_id,
            day.trip_id,
            payload.model_copy(update={"trip_day_id": day.id}),
        )

    @staticmethod
    async def _get_activity_for_user(
        db: AsyncSession, user_id: uuid.UUID, activity_id: uuid.UUID
    ) -> tuple[Activity, Trip, TripDay | None]:
        result = await db.execute(
            select(Activity, Trip, TripDay)
            .join(Trip, Activity.trip_id == Trip.id)
            .outerjoin(TripDay, Activity.trip_day_id == TripDay.id)
            .where(Activity.id == activity_id)
            .where(Trip.user_id == user_id)
        )
        row = result.first()
        if not row:
            raise NotFoundError("Activity not found")
        return row[0], row[1], row[2]

    @staticmethod
    async def patch_activity(
        db: AsyncSession,
        user_id: uuid.UUID,
        activity_id: uuid.UUID,
        payload: ActivityPatchRequest,
    ) -> Activity:
        activity, trip, _day = await ActivityRepository._get_activity_for_user(
            db, user_id, activity_id
        )
        update_data = payload.model_dump(exclude_unset=True)
        if "tags" in update_data:
            activity.tags_json = update_data.pop("tags")
        for key, value in update_data.items():
            setattr(activity, key, value)

        await TripRepository.bump_version(db, trip.id)
        await db.flush()
        await db.refresh(activity)
        return activity

    @staticmethod
    async def delete_activity(db: AsyncSession, user_id: uuid.UUID, activity_id: uuid.UUID) -> None:
        activity, trip, _day = await ActivityRepository._get_activity_for_user(
            db, user_id, activity_id
        )
        source_day_id = activity.trip_day_id
        snapshot_id = activity.event_snapshot_id
        await db.delete(activity)
        await db.flush()

        await ActivityRepository._set_snapshot_day(db, snapshot_id=snapshot_id, trip_day_id=None)
        await ActivityRepository._normalize_bucket_order(
            db,
            trip_id=trip.id,
            trip_day_id=source_day_id,
        )
        await TripRepository.bump_version(db, trip.id)

    @staticmethod
    async def reorder_day(
        db: AsyncSession,
        user_id: uuid.UUID,
        day_id: uuid.UUID,
        expected_version: int,
        payload: ActivityReorderRequest,
    ) -> list[Activity]:
        day = await DayRepository.get_day_for_user(db, user_id, day_id)
        trip = await TripRepository.get_trip(db, user_id, day.trip_id)
        if trip.version != expected_version:
            raise ConflictError(
                code="CONFLICT_VERSION_MISMATCH",
                message="Trip version mismatch",
                details={"latest_version": trip.version},
            )

        existing_result = await db.execute(
            select(Activity).where(Activity.trip_day_id == day.id).order_by(Activity.order_index)
        )
        existing = list(existing_result.scalars().all())
        existing_ids = {item.id for item in existing}
        submitted_ids = {item.activity_id for item in payload.items}
        if existing_ids != submitted_ids:
            raise ValidationApiError("Reorder payload must include exactly all day activities")

        target_order = sorted(payload.items, key=lambda item: item.order_index)
        ordered_ids = [item.activity_id for item in target_order]
        await ActivityRepository._apply_order_for_bucket(
            db,
            trip_id=trip.id,
            trip_day_id=day.id,
            ordered_ids=ordered_ids,
        )

        await TripRepository.bump_version(db, day.trip_id)

        refreshed_result = await db.execute(
            select(Activity).where(Activity.trip_day_id == day.id).order_by(Activity.order_index)
        )
        return list(refreshed_result.scalars().all())

    @staticmethod
    async def move_activity(
        db: AsyncSession,
        user_id: uuid.UUID,
        activity_id: uuid.UUID,
        expected_version: int,
        payload: ActivityMoveRequest,
    ) -> Activity:
        activity, trip, _source_day = await ActivityRepository._get_activity_for_user(
            db, user_id, activity_id
        )
        if trip.version != expected_version:
            raise ConflictError(
                code="CONFLICT_VERSION_MISMATCH",
                message="Trip version mismatch",
                details={"latest_version": trip.version},
            )

        target_day: TripDay | None = None
        if payload.target_day_id is not None:
            target_day = await DayRepository.get_day_for_user(db, user_id, payload.target_day_id)
            if target_day.trip_id != trip.id:
                raise ValidationApiError("Activity move target day must belong to same trip")

        source_bucket_day_id = activity.trip_day_id
        target_bucket_day_id = target_day.id if target_day else None

        if source_bucket_day_id == target_bucket_day_id:
            ids = await ActivityRepository._bucket_ids(
                db,
                trip_id=trip.id,
                trip_day_id=source_bucket_day_id,
            )
            ids.remove(activity.id)
            insertion_index = max(0, min(payload.target_index, len(ids)))
            ids.insert(insertion_index, activity.id)
            await ActivityRepository._apply_order_for_bucket(
                db,
                trip_id=trip.id,
                trip_day_id=source_bucket_day_id,
                ordered_ids=ids,
            )
        else:
            source_ids = [
                item_id
                for item_id in await ActivityRepository._bucket_ids(
                    db,
                    trip_id=trip.id,
                    trip_day_id=source_bucket_day_id,
                )
                if item_id != activity.id
            ]
            target_ids = await ActivityRepository._bucket_ids(
                db,
                trip_id=trip.id,
                trip_day_id=target_bucket_day_id,
            )
            insertion_index = max(0, min(payload.target_index, len(target_ids)))
            target_ids.insert(insertion_index, activity.id)

            temp_order = await ActivityRepository._temporary_order_sentinel(
                db,
                trip_id=trip.id,
                trip_day_id=target_bucket_day_id,
            )
            activity.trip_day_id = target_bucket_day_id
            activity.order_index = temp_order
            await db.flush()

            await ActivityRepository._apply_order_for_bucket(
                db,
                trip_id=trip.id,
                trip_day_id=source_bucket_day_id,
                ordered_ids=source_ids,
            )
            await ActivityRepository._apply_order_for_bucket(
                db,
                trip_id=trip.id,
                trip_day_id=target_bucket_day_id,
                ordered_ids=target_ids,
            )

        if target_bucket_day_id is None:
            activity.start_time = None
        elif "start_time" in payload.model_fields_set:
            activity.start_time = payload.start_time
        await ActivityRepository._set_snapshot_day(
            db,
            snapshot_id=activity.event_snapshot_id,
            trip_day_id=target_bucket_day_id,
        )

        await TripRepository.bump_version(db, trip.id)
        await db.flush()
        await db.refresh(activity)
        return activity

    @staticmethod
    async def _normalize_bucket_order(
        db: AsyncSession,
        *,
        trip_id: uuid.UUID,
        trip_day_id: uuid.UUID | None,
    ) -> None:
        ids = await ActivityRepository._bucket_ids(
            db,
            trip_id=trip_id,
            trip_day_id=trip_day_id,
        )
        await ActivityRepository._apply_order_for_bucket(
            db,
            trip_id=trip_id,
            trip_day_id=trip_day_id,
            ordered_ids=ids,
        )

    @staticmethod
    async def _apply_order_for_day(
        db: AsyncSession,
        day_id: uuid.UUID,
        ordered_ids: list[uuid.UUID],
    ) -> None:
        day_result = await db.execute(select(TripDay.trip_id).where(TripDay.id == day_id))
        trip_id = day_result.scalar_one_or_none()
        if trip_id is None:
            raise NotFoundError("Day not found")
        await ActivityRepository._apply_order_for_bucket(
            db,
            trip_id=trip_id,
            trip_day_id=day_id,
            ordered_ids=ordered_ids,
        )

    @staticmethod
    async def _apply_order_for_bucket(
        db: AsyncSession,
        *,
        trip_id: uuid.UUID,
        trip_day_id: uuid.UUID | None,
        ordered_ids: list[uuid.UUID],
    ) -> None:
        if not ordered_ids:
            return

        bucket_filter = (
            Activity.trip_day_id.is_(None)
            if trip_day_id is None
            else Activity.trip_day_id == trip_day_id
        )
        temp_sentinel = await ActivityRepository._temporary_order_sentinel(
            db,
            trip_id=trip_id,
            trip_day_id=trip_day_id,
        )
        temp_case = case(
            {aid: temp_sentinel - idx - 1 for idx, aid in enumerate(ordered_ids)},
            value=Activity.id,
        )
        await db.execute(
            update(Activity)
            .where(Activity.trip_id == trip_id)
            .where(bucket_filter)
            .where(Activity.id.in_(ordered_ids))
            .values(order_index=temp_case)
        )

        final_case = case({aid: idx for idx, aid in enumerate(ordered_ids)}, value=Activity.id)
        await db.execute(
            update(Activity)
            .where(Activity.trip_id == trip_id)
            .where(bucket_filter)
            .where(Activity.id.in_(ordered_ids))
            .values(order_index=final_case)
        )


class PlaceRepository:
    METADATA_ALLOWLIST = frozenset(
        {
            "website",
            "phone",
            "opening_hours",
            "rating",
            "price_level",
            "description",
            "tags",
            "hours",
            "cuisine",
        }
    )

    @staticmethod
    async def _sync_geom(
        db: AsyncSession,
        *,
        place_id: uuid.UUID,
        lat: float | None,
        lon: float | None,
    ) -> None:
        if lat is None or lon is None:
            return
        await db.execute(
            text(
                """
                UPDATE place
                SET geom = ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
                WHERE id = :place_id
                """
            ),
            {"place_id": place_id, "lat": lat, "lon": lon},
        )

    @staticmethod
    def _normalize_match_text(value: str | None) -> str:
        if not value:
            return ""
        return " ".join(value.lower().split())

    @staticmethod
    async def find_seed_match(
        db: AsyncSession,
        *,
        name: str,
        address_text: str | None = None,
        lat: float | None = None,
        lon: float | None = None,
    ) -> Place | None:
        normalized_name = PlaceRepository._normalize_match_text(name)
        if not normalized_name:
            return None

        normalized_address = PlaceRepository._normalize_match_text(address_text)
        rows = await db.execute(
            select(Place)
            .where(func.lower(func.trim(Place.name)) == normalized_name)
            .order_by(
                case(
                    (
                        func.lower(func.trim(func.coalesce(Place.address_text, "")))
                        == normalized_address,
                        0,
                    ),
                    else_=1,
                ),
                case((Place.canonical_place_id.is_(None), 0), else_=1),
                Place.updated_at.desc(),
            )
            .limit(12)
        )
        candidates = list(rows.scalars().all())
        if not candidates:
            return None

        if normalized_address:
            exact_address_matches = [
                place
                for place in candidates
                if PlaceRepository._normalize_match_text(place.address_text) == normalized_address
            ]
            if exact_address_matches:
                candidates = exact_address_matches

        if lat is not None and lon is not None:
            close_geo_matches = [
                place
                for place in candidates
                if place.lat is not None
                and place.lon is not None
                and abs(place.lat - lat) <= 0.01
                and abs(place.lon - lon) <= 0.01
            ]
            if close_geo_matches:
                candidates = close_geo_matches

        return candidates[0]

    @staticmethod
    async def create_place(db: AsyncSession, payload: PlaceCreateRequest) -> Place:
        if payload.external_id:
            existing_result = await db.execute(
                select(Place)
                .where(Place.source == payload.source)
                .where(Place.external_id == payload.external_id)
            )
            existing = existing_result.scalar_one_or_none()
            if existing:
                return existing

        place = Place(
            source=payload.source,
            external_id=payload.external_id,
            name=payload.name,
            category=payload.category,
            address_text=payload.address_text,
            lat=payload.lat,
            lon=payload.lon,
            metadata_json=payload.metadata,
            canonical_place_id=None,
            dedup_confidence=None,
            merged_at=None,
        )
        db.add(place)
        await db.flush()
        await PlaceRepository._sync_geom(db, place_id=place.id, lat=place.lat, lon=place.lon)
        await db.refresh(place)
        return place

    @staticmethod
    async def get_or_create_external_place(
        db: AsyncSession,
        *,
        source: str,
        external_id: str | None,
        name: str,
        category: str | None,
        address_text: str | None,
        lat: float | None,
        lon: float | None,
        metadata: dict | None = None,
    ) -> Place:
        if external_id:
            existing_result = await db.execute(
                select(Place)
                .where(Place.source == source)
                .where(Place.external_id == external_id)
            )
            existing = existing_result.scalar_one_or_none()
            if existing:
                existing.name = name
                existing.category = category
                existing.address_text = address_text
                existing.lat = lat
                existing.lon = lon
                existing.metadata_json = metadata or {}
                await db.flush()
                await PlaceRepository._sync_geom(
                    db,
                    place_id=existing.id,
                    lat=existing.lat,
                    lon=existing.lon,
                )
                await db.refresh(existing)
                return existing

        payload = PlaceCreateRequest(
            source=source,
            external_id=external_id,
            name=name,
            category=category,
            address_text=address_text,
            lat=lat,
            lon=lon,
            metadata=metadata or {},
        )
        return await PlaceRepository.create_place(db, payload)

    @staticmethod
    async def list_places(
        db: AsyncSession, q: str | None, limit: int, offset: int
    ) -> tuple[int, list[Place]]:
        return await PlaceRepository.search_places(db, q=q, limit=limit, offset=offset)

    @staticmethod
    async def search_places(
        db: AsyncSession, q: str | None, limit: int, offset: int
    ) -> tuple[int, list[Place]]:
        base_query = select(Place)
        count_query = select(func.count(Place.id))

        if q:
            pattern = f"%{q.lower()}%"
            name_predicate = func.lower(Place.name).like(pattern)
            address_predicate = func.lower(func.coalesce(Place.address_text, "")).like(pattern)
            base_query = base_query.where(or_(name_predicate, address_predicate))
            count_query = count_query.where(or_(name_predicate, address_predicate))

        total = int((await db.execute(count_query)).scalar_one())
        rows = await db.execute(base_query.order_by(Place.name.asc()).limit(limit).offset(offset))
        return total, list(rows.scalars().all())

    @staticmethod
    async def get_place(db: AsyncSession, place_id: uuid.UUID) -> Place:
        result = await db.execute(select(Place).where(Place.id == place_id))
        place = result.scalar_one_or_none()
        if not place:
            raise NotFoundError("Place not found")
        return place

    @staticmethod
    async def nearby_places(
        db: AsyncSession,
        *,
        lat: float,
        lon: float,
        radius_m: int,
        limit: int,
        offset: int,
    ) -> tuple[int, list[dict]]:
        params = {
            "lat": lat,
            "lon": lon,
            "radius_m": radius_m,
            "limit": limit,
            "offset": offset,
        }
        count_result = await db.execute(
            text(
                """
                SELECT COUNT(*) AS total
                FROM place
                WHERE geom IS NOT NULL
                  AND ST_DWithin(
                    geom,
                    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                    :radius_m
                  )
                """
            ),
            params,
        )
        total = int(count_result.scalar_one())

        rows_result = await db.execute(
            text(
                """
                SELECT
                  id,
                  source,
                  external_id,
                  name,
                  category,
                  address_text,
                  lat,
                  lon,
                  metadata_json,
                  canonical_place_id,
                  dedup_confidence,
                  merged_at,
                  created_at,
                  updated_at,
                  ST_Distance(
                    geom,
                    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
                  ) AS distance_m
                FROM place
                WHERE geom IS NOT NULL
                  AND ST_DWithin(
                    geom,
                    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                    :radius_m
                  )
                ORDER BY distance_m ASC, name ASC, id ASC
                LIMIT :limit OFFSET :offset
                """
            ),
            params,
        )
        return total, [dict(row._mapping) for row in rows_result]

    @staticmethod
    async def viewport_places(
        db: AsyncSession,
        *,
        min_lat: float,
        min_lon: float,
        max_lat: float,
        max_lon: float,
        limit: int,
        offset: int,
    ) -> tuple[int, list[dict]]:
        params = {
            "min_lat": min_lat,
            "min_lon": min_lon,
            "max_lat": max_lat,
            "max_lon": max_lon,
            "limit": limit,
            "offset": offset,
        }
        count_result = await db.execute(
            text(
                """
                SELECT COUNT(*) AS total
                FROM place
                WHERE geom IS NOT NULL
                  AND ST_Intersects(
                    geom::geometry,
                    ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)
                  )
                """
            ),
            params,
        )
        total = int(count_result.scalar_one())

        rows_result = await db.execute(
            text(
                """
                SELECT
                  id,
                  source,
                  external_id,
                  name,
                  category,
                  address_text,
                  lat,
                  lon,
                  metadata_json,
                  canonical_place_id,
                  dedup_confidence,
                  merged_at,
                  created_at,
                  updated_at
                FROM place
                WHERE geom IS NOT NULL
                  AND ST_Intersects(
                    geom::geometry,
                    ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)
                  )
                ORDER BY name ASC, id ASC
                LIMIT :limit OFFSET :offset
                """
            ),
            params,
        )
        return total, [dict(row._mapping) for row in rows_result]

    @staticmethod
    async def patch_metadata(
        db: AsyncSession,
        *,
        place_id: uuid.UUID,
        metadata_patch: dict,
    ) -> Place:
        place = await PlaceRepository.get_place(db, place_id)
        unknown = sorted(set(metadata_patch.keys()) - set(PlaceRepository.METADATA_ALLOWLIST))
        if unknown:
            raise ValidationApiError(
                "Unsupported metadata keys",
                {
                    "unsupported_keys": unknown,
                    "allowed_keys": sorted(PlaceRepository.METADATA_ALLOWLIST),
                },
            )

        merged = dict(place.metadata_json or {})
        merged.update(metadata_patch)
        place.metadata_json = merged
        await db.flush()
        await db.refresh(place)
        return place

    @staticmethod
    async def merge_places(
        db: AsyncSession,
        *,
        canonical_place_id: uuid.UUID,
        source_place_ids: list[uuid.UUID],
        dedup_confidence: float,
    ) -> dict:
        if not source_place_ids:
            raise ValidationApiError("source_place_ids cannot be empty")

        unique_sources = list(dict.fromkeys(source_place_ids))
        if canonical_place_id in unique_sources:
            raise ValidationApiError("Canonical place cannot be merged into itself")

        canonical = await PlaceRepository.get_place(db, canonical_place_id)
        if canonical.canonical_place_id is not None:
            raise ValidationApiError("Target place must be canonical")

        source_result = await db.execute(
            select(Place).where(Place.id.in_(unique_sources)).with_for_update()
        )
        sources = list(source_result.scalars().all())
        if len(sources) != len(unique_sources):
            found_ids = {place.id for place in sources}
            missing_ids = [
                str(place_id) for place_id in unique_sources if place_id not in found_ids
            ]
            raise NotFoundError(
                "One or more source places were not found", {"missing_place_ids": missing_ids}
            )

        alias_rewire_result = await db.execute(
            update(Place)
            .where(Place.canonical_place_id.in_(unique_sources))
            .values(
                canonical_place_id=canonical_place_id,
                dedup_confidence=dedup_confidence,
                merged_at=func.now(),
            )
        )
        source_update_result = await db.execute(
            update(Place)
            .where(Place.id.in_(unique_sources))
            .values(
                canonical_place_id=canonical_place_id,
                dedup_confidence=dedup_confidence,
                merged_at=func.now(),
            )
        )
        activity_update_result = await db.execute(
            update(Activity)
            .where(Activity.place_id.in_(unique_sources))
            .values(place_id=canonical_place_id)
        )
        event_update_result = await db.execute(
            update(EventSnapshot)
            .where(EventSnapshot.place_id.in_(unique_sources))
            .values(place_id=canonical_place_id)
        )
        proposal_update_result = await db.execute(
            update(ItineraryProposalActivity)
            .where(ItineraryProposalActivity.place_id.in_(unique_sources))
            .values(place_id=canonical_place_id)
        )
        await db.flush()

        return {
            "canonical_place_id": str(canonical_place_id),
            "merged_places": int(source_update_result.rowcount or 0),
            "relinked_aliases": int(alias_rewire_result.rowcount or 0),
            "remapped_activities": int(activity_update_result.rowcount or 0)
            + int(event_update_result.rowcount or 0)
            + int(proposal_update_result.rowcount or 0),
        }

    @staticmethod
    async def candidate_groups_for_dedup(
        db: AsyncSession, *, max_groups: int
    ) -> list[list[uuid.UUID]]:
        rows = await db.execute(
            text(
                """
                SELECT
                  ARRAY_AGG(id ORDER BY id) AS place_ids
                FROM (
                  SELECT
                    id,
                    LOWER(REGEXP_REPLACE(TRIM(name), '\\s+', ' ', 'g')) AS normalized_name
                  FROM place
                  WHERE canonical_place_id IS NULL
                    AND geom IS NOT NULL
                ) normalized
                GROUP BY normalized_name
                HAVING COUNT(*) > 1
                ORDER BY normalized_name
                LIMIT :max_groups
                """
            ),
            {"max_groups": max_groups},
        )
        groups: list[list[uuid.UUID]] = []
        for row in rows:
            groups.append(list(row._mapping["place_ids"]))
        return groups

    @staticmethod
    async def distance_between_places(
        db: AsyncSession,
        *,
        place_a_id: uuid.UUID,
        place_b_id: uuid.UUID,
    ) -> float | None:
        result = await db.execute(
            text(
                """
                SELECT ST_Distance(a.geom, b.geom) AS distance_m
                FROM place a
                JOIN place b ON TRUE
                WHERE a.id = :place_a_id
                  AND b.id = :place_b_id
                  AND a.geom IS NOT NULL
                  AND b.geom IS NOT NULL
                """
            ),
            {"place_a_id": place_a_id, "place_b_id": place_b_id},
        )
        value = result.scalar_one_or_none()
        return float(value) if value is not None else None


class EventRepository:
    @staticmethod
    def _is_attachable(item: EventSnapshot) -> bool:
        return item.entity_type in {"attraction", "restaurant"}

    @staticmethod
    def _to_discovery_item(item: EventSnapshot) -> ActivityDiscoveryItem:
        place = item.__dict__.get("place")
        lat = place.lat if place is not None else None
        lon = place.lon if place is not None else None
        return ActivityDiscoveryItem(
            id=str(item.id),
            snapshot_id=item.id,
            trip_id=item.trip_id,
            trip_day_id=item.trip_day_id,
            place_id=item.place_id,
            entity_type=item.entity_type or "attraction",
            provider=item.provider,
            provider_ref=item.provider_event_ref,
            title=item.title,
            summary=item.summary,
            rating=_coerce_float(item.rating),
            review_count=item.review_count,
            price_label=item.price_label,
            image_url=item.image_url,
            detail_url=item.deep_link,
            address_text=item.venue_address,
            lat=lat,
            lon=lon,
            tags=_unique_strings(
                list(item.tags_json or [])
                + [item.segment, item.genre]
            ),
            status_text=item.status_text or item.sales_status,
            is_attachable=EventRepository._is_attachable(item),
            created_at=item.created_at,
            updated_at=item.updated_at,
        )

    @staticmethod
    def to_discovery_item(item: EventSnapshot) -> ActivityDiscoveryItem:
        return EventRepository._to_discovery_item(item)

    @staticmethod
    def to_discovery_detail(item: EventSnapshot) -> ActivityDiscoveryDetail:
        base = EventRepository._to_discovery_item(item)
        provider_detail = item.provider_detail_json or {}
        return ActivityDiscoveryDetail(
            **base.model_dump(),
            photos=provider_detail.get("photos") or [],
            reviews=provider_detail.get("reviews") or [],
            hours=provider_detail.get("hours") or [],
            booking_links=provider_detail.get("booking_links") or [],
            provider_payload=provider_detail.get("provider_payload")
            or item.raw_payload_json
            or {},
        )

    @staticmethod
    async def create_snapshot(
        db: AsyncSession,
        *,
        trip_id: uuid.UUID,
        trip_day_id: uuid.UUID | None,
        provider: str,
        entity_type: str | None,
        provider_event_ref: str,
        title: str,
        summary: str | None,
        start_at: datetime | None,
        end_at: datetime | None,
        timezone: str | None,
        venue_name: str | None,
        venue_address: str | None,
        rating,
        review_count: int | None,
        price_label: str | None,
        place_id: uuid.UUID | None,
        segment: str | None,
        genre: str | None,
        tags_json: list[str] | None,
        status_text: str | None,
        min_price,
        max_price,
        currency: str | None,
        image_url: str | None,
        deep_link: str | None,
        sales_status: str | None,
        request_fingerprint: str | None,
        raw_payload_json: dict,
        provider_detail_json: dict | None,
        expires_at: datetime | None,
    ) -> EventSnapshot:
        if trip_day_id is not None:
            await OfferRepository._assert_trip_day_matches_trip(
                db,
                trip_id=trip_id,
                trip_day_id=trip_day_id,
            )

        existing_row = await db.execute(
            select(EventSnapshot)
            .where(EventSnapshot.trip_id == trip_id)
            .where(EventSnapshot.provider == provider)
            .where(EventSnapshot.provider_event_ref == provider_event_ref)
        )
        existing = existing_row.scalar_one_or_none()
        if existing:
            existing.trip_day_id = trip_day_id
            existing.entity_type = entity_type
            existing.title = title
            existing.summary = summary
            existing.start_at = start_at
            existing.end_at = end_at
            existing.timezone = timezone
            existing.venue_name = venue_name
            existing.venue_address = venue_address
            existing.rating = rating
            existing.review_count = review_count
            existing.price_label = price_label
            existing.place_id = place_id
            existing.segment = segment
            existing.genre = genre
            existing.tags_json = tags_json or []
            existing.status_text = status_text
            existing.min_price = min_price
            existing.max_price = max_price
            existing.currency = currency
            existing.image_url = image_url
            existing.deep_link = deep_link
            existing.sales_status = sales_status
            existing.request_fingerprint = request_fingerprint
            existing.raw_payload_json = raw_payload_json
            existing.provider_detail_json = provider_detail_json or {}
            existing.expires_at = expires_at
            await db.flush()
            await db.refresh(existing)
            return existing

        item = EventSnapshot(
            trip_id=trip_id,
            trip_day_id=trip_day_id,
            provider=provider,
            entity_type=entity_type,
            provider_event_ref=provider_event_ref,
            title=title,
            summary=summary,
            start_at=start_at,
            end_at=end_at,
            timezone=timezone,
            venue_name=venue_name,
            venue_address=venue_address,
            rating=rating,
            review_count=review_count,
            price_label=price_label,
            place_id=place_id,
            segment=segment,
            genre=genre,
            tags_json=tags_json or [],
            status_text=status_text,
            min_price=min_price,
            max_price=max_price,
            currency=currency,
            image_url=image_url,
            deep_link=deep_link,
            sales_status=sales_status,
            request_fingerprint=request_fingerprint,
            raw_payload_json=raw_payload_json,
            provider_detail_json=provider_detail_json or {},
            expires_at=expires_at,
        )
        db.add(item)
        await db.flush()
        await db.refresh(item)
        return item

    @staticmethod
    async def list_trip_saved_activities(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        limit: int,
        offset: int,
    ) -> tuple[int, list[EventSnapshot]]:
        await TripRepository.get_trip(db, user_id, trip_id)
        count = int(
            (
                await db.execute(
                    select(func.count(EventSnapshot.id))
                    .where(EventSnapshot.trip_id == trip_id)
                    .where(EventSnapshot.provider == "tripadvisor")
                )
            ).scalar_one()
        )
        rows = await db.execute(
            select(EventSnapshot)
            .where(EventSnapshot.trip_id == trip_id)
            .where(EventSnapshot.provider == "tripadvisor")
            .options(selectinload(EventSnapshot.place))
            .order_by(
                EventSnapshot.created_at.desc(),
                EventSnapshot.start_at.asc().nulls_last(),
                EventSnapshot.id.asc(),
            )
            .limit(limit)
            .offset(offset)
        )
        return count, list(rows.scalars().all())

    @staticmethod
    async def get_snapshot_for_user(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        snapshot_id: uuid.UUID,
    ) -> EventSnapshot:
        row = await db.execute(
            select(EventSnapshot)
            .options(selectinload(EventSnapshot.place))
            .join(Trip, EventSnapshot.trip_id == Trip.id)
            .where(EventSnapshot.id == snapshot_id)
            .where(Trip.user_id == user_id)
        )
        item = row.scalar_one_or_none()
        if not item:
            raise NotFoundError("Activity not found")
        return item

    @staticmethod
    async def attach_snapshot_to_day(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        snapshot_id: uuid.UUID,
        trip_day_id: uuid.UUID,
    ) -> Activity:
        await TripRepository.get_trip(db, user_id, trip_id)
        day = await DayRepository.get_day_for_user(db, user_id, trip_day_id)
        if day.trip_id != trip_id:
            raise ValidationApiError("trip_day_id must belong to the trip")

        snapshot = await EventRepository.get_snapshot_for_user(
            db,
            user_id=user_id,
            snapshot_id=snapshot_id,
        )
        if snapshot.trip_id != trip_id:
            raise NotFoundError("Activity not found")
        if not EventRepository._is_attachable(snapshot):
            raise ValidationApiError("Only attractions and restaurants can be attached to itinerary days")

        count_result = await db.execute(
            select(func.count(Activity.id)).where(Activity.trip_day_id == day.id)
        )
        order_index = int(count_result.scalar_one())
        duration_min = None
        start_time = None
        if snapshot.start_at is not None:
            start_time = snapshot.start_at.time().replace(tzinfo=None)
        if snapshot.start_at is not None and snapshot.end_at is not None:
            delta = int((snapshot.end_at - snapshot.start_at).total_seconds() // 60)
            duration_min = max(delta, 30)

        activity = Activity(
            trip_id=day.trip_id,
            trip_day_id=day.id,
            order_index=order_index,
            title=snapshot.title,
            description=snapshot.summary,
            start_time=start_time,
            duration_min=duration_min,
            tags_json=_unique_strings(
                list(snapshot.tags_json or [])
                + [snapshot.entity_type, snapshot.segment, snapshot.genre]
            ),
            estimated_cost_amount=snapshot.min_price or snapshot.max_price,
            estimated_cost_currency=snapshot.currency,
            place_id=snapshot.place_id,
            event_snapshot_id=snapshot.id,
            notes=None,
            is_favorite=False,
            source="manual",
        )
        db.add(activity)
        snapshot.trip_day_id = day.id
        await TripRepository.bump_version(db, trip_id)
        await db.flush()
        await db.refresh(activity)
        return activity

    @staticmethod
    async def list_trip_events(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        limit: int,
        offset: int,
    ) -> tuple[int, list[EventSnapshot]]:
        return await EventRepository.list_trip_saved_activities(
            db,
            user_id=user_id,
            trip_id=trip_id,
            limit=limit,
            offset=offset,
        )

    @staticmethod
    async def get_event_for_user(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        event_id: uuid.UUID,
    ) -> EventSnapshot:
        return await EventRepository.get_snapshot_for_user(
            db,
            user_id=user_id,
            snapshot_id=event_id,
        )

    @staticmethod
    async def attach_event_to_day(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        event_id: uuid.UUID,
        trip_day_id: uuid.UUID,
    ) -> Activity:
        return await EventRepository.attach_snapshot_to_day(
            db,
            user_id=user_id,
            trip_id=trip_id,
            snapshot_id=event_id,
            trip_day_id=trip_day_id,
        )


class PlacePhotoRepository:
    @staticmethod
    def _summary(item: PlacePhoto) -> PlacePhotoSummary:
        return PlacePhotoSummary(
            id=item.id,
            source=item.source,
            image_url=item.image_url,
            thumbnail_url=item.thumbnail_url,
            display_url=build_place_photo_asset_url(item.id, "full"),
            display_thumbnail_url=build_place_photo_asset_url(item.id, "thumb"),
            license_code=item.license_code,
            license_url=item.license_url,
            attribution_text=item.attribution_text,
        )

    @staticmethod
    def _response(item: PlacePhoto) -> PlacePhotoResponse:
        return PlacePhotoResponse(
            id=item.id,
            place_id=item.place_id,
            source=item.source,
            source_media_ref=item.source_media_ref,
            image_url=item.image_url,
            thumbnail_url=item.thumbnail_url,
            display_url=build_place_photo_asset_url(item.id, "full"),
            display_thumbnail_url=build_place_photo_asset_url(item.id, "thumb"),
            width=item.width,
            height=item.height,
            license_code=item.license_code,
            license_url=item.license_url,
            author_name=item.author_name,
            author_url=item.author_url,
            attribution_text=item.attribution_text,
            rank=item.rank,
            is_primary=item.is_primary,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )

    @staticmethod
    async def replace_photos(
        db: AsyncSession,
        *,
        place_id: uuid.UUID,
        items: list[dict[str, Any]],
    ) -> list[PlacePhoto]:
        place = await PlaceRepository.get_place(db, place_id)
        existing = await db.execute(select(PlacePhoto).where(PlacePhoto.place_id == place.id))
        for row in existing.scalars().all():
            await db.delete(row)
        await db.flush()

        created: list[PlacePhoto] = []
        for idx, item in enumerate(items):
            photo = PlacePhoto(
                place_id=place_id,
                source=item["source"],
                source_media_ref=item["source_media_ref"],
                image_url=item["image_url"],
                thumbnail_url=item.get("thumbnail_url"),
                width=item.get("width"),
                height=item.get("height"),
                license_code=item.get("license_code"),
                license_url=item.get("license_url"),
                author_name=item.get("author_name"),
                author_url=item.get("author_url"),
                attribution_text=item.get("attribution_text"),
                rank=idx,
                is_primary=idx == 0,
                raw_payload_json=item.get("raw_payload_json") or {},
            )
            db.add(photo)
            created.append(photo)

        await db.flush()
        for photo in created:
            await db.refresh(photo)
        return created

    @staticmethod
    async def list_photos(
        db: AsyncSession,
        *,
        place_id: uuid.UUID,
    ) -> list[PlacePhoto]:
        await PlaceRepository.get_place(db, place_id)
        rows = await db.execute(
            select(PlacePhoto)
            .where(PlacePhoto.place_id == place_id)
            .order_by(PlacePhoto.rank.asc(), PlacePhoto.created_at.asc(), PlacePhoto.id.asc())
        )
        return list(rows.scalars().all())

    @staticmethod
    async def get_photo(
        db: AsyncSession,
        *,
        photo_id: uuid.UUID,
    ) -> PlacePhoto:
        row = await db.execute(select(PlacePhoto).where(PlacePhoto.id == photo_id))
        photo = row.scalar_one_or_none()
        if photo is None:
            raise NotFoundError("PLACE_PHOTO_NOT_FOUND", "Place photo not found")
        return photo

    @staticmethod
    async def get_photo_summary(
        db: AsyncSession,
        *,
        place_id: uuid.UUID,
    ) -> tuple[int, PlacePhotoSummary | None]:
        rows = await db.execute(
            select(PlacePhoto)
            .where(PlacePhoto.place_id == place_id)
            .order_by(PlacePhoto.rank.asc(), PlacePhoto.created_at.asc(), PlacePhoto.id.asc())
        )
        photos = list(rows.scalars().all())
        if not photos:
            return 0, None
        primary = next((item for item in photos if item.is_primary), photos[0])
        return len(photos), PlacePhotoRepository._summary(primary)

    @staticmethod
    async def photo_summaries_for_place_ids(
        db: AsyncSession,
        place_ids: list[uuid.UUID],
    ) -> dict[uuid.UUID, tuple[int, PlacePhotoSummary | None]]:
        if not place_ids:
            return {}
        rows = await db.execute(
            select(PlacePhoto)
            .where(PlacePhoto.place_id.in_(place_ids))
            .order_by(PlacePhoto.place_id.asc(), PlacePhoto.rank.asc(), PlacePhoto.id.asc())
        )
        grouped: dict[uuid.UUID, list[PlacePhoto]] = {}
        for item in rows.scalars().all():
            grouped.setdefault(item.place_id, []).append(item)
        result: dict[uuid.UUID, tuple[int, PlacePhotoSummary | None]] = {}
        for place_id in place_ids:
            items = grouped.get(place_id, [])
            if not items:
                result[place_id] = (0, None)
                continue
            primary = next((item for item in items if item.is_primary), items[0])
            result[place_id] = (len(items), PlacePhotoRepository._summary(primary))
        return result

    @staticmethod
    def to_response(item: PlacePhoto) -> PlacePhotoResponse:
        return PlacePhotoRepository._response(item)


class ProposalRepository:
    @staticmethod
    def _activity_response(item: ItineraryProposalActivity) -> ProposalActivityResponse:
        return ProposalActivityResponse(
            id=item.id,
            proposal_id=item.proposal_id,
            trip_day_id=item.trip_day_id,
            source_activity_id=item.source_activity_id,
            event_snapshot_id=item.event_snapshot_id,
            place_id=item.place_id,
            order_index=item.order_index,
            title=item.title,
            description=item.description,
            start_time=item.start_time,
            duration_min=item.duration_min,
            estimated_cost_amount=item.estimated_cost_amount,
            estimated_cost_currency=item.estimated_cost_currency,
            tags=item.tags_json,
            rationale=item.rationale_json,
            score=item.score_json,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )

    @staticmethod
    def _proposal_response(item: ItineraryProposal) -> ProposalResponse:
        return ProposalResponse(
            id=item.id,
            trip_id=item.trip_id,
            user_id=item.user_id,
            job_id=item.job_id,
            based_on_trip_version=item.based_on_trip_version,
            objective=item.objective,
            scope_day_ids=[uuid.UUID(str(value)) for value in item.scope_day_ids_json],
            status=item.status,
            summary=item.summary_json or {},
            score=item.score_json or {},
            items=[ProposalRepository._activity_response(entry) for entry in item.items],
            created_at=item.created_at,
            updated_at=item.updated_at,
        )

    @staticmethod
    async def create_proposal(
        db: AsyncSession,
        *,
        proposal_id: uuid.UUID,
        trip_id: uuid.UUID,
        user_id: uuid.UUID,
        job_id: uuid.UUID,
        based_on_trip_version: int,
        objective: str,
        scope_day_ids: list[uuid.UUID],
        summary_json: dict[str, Any],
        score_json: dict[str, Any],
        items: list[dict[str, Any]],
    ) -> ItineraryProposal:
        existing_row = await db.execute(
            select(ItineraryProposal)
            .options(selectinload(ItineraryProposal.items))
            .where(ItineraryProposal.job_id == job_id)
        )
        existing = existing_row.scalar_one_or_none()
        if existing is not None:
            if existing.items:
                return existing
            proposal = existing
            proposal.trip_id = trip_id
            proposal.user_id = user_id
            proposal.based_on_trip_version = based_on_trip_version
            proposal.objective = objective
            proposal.scope_day_ids_json = [str(item) for item in scope_day_ids]
            proposal.status = "READY"
            proposal.summary_json = summary_json
            proposal.score_json = score_json
        else:
            proposal = ItineraryProposal(
                id=proposal_id,
                trip_id=trip_id,
                user_id=user_id,
                job_id=job_id,
                based_on_trip_version=based_on_trip_version,
                objective=objective,
                scope_day_ids_json=[str(item) for item in scope_day_ids],
                status="READY",
                summary_json=summary_json,
                score_json=score_json,
            )
            db.add(proposal)
            await db.flush()

        existing_items_row = await db.execute(
            select(ItineraryProposalActivity).where(ItineraryProposalActivity.proposal_id == proposal.id)
        )
        for existing_item in existing_items_row.scalars().all():
            await db.delete(existing_item)
        await db.flush()

        for item in items:
            db.add(
                ItineraryProposalActivity(
                    proposal_id=proposal.id,
                    trip_day_id=item["trip_day_id"],
                    source_activity_id=item.get("source_activity_id"),
                    event_snapshot_id=item.get("event_snapshot_id"),
                    place_id=item.get("place_id"),
                    order_index=item["order_index"],
                    title=item["title"],
                    description=item.get("description"),
                    start_time=item.get("start_time"),
                    duration_min=item.get("duration_min"),
                    estimated_cost_amount=item.get("estimated_cost_amount"),
                    estimated_cost_currency=item.get("estimated_cost_currency"),
                    tags_json=item.get("tags_json") or [],
                    rationale_json=item.get("rationale_json") or {},
                    score_json=item.get("score_json") or {},
                )
            )

        await db.flush()
        proposal = await ProposalRepository.get_proposal_by_id(db, proposal_id=proposal.id)
        return proposal

    @staticmethod
    async def list_trip_proposals(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        limit: int,
        offset: int,
    ) -> tuple[int, list[ItineraryProposal]]:
        await TripRepository.get_trip(db, user_id, trip_id)
        total = int(
            (
                await db.execute(
                    select(func.count(ItineraryProposal.id)).where(ItineraryProposal.trip_id == trip_id)
                )
            ).scalar_one()
        )
        rows = await db.execute(
            select(ItineraryProposal)
            .options(selectinload(ItineraryProposal.items))
            .where(ItineraryProposal.trip_id == trip_id)
            .order_by(ItineraryProposal.created_at.desc(), ItineraryProposal.id.desc())
            .limit(limit)
            .offset(offset)
        )
        items = list(rows.scalars().unique().all())
        return total, items

    @staticmethod
    async def get_proposal(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        proposal_id: uuid.UUID,
    ) -> ItineraryProposal:
        row = await db.execute(
            select(ItineraryProposal)
            .options(selectinload(ItineraryProposal.items))
            .join(Trip, ItineraryProposal.trip_id == Trip.id)
            .where(ItineraryProposal.id == proposal_id)
            .where(Trip.user_id == user_id)
        )
        proposal = row.scalar_one_or_none()
        if not proposal:
            raise NotFoundError("Proposal not found")
        return proposal

    @staticmethod
    async def get_proposal_by_id(
        db: AsyncSession,
        *,
        proposal_id: uuid.UUID,
    ) -> ItineraryProposal | None:
        row = await db.execute(
            select(ItineraryProposal)
            .options(selectinload(ItineraryProposal.items))
            .where(ItineraryProposal.id == proposal_id)
        )
        proposal = row.scalar_one_or_none()
        return proposal

    @staticmethod
    async def mark_applied(
        db: AsyncSession,
        *,
        proposal_id: uuid.UUID,
    ) -> ItineraryProposal | None:
        proposal = await ProposalRepository.get_proposal_by_id(db, proposal_id=proposal_id)
        if proposal is None:
            return None
        proposal.status = "APPLIED"
        await db.flush()
        await db.refresh(proposal)
        return proposal

    @staticmethod
    def to_response(item: ItineraryProposal) -> ProposalResponse:
        return ProposalRepository._proposal_response(item)


class OfferRepository:
    @staticmethod
    def _geo_point(value: Any) -> OfferGeoPoint | None:
        if not isinstance(value, dict):
            return None
        latitude = _coerce_float(value.get("latitude"))
        longitude = _coerce_float(value.get("longitude"))
        if latitude is None or longitude is None:
            return None
        return OfferGeoPoint(latitude=latitude, longitude=longitude)

    @staticmethod
    def _transport_details_from_raw(raw_payload: dict | None) -> TransportOfferDetails | None:
        if not isinstance(raw_payload, dict):
            return None

        segments_raw = raw_payload.get("segments") if isinstance(raw_payload.get("segments"), list) else []
        layovers_raw = raw_payload.get("layovers") if isinstance(raw_payload.get("layovers"), list) else []
        details = TransportOfferDetails(
            stops_count=_coerce_int(raw_payload.get("stops_count")),
            total_duration_min=_coerce_int(raw_payload.get("total_duration_min")),
            cabin=_coerce_string(raw_payload.get("cabin")),
            baggage_summary=_coerce_string(raw_payload.get("baggage_summary")),
            validating_airline_codes=_unique_strings(
                raw_payload.get("validating_airline_codes")
                if isinstance(raw_payload.get("validating_airline_codes"), list)
                else []
            ),
            bookable_seats=_coerce_int(raw_payload.get("bookable_seats")),
            additional_baggage_price=_coerce_decimal(raw_payload.get("additional_baggage_price")),
            additional_baggage_currency=_coerce_string(raw_payload.get("additional_baggage_currency")),
            emissions_kg=_coerce_decimal(raw_payload.get("emissions_kg")),
            emissions_description=_coerce_string(raw_payload.get("emissions_description")),
            origin_geo=OfferRepository._geo_point(raw_payload.get("origin_geo")),
            destination_geo=OfferRepository._geo_point(raw_payload.get("destination_geo")),
        )

        for index, segment in enumerate(segments_raw):
            if not isinstance(segment, dict):
                continue
            departure = segment.get("departure") if isinstance(segment.get("departure"), dict) else {}
            arrival = segment.get("arrival") if isinstance(segment.get("arrival"), dict) else {}
            details.segments.append(
                TransportSegmentDetail(
                    itinerary_index=_coerce_int(segment.get("itineraryIndex")) or 0,
                    sequence=_coerce_int(segment.get("sequence")) or (index + 1),
                    airline_code=_coerce_string(segment.get("carrierCode")),
                    airline_name=_coerce_string(segment.get("airlineName")),
                    operating_airline_code=_coerce_string(segment.get("operatingCarrierCode")),
                    operating_airline_name=_coerce_string(segment.get("operatingAirlineName")),
                    flight_number=_coerce_string(segment.get("flightNumber")),
                    departure_iata=_coerce_string(departure.get("iataCode")),
                    departure_at=departure.get("at"),
                    departure_terminal=_coerce_string(departure.get("terminal")),
                    arrival_iata=_coerce_string(arrival.get("iataCode")),
                    arrival_at=arrival.get("at"),
                    arrival_terminal=_coerce_string(arrival.get("terminal")),
                    duration_min=_coerce_int(segment.get("durationMin"))
                    or _iso_duration_to_minutes(segment.get("duration")),
                    cabin=_coerce_string(segment.get("cabin")),
                    fare_basis=_coerce_string(segment.get("fareBasis")),
                    branded_fare=_coerce_string(segment.get("brandedFare")),
                    baggage_summary=_coerce_string(segment.get("baggageSummary")),
                )
            )

        for layover in layovers_raw:
            if not isinstance(layover, dict):
                continue
            details.layovers.append(
                TransportLayoverDetail(
                    itinerary_index=_coerce_int(layover.get("itineraryIndex")) or 0,
                    airport_code=_coerce_string(layover.get("airportCode")),
                    duration_min=_coerce_int(layover.get("durationMin")),
                )
            )

        if details.stops_count is None and details.segments:
            itinerary_indexes = {segment.itinerary_index for segment in details.segments}
            inferred = 0
            for itinerary_index in itinerary_indexes:
                count = len(
                    [segment for segment in details.segments if segment.itinerary_index == itinerary_index]
                )
                inferred += max(count - 1, 0)
            details.stops_count = inferred

        if (
            not details.segments
            and not details.layovers
            and details.total_duration_min is None
            and details.bookable_seats is None
            and details.origin_geo is None
            and details.destination_geo is None
        ):
            return None

        return details

    @staticmethod
    def _lodging_details_from_raw(
        raw_payload: dict | None,
        *,
        place_id: uuid.UUID | None,
        photo_summary: tuple[int, PlacePhotoSummary | None] | None,
    ) -> LodgingOfferDetails | None:
        if not isinstance(raw_payload, dict) and place_id is None:
            return None

        hotel = raw_payload.get("hotel") if isinstance(raw_payload, dict) and isinstance(raw_payload.get("hotel"), dict) else {}
        offer = raw_payload.get("offer") if isinstance(raw_payload, dict) and isinstance(raw_payload.get("offer"), dict) else {}
        rating = raw_payload.get("rating") if isinstance(raw_payload, dict) and isinstance(raw_payload.get("rating"), dict) else {}
        address = hotel.get("address") if isinstance(hotel.get("address"), dict) else {}
        geo_code = hotel.get("geoCode") if isinstance(hotel.get("geoCode"), dict) else {}
        price = offer.get("price") if isinstance(offer.get("price"), dict) else {}
        policies = offer.get("policies") if isinstance(offer.get("policies"), dict) else {}
        cancellation = policies.get("cancellation") if isinstance(policies.get("cancellation"), dict) else {}
        price_variations = price.get("variations") if isinstance(price.get("variations"), dict) else {}
        average_variation = (
            price_variations.get("average") if isinstance(price_variations.get("average"), dict) else {}
        )

        tax_total = None
        taxes = price.get("taxes") if isinstance(price.get("taxes"), list) else []
        if taxes:
            amounts = [_coerce_decimal(item.get("amount")) for item in taxes if isinstance(item, dict)]
            tax_total = sum((amount for amount in amounts if amount is not None), Decimal("0"))

        distance = hotel.get("distance") if isinstance(hotel.get("distance"), dict) else {}
        address_lines = address.get("lines") if isinstance(address.get("lines"), list) else []
        full_address = ", ".join([line for line in address_lines if isinstance(line, str) and line.strip()])
        if not full_address:
            full_address = _coerce_string(address.get("label"))

        room_description = None
        room_description_obj = offer.get("roomDescription")
        if isinstance(room_description_obj, dict):
            room_description = _coerce_string(room_description_obj.get("text") or room_description_obj.get("name"))
        if room_description is None:
            room = offer.get("room") if isinstance(offer.get("room"), dict) else {}
            room_description = _coerce_string(room.get("description"))

        photo_count = photo_summary[0] if photo_summary is not None else 0
        primary_photo = photo_summary[1] if photo_summary is not None else None
        details = LodgingOfferDetails(
            hotel_id=_coerce_string(hotel.get("hotelId")),
            hotel_name=_coerce_string(hotel.get("name")),
            chain_code=_coerce_string(hotel.get("chainCode")),
            brand=_coerce_string(hotel.get("brandCode")),
            star_rating=_coerce_int(hotel.get("rating") or hotel.get("hotelRating")),
            sentiment_rating=_coerce_int(
                rating.get("overallRating") or rating.get("overall") or rating.get("sentiment")
            ),
            amenities=[
                _titleize_token(item)
                for item in _unique_strings(hotel.get("amenities") if isinstance(hotel.get("amenities"), list) else [])
            ],
            address_text=full_address,
            latitude=_coerce_float(geo_code.get("latitude")),
            longitude=_coerce_float(geo_code.get("longitude")),
            distance_km=_coerce_float(distance.get("value")),
            room_description=room_description,
            payment_type=_coerce_string(policies.get("paymentType")),
            cancellation_summary=_coerce_string(
                cancellation.get("description") or cancellation.get("type") or policies.get("deposit")
            ),
            nightly_rate_amount=_coerce_decimal(
                average_variation.get("total") or average_variation.get("base") or price.get("base")
            ),
            taxes_amount=tax_total,
            place_id=place_id,
            photo_count=photo_count,
            primary_photo=primary_photo,
        )

        if (
            details.hotel_id is None
            and details.hotel_name is None
            and details.place_id is None
            and details.latitude is None
            and details.longitude is None
        ):
            return None

        return details

    @staticmethod
    def _offer_response_from_transport(offer: TransportOffer) -> OfferResponse:
        return OfferResponse(
            id=offer.id,
            kind=OfferKind.TRANSPORT,
            trip_id=offer.trip_id,
            trip_day_id=offer.trip_day_id,
            provider=offer.provider,
            title=offer.title,
            price_amount=offer.price_amount,
            currency=offer.currency,
            deep_link=offer.deep_link,
            expires_at=offer.expires_at,
            is_current=offer.is_current,
            superseded_by_offer_id=offer.superseded_by_offer_id,
            created_at=offer.created_at,
            updated_at=offer.updated_at,
            transport_mode=offer.transport_mode,
            origin_text=offer.origin_text,
            destination_text=offer.destination_text,
            depart_at=offer.depart_at,
            arrive_at=offer.arrive_at,
            raw_payload_json=offer.raw_payload_json,
            transport_details=OfferRepository._transport_details_from_raw(offer.raw_payload_json),
        )

    @staticmethod
    def _offer_response_from_lodging(
        offer: LodgingOffer,
        *,
        photo_summary: tuple[int, PlacePhotoSummary | None] | None = None,
    ) -> OfferResponse:
        return OfferResponse(
            id=offer.id,
            kind=OfferKind.LODGING,
            trip_id=offer.trip_id,
            trip_day_id=offer.trip_day_id,
            provider=offer.provider,
            title=offer.title,
            price_amount=offer.price_amount,
            currency=offer.currency,
            deep_link=offer.deep_link,
            expires_at=offer.expires_at,
            is_current=offer.is_current,
            superseded_by_offer_id=offer.superseded_by_offer_id,
            created_at=offer.created_at,
            updated_at=offer.updated_at,
            lodging_type=offer.lodging_type,
            location_text=offer.location_text,
            room_type=offer.room_type,
            checkin_date=offer.checkin_date,
            checkout_date=offer.checkout_date,
            nights=offer.nights,
            raw_payload_json=offer.raw_payload_json,
            lodging_details=OfferRepository._lodging_details_from_raw(
                offer.raw_payload_json,
                place_id=offer.place_id,
                photo_summary=photo_summary,
            ),
        )

    @staticmethod
    async def _assert_trip_day_matches_trip(
        db: AsyncSession, *, trip_id: uuid.UUID, trip_day_id: uuid.UUID | None
    ) -> None:
        if trip_day_id is None:
            return
        row = await db.execute(
            select(TripDay.id).where(TripDay.id == trip_day_id).where(TripDay.trip_id == trip_id)
        )
        if row.scalar_one_or_none() is None:
            raise ValidationApiError("trip_day_id must belong to trip_id")

    @staticmethod
    async def create_transport_snapshot(
        db: AsyncSession,
        *,
        trip_id: uuid.UUID,
        trip_day_id: uuid.UUID | None,
        provider: str,
        request_fingerprint: str | None,
        provider_offer_ref: str | None,
        title: str,
        transport_mode: str | None,
        origin_text: str | None,
        destination_text: str | None,
        depart_at: datetime | None,
        arrive_at: datetime | None,
        price_amount,
        currency: str,
        deep_link: str | None,
        expires_at: datetime,
        raw_payload_json: dict,
    ) -> TransportOffer:
        await OfferRepository._assert_trip_day_matches_trip(
            db, trip_id=trip_id, trip_day_id=trip_day_id
        )
        offer = TransportOffer(
            trip_id=trip_id,
            trip_day_id=trip_day_id,
            provider=provider,
            request_fingerprint=request_fingerprint,
            provider_offer_ref=provider_offer_ref,
            title=title,
            transport_mode=transport_mode,
            origin_text=origin_text,
            destination_text=destination_text,
            depart_at=depart_at,
            arrive_at=arrive_at,
            price_amount=price_amount,
            currency=currency,
            deep_link=deep_link,
            expires_at=expires_at,
            is_current=True,
            superseded_by_offer_id=None,
            raw_payload_json=raw_payload_json,
        )
        db.add(offer)
        await db.flush()
        await db.refresh(offer)
        return offer

    @staticmethod
    async def create_lodging_snapshot(
        db: AsyncSession,
        *,
        trip_id: uuid.UUID,
        trip_day_id: uuid.UUID | None,
        provider: str,
        request_fingerprint: str | None,
        provider_offer_ref: str | None,
        title: str,
        lodging_type: str | None,
        location_text: str | None,
        room_type: str | None,
        checkin_date,
        checkout_date,
        nights: int | None,
        place_id: uuid.UUID | None,
        price_amount,
        currency: str,
        deep_link: str | None,
        expires_at: datetime,
        raw_payload_json: dict,
    ) -> LodgingOffer:
        await OfferRepository._assert_trip_day_matches_trip(
            db, trip_id=trip_id, trip_day_id=trip_day_id
        )
        offer = LodgingOffer(
            trip_id=trip_id,
            trip_day_id=trip_day_id,
            provider=provider,
            request_fingerprint=request_fingerprint,
            provider_offer_ref=provider_offer_ref,
            title=title,
            lodging_type=lodging_type,
            location_text=location_text,
            room_type=room_type,
            checkin_date=checkin_date,
            checkout_date=checkout_date,
            nights=nights,
            place_id=place_id,
            price_amount=price_amount,
            currency=currency,
            deep_link=deep_link,
            expires_at=expires_at,
            is_current=True,
            superseded_by_offer_id=None,
            raw_payload_json=raw_payload_json,
        )
        db.add(offer)
        await db.flush()
        await db.refresh(offer)
        return offer

    @staticmethod
    async def list_offers(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        kind: OfferKind | None,
        transport_modes: list[str] | None,
        lodging_types: list[str] | None,
        current_only: bool,
        limit: int,
        offset: int,
    ) -> tuple[int, list[OfferResponse]]:
        await TripRepository.get_trip(db, user_id, trip_id)

        if kind == OfferKind.TRANSPORT:
            query = select(TransportOffer).where(TransportOffer.trip_id == trip_id)
            if current_only:
                query = query.where(TransportOffer.is_current.is_(True))
            if transport_modes:
                query = query.where(TransportOffer.transport_mode.in_(transport_modes))
            count = int(
                (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
            )
            rows = await db.execute(
                query.order_by(TransportOffer.created_at.desc()).limit(limit).offset(offset)
            )
            return count, [
                OfferRepository._offer_response_from_transport(item)
                for item in rows.scalars().all()
            ]

        if kind == OfferKind.LODGING:
            query = select(LodgingOffer).where(LodgingOffer.trip_id == trip_id)
            if current_only:
                query = query.where(LodgingOffer.is_current.is_(True))
            if lodging_types:
                query = query.where(LodgingOffer.lodging_type.in_(lodging_types))
            count = int(
                (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
            )
            rows = (
                await db.execute(
                query.order_by(LodgingOffer.created_at.desc()).limit(limit).offset(offset)
                )
            ).scalars().all()
            photo_summary_map = await PlacePhotoRepository.photo_summaries_for_place_ids(
                db,
                [item.place_id for item in rows if item.place_id is not None],
            )
            return count, [
                OfferRepository._offer_response_from_lodging(
                    item,
                    photo_summary=photo_summary_map.get(item.place_id) if item.place_id else None,
                )
                for item in rows
            ]

        transport_query = select(TransportOffer).where(TransportOffer.trip_id == trip_id)
        lodging_query = select(LodgingOffer).where(LodgingOffer.trip_id == trip_id)
        if current_only:
            transport_query = transport_query.where(TransportOffer.is_current.is_(True))
            lodging_query = lodging_query.where(LodgingOffer.is_current.is_(True))
        if transport_modes:
            transport_query = transport_query.where(TransportOffer.transport_mode.in_(transport_modes))
        if lodging_types:
            lodging_query = lodging_query.where(LodgingOffer.lodging_type.in_(lodging_types))

        transport_rows = list(
            (await db.execute(transport_query.order_by(TransportOffer.created_at.desc()))).scalars().all()
        )
        lodging_rows = list(
            (await db.execute(lodging_query.order_by(LodgingOffer.created_at.desc()))).scalars().all()
        )
        photo_summary_map = await PlacePhotoRepository.photo_summaries_for_place_ids(
            db,
            [item.place_id for item in lodging_rows if item.place_id is not None],
        )

        combined = [OfferRepository._offer_response_from_transport(item) for item in transport_rows]
        combined.extend(
            [
                OfferRepository._offer_response_from_lodging(
                    item,
                    photo_summary=photo_summary_map.get(item.place_id) if item.place_id else None,
                )
                for item in lodging_rows
            ]
        )
        combined.sort(key=lambda item: (item.created_at, str(item.id)), reverse=True)
        total = len(combined)
        return total, combined[offset : offset + limit]

    @staticmethod
    async def attach_offer_to_day(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        offer_kind: OfferKind,
        offer_id: uuid.UUID,
        trip_day_id: uuid.UUID,
    ) -> OfferResponse:
        await TripRepository.get_trip(db, user_id, trip_id)
        await OfferRepository._assert_trip_day_matches_trip(
            db, trip_id=trip_id, trip_day_id=trip_day_id
        )

        if offer_kind == OfferKind.TRANSPORT:
            row = await db.execute(
                select(TransportOffer)
                .join(Trip, TransportOffer.trip_id == Trip.id)
                .where(TransportOffer.id == offer_id)
                .where(TransportOffer.trip_id == trip_id)
                .where(Trip.user_id == user_id)
            )
            offer = row.scalar_one_or_none()
            if not offer:
                raise NotFoundError("Offer not found")
            offer.trip_day_id = trip_day_id
            await db.flush()
            await db.refresh(offer)
            return OfferRepository._offer_response_from_transport(offer)

        row = await db.execute(
            select(LodgingOffer)
            .join(Trip, LodgingOffer.trip_id == Trip.id)
            .where(LodgingOffer.id == offer_id)
            .where(LodgingOffer.trip_id == trip_id)
            .where(Trip.user_id == user_id)
        )
        offer = row.scalar_one_or_none()
        if not offer:
            raise NotFoundError("Offer not found")
        offer.trip_day_id = trip_day_id
        await db.flush()
        await db.refresh(offer)
        return OfferRepository._offer_response_from_lodging(offer)

    @staticmethod
    async def get_offer_for_user(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        offer_kind: OfferKind,
        offer_id: uuid.UUID,
    ) -> TransportOffer | LodgingOffer:
        if offer_kind == OfferKind.TRANSPORT:
            row = await db.execute(
                select(TransportOffer)
                .join(Trip, TransportOffer.trip_id == Trip.id)
                .where(TransportOffer.id == offer_id)
                .where(Trip.user_id == user_id)
            )
            offer = row.scalar_one_or_none()
        else:
            row = await db.execute(
                select(LodgingOffer)
                .join(Trip, LodgingOffer.trip_id == Trip.id)
                .where(LodgingOffer.id == offer_id)
                .where(Trip.user_id == user_id)
            )
            offer = row.scalar_one_or_none()
        if not offer:
            raise NotFoundError("Offer not found")
        return offer

    @staticmethod
    async def get_trip_offers_for_refresh(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        offer_kind: OfferKind | None,
        current_only: bool,
    ) -> list[tuple[OfferKind, TransportOffer | LodgingOffer]]:
        await TripRepository.get_trip(db, user_id, trip_id)
        items: list[tuple[OfferKind, TransportOffer | LodgingOffer]] = []

        if offer_kind in (None, OfferKind.TRANSPORT):
            query = select(TransportOffer).where(TransportOffer.trip_id == trip_id)
            if current_only:
                query = query.where(TransportOffer.is_current.is_(True))
            rows = (
                (await db.execute(query.order_by(TransportOffer.created_at.desc()))).scalars().all()
            )
            items.extend((OfferKind.TRANSPORT, row) for row in rows)

        if offer_kind in (None, OfferKind.LODGING):
            query = select(LodgingOffer).where(LodgingOffer.trip_id == trip_id)
            if current_only:
                query = query.where(LodgingOffer.is_current.is_(True))
            rows = (
                (await db.execute(query.order_by(LodgingOffer.created_at.desc()))).scalars().all()
            )
            items.extend((OfferKind.LODGING, row) for row in rows)

        return items

    @staticmethod
    async def mark_transport_offer_superseded(
        db: AsyncSession,
        *,
        previous_offer_id: uuid.UUID,
        new_offer_id: uuid.UUID,
    ) -> None:
        row = await db.execute(select(TransportOffer).where(TransportOffer.id == previous_offer_id))
        previous = row.scalar_one_or_none()
        if not previous:
            return
        previous.is_current = False
        previous.superseded_by_offer_id = new_offer_id
        await db.flush()

    @staticmethod
    async def mark_lodging_offer_superseded(
        db: AsyncSession,
        *,
        previous_offer_id: uuid.UUID,
        new_offer_id: uuid.UUID,
    ) -> None:
        row = await db.execute(select(LodgingOffer).where(LodgingOffer.id == previous_offer_id))
        previous = row.scalar_one_or_none()
        if not previous:
            return
        previous.is_current = False
        previous.superseded_by_offer_id = new_offer_id
        await db.flush()

    @staticmethod
    def to_response(offer: TransportOffer | LodgingOffer, *, kind: OfferKind) -> OfferResponse:
        if kind == OfferKind.TRANSPORT:
            return OfferRepository._offer_response_from_transport(offer)
        return OfferRepository._offer_response_from_lodging(offer)


class ExportRepository:
    @staticmethod
    async def create_export(
        db: AsyncSession,
        *,
        export_id: uuid.UUID,
        job_id: uuid.UUID,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        format: str,
        trip_version: int,
        expires_at: datetime | None,
    ) -> TripExport:
        item = TripExport(
            id=export_id,
            job_id=job_id,
            user_id=user_id,
            trip_id=trip_id,
            format=format,
            trip_version=trip_version,
            file_path=None,
            content_type=None,
            size_bytes=None,
            sha256=None,
            error_json=None,
            finished_at=None,
            expires_at=expires_at,
            deleted_at=None,
        )
        db.add(item)
        await db.flush()
        await db.refresh(item)
        return item

    @staticmethod
    async def get_export_by_id(db: AsyncSession, *, export_id: uuid.UUID) -> TripExport | None:
        row = await db.execute(select(TripExport).where(TripExport.id == export_id))
        return row.scalar_one_or_none()

    @staticmethod
    async def get_export_for_user(
        db: AsyncSession,
        *,
        export_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> tuple[TripExport, Job]:
        row = await db.execute(
            select(TripExport, Job)
            .join(Job, TripExport.job_id == Job.id)
            .where(TripExport.id == export_id)
            .where(TripExport.user_id == user_id)
        )
        result = row.first()
        if not result:
            raise NotFoundError("Export not found")
        return result[0], result[1]

    @staticmethod
    async def mark_export_succeeded(
        db: AsyncSession,
        *,
        export_id: uuid.UUID,
        file_path: str,
        content_type: str,
        size_bytes: int,
        sha256: str,
    ) -> TripExport | None:
        row = await db.execute(select(TripExport).where(TripExport.id == export_id))
        item = row.scalar_one_or_none()
        if not item:
            return None
        item.file_path = file_path
        item.content_type = content_type
        item.size_bytes = size_bytes
        item.sha256 = sha256
        item.error_json = None
        item.finished_at = datetime.now(UTC)
        await db.flush()
        await db.refresh(item)
        return item

    @staticmethod
    async def mark_export_failed(
        db: AsyncSession,
        *,
        export_id: uuid.UUID,
        error_payload: dict,
    ) -> TripExport | None:
        row = await db.execute(select(TripExport).where(TripExport.id == export_id))
        item = row.scalar_one_or_none()
        if not item:
            return None
        item.error_json = error_payload
        item.finished_at = datetime.now(UTC)
        await db.flush()
        await db.refresh(item)
        return item


class AuditRepository:
    @staticmethod
    async def create_entry(
        db: AsyncSession,
        *,
        user_id: uuid.UUID | None,
        trip_id: uuid.UUID | None,
        entity_type: str,
        entity_id: uuid.UUID | None,
        action: str,
        before: dict | None,
        after: dict | None,
        correlation_id: str | None = None,
        request_path: str | None = None,
    ) -> AuditLog:
        entry = AuditLog(
            user_id=user_id,
            trip_id=trip_id,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            before_json=before,
            after_json=after,
            correlation_id=correlation_id,
            request_path=request_path,
        )
        db.add(entry)
        await db.flush()
        return entry

    @staticmethod
    async def list_trip_audit(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        entity_type: str | None,
        action: str | None,
        from_dt: datetime | None,
        to_dt: datetime | None,
        limit: int,
        offset: int,
    ) -> tuple[int, list[AuditLog]]:
        await TripRepository.get_trip(db, user_id, trip_id)

        query = select(AuditLog).where(AuditLog.trip_id == trip_id)
        count_query = select(func.count(AuditLog.id)).where(AuditLog.trip_id == trip_id)
        if entity_type:
            query = query.where(AuditLog.entity_type == entity_type)
            count_query = count_query.where(AuditLog.entity_type == entity_type)
        if action:
            query = query.where(AuditLog.action == action)
            count_query = count_query.where(AuditLog.action == action)
        if from_dt:
            query = query.where(AuditLog.created_at >= from_dt)
            count_query = count_query.where(AuditLog.created_at >= from_dt)
        if to_dt:
            query = query.where(AuditLog.created_at <= to_dt)
            count_query = count_query.where(AuditLog.created_at <= to_dt)

        total = int((await db.execute(count_query)).scalar_one())
        rows = await db.execute(
            query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
            .limit(limit)
            .offset(offset)
        )
        return total, list(rows.scalars().all())


class JobRepository:
    @staticmethod
    async def create_job(
        db: AsyncSession,
        user_id: uuid.UUID,
        *,
        job_type: str,
        payload: dict,
        status: JobStatus = JobStatus.PENDING,
        max_attempts: int = 3,
    ) -> Job:
        job = Job(
            user_id=user_id,
            job_type=job_type,
            status=status,
            payload_json=payload,
            max_attempts=max_attempts,
            available_at=datetime.now(UTC),
        )
        db.add(job)
        await db.flush()
        await db.refresh(job)
        return job

    @staticmethod
    async def list_jobs(
        db: AsyncSession,
        user_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
    ) -> tuple[int, list[Job]]:
        total = int(
            (
                await db.execute(select(func.count(Job.id)).where(Job.user_id == user_id))
            ).scalar_one()
        )
        result = await db.execute(
            select(Job)
            .where(Job.user_id == user_id)
            .order_by(Job.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return total, list(result.scalars().all())

    @staticmethod
    async def get_job(db: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID) -> Job:
        result = await db.execute(select(Job).where(Job.id == job_id).where(Job.user_id == user_id))
        job = result.scalar_one_or_none()
        if not job:
            raise NotFoundError("Job not found")
        return job

    @staticmethod
    async def get_job_by_id(db: AsyncSession, job_id: uuid.UUID) -> Job | None:
        result = await db.execute(select(Job).where(Job.id == job_id))
        return result.scalar_one_or_none()

    @staticmethod
    async def claim_next_pending_job(db: AsyncSession) -> Job | None:
        result = await db.execute(
            select(Job)
            .where(Job.status == JobStatus.PENDING)
            .where(Job.available_at <= func.now())
            .order_by(Job.created_at.asc())
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        job = result.scalar_one_or_none()
        if not job:
            return None

        job.status = JobStatus.RUNNING
        job.attempts += 1
        if not job.started_at:
            job.started_at = datetime.now(UTC)
        await db.flush()
        await db.refresh(job)
        return job

    @staticmethod
    async def mark_job_succeeded(
        db: AsyncSession,
        *,
        job: Job,
        result_payload: dict,
    ) -> Job:
        job.status = JobStatus.SUCCEEDED
        job.result_json = result_payload
        job.error_json = None
        job.finished_at = datetime.now(UTC)
        await db.flush()
        await db.refresh(job)
        return job

    @staticmethod
    async def mark_job_retry(
        db: AsyncSession,
        *,
        job: Job,
        error_payload: dict,
        backoff_seconds: int,
    ) -> Job:
        retry_at = datetime.now(UTC) + timedelta(seconds=backoff_seconds)
        job.status = JobStatus.PENDING
        job.error_json = error_payload
        job.available_at = retry_at
        await db.flush()
        await db.refresh(job)
        return job

    @staticmethod
    async def mark_job_failed(
        db: AsyncSession,
        *,
        job: Job,
        error_payload: dict,
        dead_letter: bool,
    ) -> Job:
        now = datetime.now(UTC)
        job.status = JobStatus.FAILED
        job.error_json = error_payload
        job.finished_at = now
        if dead_letter:
            job.dead_lettered_at = now
        await db.flush()
        await db.refresh(job)
        return job

    @staticmethod
    async def queue_depths(db: AsyncSession) -> tuple[int, int]:
        pending = int(
            (await db.execute(select(func.count(Job.id)).where(Job.status == JobStatus.PENDING)))
            .scalar_one()
        )
        running = int(
            (await db.execute(select(func.count(Job.id)).where(Job.status == JobStatus.RUNNING)))
            .scalar_one()
        )
        return pending, running


def job_to_response(job: Job) -> JobResponse:
    return JobResponse(
        id=job.id,
        user_id=job.user_id,
        job_type=job.job_type,
        status=job.status.value,
        payload=job.payload_json,
        result=job.result_json,
        error=job.error_json,
        attempts=job.attempts,
        max_attempts=job.max_attempts,
        available_at=job.available_at,
        dead_lettered_at=job.dead_lettered_at,
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )
