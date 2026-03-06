import uuid
from datetime import UTC, datetime, timedelta
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
    UserProfile,
)
from app.errors import ConflictError, NotFoundError, ValidationApiError
from app.models.events import EventResponse
from app.models.jobs import JobResponse
from app.models.offers import OfferKind, OfferResponse
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
            .join(TripDay, Activity.trip_day_id == TripDay.id)
            .where(TripDay.trip_id == source.id)
            .order_by(TripDay.day_index, Activity.order_index)
        )
        for activity in source_activities_result.scalars().all():
            db.add(
                Activity(
                    trip_day_id=old_to_new_day_id[activity.trip_day_id],
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


class ActivityRepository:
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
    async def create_activity(
        db: AsyncSession,
        user_id: uuid.UUID,
        day_id: uuid.UUID,
        payload: ActivityCreateRequest,
    ) -> Activity:
        day = await DayRepository.get_day_for_user(db, user_id, day_id)

        count_result = await db.execute(
            select(func.count(Activity.id)).where(Activity.trip_day_id == day.id)
        )
        order_index = int(count_result.scalar_one())

        activity = Activity(
            trip_day_id=day.id,
            order_index=order_index,
            title=payload.title,
            description=payload.description,
            start_time=payload.start_time,
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

        await TripRepository.bump_version(db, day.trip_id)
        await db.flush()
        await db.refresh(activity)
        return activity

    @staticmethod
    async def _get_activity_for_user(
        db: AsyncSession, user_id: uuid.UUID, activity_id: uuid.UUID
    ) -> tuple[Activity, TripDay, Trip]:
        result = await db.execute(
            select(Activity, TripDay, Trip)
            .join(TripDay, Activity.trip_day_id == TripDay.id)
            .join(Trip, TripDay.trip_id == Trip.id)
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
        activity, day, _trip = await ActivityRepository._get_activity_for_user(
            db, user_id, activity_id
        )
        update_data = payload.model_dump(exclude_unset=True)
        if "tags" in update_data:
            activity.tags_json = update_data.pop("tags")
        for key, value in update_data.items():
            setattr(activity, key, value)

        await TripRepository.bump_version(db, day.trip_id)
        await db.flush()
        await db.refresh(activity)
        return activity

    @staticmethod
    async def delete_activity(db: AsyncSession, user_id: uuid.UUID, activity_id: uuid.UUID) -> None:
        activity, day, _trip = await ActivityRepository._get_activity_for_user(
            db, user_id, activity_id
        )
        source_day_id = day.id
        await db.delete(activity)
        await db.flush()

        await ActivityRepository._normalize_day_order(db, source_day_id)
        await TripRepository.bump_version(db, day.trip_id)

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
        await ActivityRepository._apply_order_for_day(db, day.id, ordered_ids)

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
        activity, source_day, trip = await ActivityRepository._get_activity_for_user(
            db, user_id, activity_id
        )
        if trip.version != expected_version:
            raise ConflictError(
                code="CONFLICT_VERSION_MISMATCH",
                message="Trip version mismatch",
                details={"latest_version": trip.version},
            )

        target_day = await DayRepository.get_day_for_user(db, user_id, payload.target_day_id)
        if target_day.trip_id != source_day.trip_id:
            raise ValidationApiError("Activity move target day must belong to same trip")

        if source_day.id == target_day.id:
            existing_result = await db.execute(
                select(Activity)
                .where(Activity.trip_day_id == source_day.id)
                .order_by(Activity.order_index)
            )
            ids = [item.id for item in existing_result.scalars().all()]
            ids.remove(activity.id)
            insertion_index = max(0, min(payload.target_index, len(ids)))
            ids.insert(insertion_index, activity.id)
            await ActivityRepository._apply_order_for_day(db, source_day.id, ids)
        else:
            source_result = await db.execute(
                select(Activity)
                .where(Activity.trip_day_id == source_day.id)
                .order_by(Activity.order_index)
            )
            source_ids = [
                item.id for item in source_result.scalars().all() if item.id != activity.id
            ]

            target_result = await db.execute(
                select(Activity)
                .where(Activity.trip_day_id == target_day.id)
                .order_by(Activity.order_index)
            )
            target_ids = [item.id for item in target_result.scalars().all()]
            insertion_index = max(0, min(payload.target_index, len(target_ids)))
            target_ids.insert(insertion_index, activity.id)

            # Move activity first with a temporary high order to avoid unique conflicts.
            activity.trip_day_id = target_day.id
            activity.order_index = 100_000
            await db.flush()

            await ActivityRepository._apply_order_for_day(db, source_day.id, source_ids)
            await ActivityRepository._apply_order_for_day(db, target_day.id, target_ids)

        await TripRepository.bump_version(db, trip.id)
        await db.flush()
        await db.refresh(activity)
        return activity

    @staticmethod
    async def _normalize_day_order(db: AsyncSession, day_id: uuid.UUID) -> None:
        result = await db.execute(
            select(Activity).where(Activity.trip_day_id == day_id).order_by(Activity.order_index)
        )
        items = list(result.scalars().all())
        ids = [item.id for item in items]
        await ActivityRepository._apply_order_for_day(db, day_id, ids)

    @staticmethod
    async def _apply_order_for_day(
        db: AsyncSession,
        day_id: uuid.UUID,
        ordered_ids: list[uuid.UUID],
    ) -> None:
        if not ordered_ids:
            return

        temp_case = case(
            {aid: idx + 100_000 for idx, aid in enumerate(ordered_ids)}, value=Activity.id
        )
        await db.execute(
            update(Activity)
            .where(Activity.trip_day_id == day_id)
            .where(Activity.id.in_(ordered_ids))
            .values(order_index=temp_case)
        )

        final_case = case({aid: idx for idx, aid in enumerate(ordered_ids)}, value=Activity.id)
        await db.execute(
            update(Activity)
            .where(Activity.trip_day_id == day_id)
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
    def _to_response(item: EventSnapshot) -> EventResponse:
        return EventResponse(
            id=item.id,
            trip_id=item.trip_id,
            trip_day_id=item.trip_day_id,
            provider=item.provider,
            provider_event_ref=item.provider_event_ref,
            title=item.title,
            summary=item.summary,
            start_at=item.start_at,
            end_at=item.end_at,
            timezone=item.timezone,
            venue_name=item.venue_name,
            venue_address=item.venue_address,
            place_id=item.place_id,
            segment=item.segment,
            genre=item.genre,
            min_price=item.min_price,
            max_price=item.max_price,
            currency=item.currency,
            image_url=item.image_url,
            deep_link=item.deep_link,
            sales_status=item.sales_status,
            expires_at=item.expires_at,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )

    @staticmethod
    async def create_snapshot(
        db: AsyncSession,
        *,
        trip_id: uuid.UUID,
        trip_day_id: uuid.UUID | None,
        provider: str,
        provider_event_ref: str,
        title: str,
        summary: str | None,
        start_at: datetime | None,
        end_at: datetime | None,
        timezone: str | None,
        venue_name: str | None,
        venue_address: str | None,
        place_id: uuid.UUID | None,
        segment: str | None,
        genre: str | None,
        min_price,
        max_price,
        currency: str | None,
        image_url: str | None,
        deep_link: str | None,
        sales_status: str | None,
        request_fingerprint: str | None,
        raw_payload_json: dict,
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
            existing.title = title
            existing.summary = summary
            existing.start_at = start_at
            existing.end_at = end_at
            existing.timezone = timezone
            existing.venue_name = venue_name
            existing.venue_address = venue_address
            existing.place_id = place_id
            existing.segment = segment
            existing.genre = genre
            existing.min_price = min_price
            existing.max_price = max_price
            existing.currency = currency
            existing.image_url = image_url
            existing.deep_link = deep_link
            existing.sales_status = sales_status
            existing.request_fingerprint = request_fingerprint
            existing.raw_payload_json = raw_payload_json
            existing.expires_at = expires_at
            await db.flush()
            await db.refresh(existing)
            return existing

        item = EventSnapshot(
            trip_id=trip_id,
            trip_day_id=trip_day_id,
            provider=provider,
            provider_event_ref=provider_event_ref,
            title=title,
            summary=summary,
            start_at=start_at,
            end_at=end_at,
            timezone=timezone,
            venue_name=venue_name,
            venue_address=venue_address,
            place_id=place_id,
            segment=segment,
            genre=genre,
            min_price=min_price,
            max_price=max_price,
            currency=currency,
            image_url=image_url,
            deep_link=deep_link,
            sales_status=sales_status,
            request_fingerprint=request_fingerprint,
            raw_payload_json=raw_payload_json,
            expires_at=expires_at,
        )
        db.add(item)
        await db.flush()
        await db.refresh(item)
        return item

    @staticmethod
    async def list_trip_events(
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
                    select(func.count(EventSnapshot.id)).where(EventSnapshot.trip_id == trip_id)
                )
            ).scalar_one()
        )
        rows = await db.execute(
            select(EventSnapshot)
            .where(EventSnapshot.trip_id == trip_id)
            .order_by(
                EventSnapshot.start_at.asc().nulls_last(),
                EventSnapshot.created_at.desc(),
                EventSnapshot.id.asc(),
            )
            .limit(limit)
            .offset(offset)
        )
        return count, list(rows.scalars().all())

    @staticmethod
    async def get_event_for_user(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        event_id: uuid.UUID,
    ) -> EventSnapshot:
        row = await db.execute(
            select(EventSnapshot)
            .join(Trip, EventSnapshot.trip_id == Trip.id)
            .where(EventSnapshot.id == event_id)
            .where(Trip.user_id == user_id)
        )
        item = row.scalar_one_or_none()
        if not item:
            raise NotFoundError("Event not found")
        return item

    @staticmethod
    async def attach_event_to_day(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        event_id: uuid.UUID,
        trip_day_id: uuid.UUID,
    ) -> Activity:
        await TripRepository.get_trip(db, user_id, trip_id)
        day = await DayRepository.get_day_for_user(db, user_id, trip_day_id)
        if day.trip_id != trip_id:
            raise ValidationApiError("trip_day_id must belong to the trip")

        event = await EventRepository.get_event_for_user(db, user_id=user_id, event_id=event_id)
        if event.trip_id != trip_id:
            raise NotFoundError("Event not found")

        count_result = await db.execute(
            select(func.count(Activity.id)).where(Activity.trip_day_id == day.id)
        )
        order_index = int(count_result.scalar_one())
        duration_min = None
        start_time = None
        if event.start_at is not None:
            start_time = event.start_at.time().replace(tzinfo=None)
        if event.start_at is not None and event.end_at is not None:
            delta = int((event.end_at - event.start_at).total_seconds() // 60)
            duration_min = max(delta, 30)

        activity = Activity(
            trip_day_id=day.id,
            order_index=order_index,
            title=event.title,
            description=event.summary,
            start_time=start_time,
            duration_min=duration_min,
            tags_json=[value for value in (event.segment, event.genre, "event") if value],
            estimated_cost_amount=event.min_price or event.max_price,
            estimated_cost_currency=event.currency,
            place_id=event.place_id,
            event_snapshot_id=event.id,
            notes=None,
            is_favorite=False,
            source="manual",
        )
        db.add(activity)
        await TripRepository.bump_version(db, trip_id)
        await db.flush()
        await db.refresh(activity)
        return activity

    @staticmethod
    def to_response(item: EventSnapshot) -> EventResponse:
        return EventRepository._to_response(item)


class PlacePhotoRepository:
    @staticmethod
    def _summary(item: PlacePhoto) -> PlacePhotoSummary:
        return PlacePhotoSummary(
            id=item.id,
            source=item.source,
            image_url=item.image_url,
            thumbnail_url=item.thumbnail_url,
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
        )

    @staticmethod
    def _offer_response_from_lodging(offer: LodgingOffer) -> OfferResponse:
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
            rows = await db.execute(
                query.order_by(LodgingOffer.created_at.desc()).limit(limit).offset(offset)
            )
            return count, [
                OfferRepository._offer_response_from_lodging(item) for item in rows.scalars().all()
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

        transport_rows = (
            await db.execute(transport_query.order_by(TransportOffer.created_at.desc()))
        ).scalars()
        lodging_rows = (
            await db.execute(lodging_query.order_by(LodgingOffer.created_at.desc()))
        ).scalars()

        combined = [OfferRepository._offer_response_from_transport(item) for item in transport_rows]
        combined.extend(
            [OfferRepository._offer_response_from_lodging(item) for item in lodging_rows]
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
