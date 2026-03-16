import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import case, func, or_, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import (
    Activity,
    ActivityCategory,
    AssistantMessage,
    AssistantThread,
    AuditLog,
    EventSnapshot,
    ItineraryProposal,
    ItineraryProposalActivity,
    Job,
    JobStatus,
    Place,
    PlacePhoto,
    Trip,
    TripAccessRole,
    TripAsset,
    TripCollaborator,
    TripDay,
    TripExport,
    TripInvitation,
    TripMapLayer,
    UserProfile,
)
from app.errors import ConflictError, NotFoundError, ValidationApiError
from app.models.activity_discovery import ActivityDiscoveryDetail, ActivityDiscoveryItem
from app.models.jobs import JobResponse
from app.models.map_layers import TripMapLayerCreateRequest, TripMapLayerPatchRequest
from app.models.places import PlaceCreateRequest, PlacePhotoResponse, PlacePhotoSummary
from app.models.proposals import ProposalActivityResponse, ProposalResponse
from app.models.trips import (
    ActivityCreateRequest,
    ActivityMoveRequest,
    ActivityPatchRequest,
    ActivityReorderRequest,
    DayPatchRequest,
    TripCoverPreferencePatchRequest,
    TripCreateRequest,
    TripPatchRequest,
)
from app.services.editorial_trip_templates import (
    editorial_route_template_day_count,
    get_editorial_route_template,
    has_editorial_route_template,
)
from app.services.place_photo_assets import build_place_photo_asset_url


@dataclass
class TripDuplicationResult:
    trip: Trip
    activity_id_map: dict[uuid.UUID, uuid.UUID]


@dataclass
class TripAccessSummary:
    trip: Trip
    current_user_role: TripAccessRole
    collaborator_count: int


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


def _normalize_audit_payload(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _normalize_audit_payload(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_normalize_audit_payload(item) for item in value]
    if isinstance(value, tuple):
        return [_normalize_audit_payload(item) for item in value]
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    return value


def _coerce_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _build_trip_title(destination_text: str) -> str:
    destination = destination_text.split(",", 1)[0].strip() or destination_text.strip()
    return f"Trip to {destination or 'your destination'}"[:255]


_UNSET = object()


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


def _normalize_category_details(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _infer_activity_category(
    *,
    place_category: str | None = None,
    title: str | None = None,
    source: str | None = None,
    event_entity_type: str | None = None,
) -> ActivityCategory:
    if event_entity_type == "restaurant":
        return ActivityCategory.EAT
    if event_entity_type == "attraction":
        return ActivityCategory.VISIT

    haystack = " ".join(
        value
        for value in [place_category, title, source]
        if isinstance(value, str) and value.strip()
    ).lower()
    if any(token in haystack for token in ("restaurant", "cafe", "food", "bistro", "bar")):
        return ActivityCategory.EAT
    if any(
        token in haystack
        for token in ("tour", "experience", "activity", "class", "show", "ticket", "event")
    ):
        return ActivityCategory.ACTIVITY
    return ActivityCategory.VISIT


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


def _trip_access_clause(
    *,
    user_id: uuid.UUID,
    trip_id_column,
    owner_user_id_column,
):
    collaborator_exists = (
        select(TripCollaborator.id)
        .where(TripCollaborator.trip_id == trip_id_column)
        .where(TripCollaborator.user_id == user_id)
        .exists()
    )
    return or_(owner_user_id_column == user_id, collaborator_exists)


class UserRepository:
    @staticmethod
    async def get_by_sub(db: AsyncSession, keycloak_sub: str) -> UserProfile | None:
        result = await db.execute(
            select(UserProfile).where(UserProfile.keycloak_sub == keycloak_sub)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def sync_identity(
        db: AsyncSession,
        user: UserProfile,
        *,
        email: str | None,
        first_name: str | None,
        last_name: str | None,
        display_name: str,
    ) -> UserProfile:
        if user.email != email:
            user.email = email
        if user.first_name != first_name:
            user.first_name = first_name
        if user.last_name != last_name:
            user.last_name = last_name
        if user.display_name != display_name:
            user.display_name = display_name
        await db.flush()
        return user

    @staticmethod
    async def patch_profile(
        db: AsyncSession,
        user: UserProfile,
        *,
        first_name: str | None | object = _UNSET,
        last_name: str | None | object = _UNSET,
        display_name: str | object = _UNSET,
        preferences: dict | object = _UNSET,
    ) -> UserProfile:
        if first_name is not _UNSET:
            user.first_name = first_name
        if last_name is not _UNSET:
            user.last_name = last_name
        if display_name is not _UNSET:
            user.display_name = display_name
        if preferences is not _UNSET:
            user.preferences_json = preferences
        await db.flush()
        await db.refresh(user)
        return user

    @staticmethod
    async def update_avatar(
        db: AsyncSession,
        user: UserProfile,
        *,
        object_key: str,
        thumbnail_object_key: str | None,
        content_type: str,
        size_bytes: int,
        sha256: str,
    ) -> UserProfile:
        user.avatar_object_key = object_key
        user.avatar_thumbnail_object_key = thumbnail_object_key
        user.avatar_content_type = content_type
        user.avatar_size_bytes = size_bytes
        user.avatar_sha256 = sha256
        await db.flush()
        await db.refresh(user)
        return user

    @staticmethod
    async def clear_avatar(db: AsyncSession, user: UserProfile) -> UserProfile:
        user.avatar_object_key = None
        user.avatar_thumbnail_object_key = None
        user.avatar_content_type = None
        user.avatar_size_bytes = None
        user.avatar_sha256 = None
        await db.flush()
        await db.refresh(user)
        return user


class TripRepository:
    @staticmethod
    def _cover_preference_json(value: Any) -> dict[str, Any]:
        return dict(value) if isinstance(value, dict) else {}

    @staticmethod
    def _collaborator_count_expr():
        return (
            select(func.count(TripCollaborator.id))
            .where(TripCollaborator.trip_id == Trip.id)
            .scalar_subquery()
        )

    @staticmethod
    def _role_expr(user_id: uuid.UUID):
        return case(
            (Trip.user_id == user_id, TripAccessRole.OWNER.value),
            else_=TripAccessRole.EDITOR.value,
        )

    @staticmethod
    def _summary_from_row(row) -> TripAccessSummary:
        return TripAccessSummary(
            trip=row[0],
            current_user_role=TripAccessRole(row[1]),
            collaborator_count=int(row[2] or 0),
        )

    @staticmethod
    async def _validate_date_range(payload: TripCreateRequest | TripPatchRequest) -> None:
        start = payload.start_date
        end = payload.end_date
        if start and end and end < start:
            raise ValidationApiError("end_date must be greater than or equal to start_date")

    @staticmethod
    async def create_trip(db: AsyncSession, user_id: uuid.UUID, payload: TripCreateRequest) -> Trip:
        await TripRepository._validate_date_range(payload)
        if payload.editorial_route_id and not has_editorial_route_template(
            payload.editorial_route_id
        ):
            raise ValidationApiError(
                "Unknown editorial route",
                {"editorial_route_id": payload.editorial_route_id},
            )
        if payload.editorial_route_id:
            expected_day_count = editorial_route_template_day_count(payload.editorial_route_id)
            actual_day_count = (payload.end_date - payload.start_date).days + 1
            if expected_day_count is not None and actual_day_count != expected_day_count:
                raise ValidationApiError(
                    "Editorial route date range does not match the saved template",
                    {
                        "editorial_route_id": payload.editorial_route_id,
                        "expected_day_count": expected_day_count,
                        "actual_day_count": actual_day_count,
                    },
                )

        trip = Trip(
            user_id=user_id,
            title=_build_trip_title(payload.destination_text),
            destination_text=payload.destination_text,
            start_date=payload.start_date,
            end_date=payload.end_date,
            budget_amount=payload.budget_amount,
            budget_currency=payload.budget_currency,
            trip_type=payload.trip_type,
            route_travel_mode=payload.route_travel_mode,
            cover_preference_json={},
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
        if payload.editorial_route_id:
            await TripRepository._seed_editorial_route_template(
                db,
                trip=trip,
                route_id=payload.editorial_route_id,
            )
        await db.refresh(trip)
        return trip

    @staticmethod
    async def _seed_editorial_route_template(
        db: AsyncSession,
        *,
        trip: Trip,
        route_id: str,
    ) -> None:
        template = get_editorial_route_template(route_id)
        if template is None:
            raise ValidationApiError("Unknown editorial route", {"editorial_route_id": route_id})

        day_rows = await db.execute(
            select(TripDay).where(TripDay.trip_id == trip.id).order_by(TripDay.day_index.asc())
        )
        days = list(day_rows.scalars().all())
        if len(days) != len(template):
            raise ValidationApiError(
                "Editorial route date range does not match the saved template",
                {
                    "editorial_route_id": route_id,
                    "expected_day_count": len(template),
                    "actual_day_count": len(days),
                },
            )

        for day, day_template in zip(days, template, strict=True):
            for order_index, item in enumerate(day_template):
                place_metadata = {
                    key: value
                    for key, value in item.place.metadata.items()
                    if key != "editorial_route_id"
                }
                place = await PlaceRepository.get_or_create_external_place(
                    db,
                    source="google_places",
                    external_id=item.place.google_place_id,
                    name=item.place.name,
                    category=item.place.category,
                    address_text=item.place.address_text,
                    lat=item.place.lat,
                    lon=item.place.lon,
                    metadata={
                        **place_metadata,
                        "country": item.place.country,
                        "region": item.place.region,
                        "google_place_id": item.place.google_place_id,
                        "time_zone_id": item.place.time_zone_id,
                        "editorial_template": True,
                    },
                )
                db.add(
                    Activity(
                        trip_id=trip.id,
                        trip_day_id=day.id,
                        order_index=order_index,
                        category=item.category,
                        category_details_json={},
                        title=item.title,
                        description=item.description,
                        start_time=item.start_time,
                        duration_min=item.duration_min,
                        estimated_cost_amount=None,
                        estimated_cost_currency=None,
                        place_id=place.id,
                        event_snapshot_id=None,
                        notes=None,
                        is_favorite=False,
                        visited_at=None,
                        source="generated",
                    )
                )

        await db.flush()

    @staticmethod
    async def list_trips(
        db: AsyncSession,
        user_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
    ) -> tuple[int, list[TripAccessSummary]]:
        access_clause = _trip_access_clause(
            user_id=user_id,
            trip_id_column=Trip.id,
            owner_user_id_column=Trip.user_id,
        )
        count_result = await db.execute(select(func.count(Trip.id)).where(access_clause))
        total = int(count_result.scalar_one())

        collaborator_count = TripRepository._collaborator_count_expr()
        role_expr = TripRepository._role_expr(user_id)
        result = await db.execute(
            select(
                Trip,
                role_expr.label("current_user_role"),
                collaborator_count.label("collaborator_count"),
            )
            .where(access_clause)
            .order_by(Trip.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return total, [TripRepository._summary_from_row(row) for row in result.all()]

    @staticmethod
    async def get_trip(db: AsyncSession, user_id: uuid.UUID, trip_id: uuid.UUID) -> Trip:
        summary = await TripRepository.get_trip_access_summary(db, user_id=user_id, trip_id=trip_id)
        return summary.trip

    @staticmethod
    async def get_trip_access_summary(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
    ) -> TripAccessSummary:
        collaborator_count = TripRepository._collaborator_count_expr()
        role_expr = TripRepository._role_expr(user_id)
        access_clause = _trip_access_clause(
            user_id=user_id,
            trip_id_column=Trip.id,
            owner_user_id_column=Trip.user_id,
        )
        result = await db.execute(
            select(
                Trip,
                role_expr.label("current_user_role"),
                collaborator_count.label("collaborator_count"),
            )
            .where(Trip.id == trip_id)
            .where(access_clause)
        )
        row = result.first()
        if not row:
            raise NotFoundError("Trip not found")
        return TripRepository._summary_from_row(row)

    @staticmethod
    async def get_trip_role(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
    ) -> tuple[Trip, TripAccessRole]:
        summary = await TripRepository.get_trip_access_summary(db, user_id=user_id, trip_id=trip_id)
        return summary.trip, summary.current_user_role

    @staticmethod
    async def user_has_access(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
    ) -> bool:
        result = await db.execute(
            select(Trip.id)
            .where(Trip.id == trip_id)
            .where(
                _trip_access_clause(
                    user_id=user_id,
                    trip_id_column=Trip.id,
                    owner_user_id_column=Trip.user_id,
                )
            )
        )
        return result.scalar_one_or_none() is not None

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

        for key, value in update_data.items():
            setattr(trip, key, value)

        trip.version += 1

        if payload.start_date is not None and payload.end_date is not None:
            await TripRepository._sync_days_to_date_range(db, trip)

        await db.flush()
        await db.refresh(trip)
        return trip

    @staticmethod
    async def patch_cover_preference(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        payload: TripCoverPreferencePatchRequest,
    ) -> Trip:
        trip = await TripRepository.get_trip(db, user_id, trip_id)
        current = TripRepository._cover_preference_json(trip.cover_preference_json)
        patch_data = payload.model_dump(mode="json", exclude_unset=True)
        merged = current | patch_data

        if "place_id" in patch_data:
            next_place_id = patch_data.get("place_id")
            if next_place_id is None or next_place_id != current.get("place_id"):
                merged["photo_id"] = None

        if patch_data.get("asset_id") is not None:
            merged["photo_id"] = None

        if patch_data.get("photo_id") is not None:
            merged["asset_id"] = None

        trip.cover_preference_json = {
            key: value for key, value in merged.items() if value is not None
        }
        await db.flush()
        await db.refresh(trip)
        return trip

    @staticmethod
    async def clear_cover_asset_reference(
        db: AsyncSession,
        *,
        trip_id: uuid.UUID,
        asset_id: uuid.UUID,
    ) -> None:
        trip = await db.get(Trip, trip_id)
        if trip is None:
            return

        current = TripRepository._cover_preference_json(trip.cover_preference_json)
        if current.get("asset_id") != str(asset_id):
            return

        current.pop("asset_id", None)
        trip.cover_preference_json = current
        await db.flush()

    @staticmethod
    async def remap_cover_asset_reference(
        db: AsyncSession,
        *,
        trip_id: uuid.UUID,
        source_asset_id: uuid.UUID,
        target_asset_id: uuid.UUID,
    ) -> None:
        trip = await db.get(Trip, trip_id)
        if trip is None:
            return

        current = TripRepository._cover_preference_json(trip.cover_preference_json)
        if current.get("asset_id") != str(source_asset_id):
            return

        current["asset_id"] = str(target_asset_id)
        trip.cover_preference_json = current
        await db.flush()

    @staticmethod
    async def delete_trip(db: AsyncSession, user_id: uuid.UUID, trip_id: uuid.UUID) -> None:
        trip = await TripRepository.get_trip(db, user_id, trip_id)
        await db.delete(trip)
        await db.flush()

    @staticmethod
    async def duplicate_trip_with_maps(
        db: AsyncSession, user_id: uuid.UUID, trip_id: uuid.UUID
    ) -> TripDuplicationResult:
        source = await TripRepository.get_trip(db, user_id, trip_id)

        duplicate = Trip(
            user_id=user_id,
            title=f"{source.title} (Copy)",
            destination_text=source.destination_text,
            start_date=source.start_date,
            end_date=source.end_date,
            budget_amount=source.budget_amount,
            budget_currency=source.budget_currency,
            trip_type=source.trip_type,
            route_travel_mode=source.route_travel_mode,
            cover_preference_json=TripRepository._cover_preference_json(
                source.cover_preference_json
            ),
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
        activity_id_map: dict[uuid.UUID, uuid.UUID] = {}
        for activity in source_activities_result.scalars().all():
            duplicated_activity = Activity(
                trip_id=duplicate.id,
                trip_day_id=(
                    old_to_new_day_id[activity.trip_day_id]
                    if activity.trip_day_id is not None
                    else None
                ),
                order_index=activity.order_index,
                category=activity.category,
                category_details_json=activity.category_details_json or {},
                title=activity.title,
                description=activity.description,
                start_time=activity.start_time,
                duration_min=activity.duration_min,
                estimated_cost_amount=activity.estimated_cost_amount,
                estimated_cost_currency=activity.estimated_cost_currency,
                place_id=activity.place_id,
                event_snapshot_id=old_to_new_event_id.get(activity.event_snapshot_id),
                notes=activity.notes,
                is_favorite=activity.is_favorite,
                visited_at=activity.visited_at,
                source=activity.source,
            )
            db.add(duplicated_activity)
            await db.flush()
            activity_id_map[activity.id] = duplicated_activity.id

        await db.flush()
        await db.refresh(duplicate)
        return TripDuplicationResult(trip=duplicate, activity_id_map=activity_id_map)

    @staticmethod
    async def duplicate_trip(db: AsyncSession, user_id: uuid.UUID, trip_id: uuid.UUID) -> Trip:
        result = await TripRepository.duplicate_trip_with_maps(db, user_id, trip_id)
        return result.trip

    @staticmethod
    async def list_trip_collaborators(
        db: AsyncSession,
        *,
        trip_id: uuid.UUID,
    ) -> list[TripCollaborator]:
        rows = await db.execute(
            select(TripCollaborator)
            .options(selectinload(TripCollaborator.user))
            .where(TripCollaborator.trip_id == trip_id)
            .order_by(TripCollaborator.created_at.asc(), TripCollaborator.id.asc())
        )
        return list(rows.scalars().all())

    @staticmethod
    async def get_trip_collaborator(
        db: AsyncSession,
        *,
        trip_id: uuid.UUID,
        collaborator_user_id: uuid.UUID,
    ) -> TripCollaborator | None:
        row = await db.execute(
            select(TripCollaborator)
            .options(selectinload(TripCollaborator.user))
            .where(TripCollaborator.trip_id == trip_id)
            .where(TripCollaborator.user_id == collaborator_user_id)
        )
        return row.scalar_one_or_none()

    @staticmethod
    async def remove_trip_collaborator(
        db: AsyncSession,
        *,
        trip_id: uuid.UUID,
        collaborator_user_id: uuid.UUID,
    ) -> TripCollaborator:
        collaborator = await TripRepository.get_trip_collaborator(
            db,
            trip_id=trip_id,
            collaborator_user_id=collaborator_user_id,
        )
        if collaborator is None:
            raise NotFoundError("Trip collaborator not found")
        await db.delete(collaborator)
        await db.flush()
        return collaborator

    @staticmethod
    async def list_pending_trip_invitations(
        db: AsyncSession,
        *,
        trip_id: uuid.UUID,
    ) -> list[TripInvitation]:
        rows = await db.execute(
            select(TripInvitation)
            .options(selectinload(TripInvitation.created_by))
            .where(TripInvitation.trip_id == trip_id)
            .where(TripInvitation.accepted_at.is_(None))
            .where(TripInvitation.revoked_at.is_(None))
            .order_by(TripInvitation.created_at.desc(), TripInvitation.id.desc())
        )
        return list(rows.scalars().all())

    @staticmethod
    async def create_trip_invitation(
        db: AsyncSession,
        *,
        invitation_id: uuid.UUID,
        trip_id: uuid.UUID,
        created_by_user_id: uuid.UUID,
        role: TripAccessRole,
        token_hash: str,
    ) -> TripInvitation:
        invitation = TripInvitation(
            id=invitation_id,
            trip_id=trip_id,
            created_by_user_id=created_by_user_id,
            role=role,
            token_hash=token_hash,
            accepted_at=None,
            revoked_at=None,
        )
        db.add(invitation)
        await db.flush()
        await db.refresh(invitation)
        return invitation

    @staticmethod
    async def get_trip_invitation_by_id(
        db: AsyncSession,
        *,
        invitation_id: uuid.UUID,
    ) -> TripInvitation | None:
        row = await db.execute(
            select(TripInvitation)
            .options(selectinload(TripInvitation.created_by), selectinload(TripInvitation.trip))
            .where(TripInvitation.id == invitation_id)
        )
        return row.scalar_one_or_none()

    @staticmethod
    async def revoke_trip_invitation(
        db: AsyncSession,
        *,
        invitation_id: uuid.UUID,
    ) -> TripInvitation:
        invitation = await TripRepository.get_trip_invitation_by_id(db, invitation_id=invitation_id)
        if invitation is None:
            raise NotFoundError("Trip invitation not found")
        invitation.revoked_at = datetime.now(UTC)
        await db.flush()
        await db.refresh(invitation)
        return invitation

    @staticmethod
    async def accept_trip_invitation(
        db: AsyncSession,
        *,
        invitation: TripInvitation,
        accepted_by_user_id: uuid.UUID,
    ) -> tuple[TripInvitation, TripCollaborator]:
        if invitation.trip.user_id == accepted_by_user_id:
            raise ConflictError(
                code="TRIP_INVITATION_OWNER_CANNOT_ACCEPT",
                message="Trip owners cannot accept their own invitation",
            )
        if invitation.revoked_at is not None:
            raise ConflictError(
                code="TRIP_INVITATION_REVOKED",
                message="Trip invitation has been revoked",
            )
        if invitation.accepted_at is not None:
            raise ConflictError(
                code="TRIP_INVITATION_ALREADY_USED",
                message="Trip invitation has already been accepted",
            )

        existing_collaborator = await TripRepository.get_trip_collaborator(
            db,
            trip_id=invitation.trip_id,
            collaborator_user_id=accepted_by_user_id,
        )
        if existing_collaborator is not None:
            raise ConflictError(
                code="TRIP_ALREADY_SHARED_WITH_USER",
                message="Trip is already shared with this user",
            )

        collaborator = TripCollaborator(
            trip_id=invitation.trip_id,
            user_id=accepted_by_user_id,
            role=invitation.role,
            invited_by_user_id=invitation.created_by_user_id,
        )
        db.add(collaborator)
        invitation.accepted_by_user_id = accepted_by_user_id
        invitation.accepted_at = datetime.now(UTC)
        try:
            await db.flush()
        except IntegrityError as exc:
            raise ConflictError(
                code="TRIP_ALREADY_SHARED_WITH_USER",
                message="Trip is already shared with this user",
            ) from exc
        await db.refresh(invitation)
        collaborator_row = await db.execute(
            select(TripCollaborator)
            .options(selectinload(TripCollaborator.user))
            .where(TripCollaborator.id == collaborator.id)
        )
        return invitation, collaborator_row.scalar_one()

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
            .where(
                _trip_access_clause(
                    user_id=user_id,
                    trip_id_column=Trip.id,
                    owner_user_id_column=Trip.user_id,
                )
            )
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
        snapshot: EventSnapshot | None = None
        if payload.trip_day_id is not None:
            target_day = await DayRepository.get_day_for_user(db, user_id, payload.trip_day_id)
            if target_day.trip_id != trip.id:
                raise ValidationApiError("trip_day_id must belong to the trip")
        if payload.event_snapshot_id is not None:
            snapshot = await EventRepository.get_snapshot_for_user(
                db,
                user_id=user_id,
                snapshot_id=payload.event_snapshot_id,
            )
            if snapshot.trip_id != trip.id:
                raise NotFoundError("Activity not found")
            if target_day is not None and not EventRepository._is_attachable(snapshot):
                raise ValidationApiError(
                    "Only attractions and restaurants can be attached to itinerary days"
                )

        order_index = await ActivityRepository._next_order_index(
            db,
            trip_id=trip.id,
            trip_day_id=target_day.id if target_day else None,
        )

        activity = Activity(
            trip_id=trip.id,
            trip_day_id=target_day.id if target_day else None,
            order_index=order_index,
            category=payload.category,
            category_details_json=_normalize_category_details(payload.category_details),
            title=payload.title,
            description=payload.description,
            start_time=payload.start_time if target_day else None,
            duration_min=payload.duration_min,
            estimated_cost_amount=payload.estimated_cost_amount,
            estimated_cost_currency=payload.estimated_cost_currency,
            place_id=payload.place_id or (snapshot.place_id if snapshot else None),
            event_snapshot_id=snapshot.id if snapshot else None,
            notes=payload.notes,
            is_favorite=payload.is_favorite,
            visited_at=None,
            source=payload.source,
        )
        db.add(activity)
        if snapshot is not None:
            snapshot.trip_day_id = target_day.id if target_day else None

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
            .where(
                _trip_access_clause(
                    user_id=user_id,
                    trip_id_column=Trip.id,
                    owner_user_id_column=Trip.user_id,
                )
            )
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
        if "category_details" in update_data:
            activity.category_details_json = _normalize_category_details(
                update_data.pop("category_details")
            )
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
                select(Place).where(Place.source == source).where(Place.external_id == external_id)
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
            provider_payload=provider_detail.get("provider_payload") or item.raw_payload_json or {},
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
            await _assert_trip_day_matches_trip(
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
            .where(
                _trip_access_clause(
                    user_id=user_id,
                    trip_id_column=Trip.id,
                    owner_user_id_column=Trip.user_id,
                )
            )
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
            raise ValidationApiError(
                "Only attractions and restaurants can be attached to itinerary days"
            )

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
            category=_infer_activity_category(event_entity_type=snapshot.entity_type),
            category_details_json={},
            title=snapshot.title,
            description=snapshot.summary,
            start_time=start_time,
            duration_min=duration_min,
            estimated_cost_amount=snapshot.min_price or snapshot.max_price,
            estimated_cost_currency=snapshot.currency,
            place_id=snapshot.place_id,
            event_snapshot_id=snapshot.id,
            notes=None,
            is_favorite=False,
            visited_at=None,
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


class TripAssetRepository:
    @staticmethod
    async def _get_trip_asset_for_user(
        db: AsyncSession,
        *,
        asset_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> TripAsset:
        row = await db.execute(
            select(TripAsset)
            .join(Trip, TripAsset.trip_id == Trip.id)
            .where(TripAsset.id == asset_id)
            .where(
                _trip_access_clause(
                    user_id=user_id,
                    trip_id_column=Trip.id,
                    owner_user_id_column=Trip.user_id,
                )
            )
        )
        item = row.scalar_one_or_none()
        if item is None:
            raise NotFoundError("Trip asset not found")
        return item

    @staticmethod
    async def validate_trip_asset_scope(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        activity_id: uuid.UUID | None,
    ) -> None:
        await TripRepository.get_trip(db, user_id, trip_id)
        if activity_id is None:
            return
        activity, trip, _day = await ActivityRepository._get_activity_for_user(
            db, user_id, activity_id
        )
        if trip.id != trip_id or activity.trip_id != trip_id:
            raise ValidationApiError("activity_id must belong to trip_id")

    @staticmethod
    async def create_trip_asset(
        db: AsyncSession,
        *,
        asset_id: uuid.UUID,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        activity_id: uuid.UUID | None,
        kind: str,
        original_filename: str,
        content_type: str,
        size_bytes: int,
        sha256: str,
        object_key: str,
        thumbnail_object_key: str | None,
        image_width: int | None,
        image_height: int | None,
    ) -> TripAsset:
        item = TripAsset(
            id=asset_id,
            user_id=user_id,
            trip_id=trip_id,
            activity_id=activity_id,
            kind=kind,
            original_filename=original_filename,
            content_type=content_type,
            size_bytes=size_bytes,
            sha256=sha256,
            object_key=object_key,
            thumbnail_object_key=thumbnail_object_key,
            image_width=image_width,
            image_height=image_height,
        )
        db.add(item)
        await db.flush()
        await db.refresh(item)
        return item

    @staticmethod
    async def list_trip_assets(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        activity_id: uuid.UUID | None,
    ) -> list[TripAsset]:
        await TripRepository.get_trip(db, user_id, trip_id)
        query = select(TripAsset).where(TripAsset.trip_id == trip_id)
        if activity_id is None:
            query = query.where(TripAsset.activity_id.is_(None))
        else:
            query = query.where(TripAsset.activity_id == activity_id)
        rows = await db.execute(query.order_by(TripAsset.created_at.desc(), TripAsset.id.desc()))
        return list(rows.scalars().all())

    @staticmethod
    async def list_assets_for_trip(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
    ) -> list[TripAsset]:
        await TripRepository.get_trip(db, user_id, trip_id)
        rows = await db.execute(
            select(TripAsset)
            .where(TripAsset.trip_id == trip_id)
            .order_by(TripAsset.created_at.asc(), TripAsset.id.asc())
        )
        return list(rows.scalars().all())

    @staticmethod
    async def get_trip_asset(
        db: AsyncSession,
        *,
        asset_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> TripAsset:
        return await TripAssetRepository._get_trip_asset_for_user(
            db, asset_id=asset_id, user_id=user_id
        )

    @staticmethod
    async def delete_trip_asset(
        db: AsyncSession,
        *,
        asset_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> TripAsset:
        item = await TripAssetRepository._get_trip_asset_for_user(
            db, asset_id=asset_id, user_id=user_id
        )
        await db.delete(item)
        await db.flush()
        return item

    @staticmethod
    async def detach_assets_for_activity(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        activity_id: uuid.UUID,
    ) -> list[TripAsset]:
        activity, _trip, _day = await ActivityRepository._get_activity_for_user(
            db, user_id, activity_id
        )
        rows = await db.execute(
            select(TripAsset)
            .where(TripAsset.trip_id == activity.trip_id)
            .where(TripAsset.activity_id == activity.id)
            .order_by(TripAsset.created_at.asc(), TripAsset.id.asc())
        )
        items = list(rows.scalars().all())
        for item in items:
            item.activity_id = None
        await db.flush()
        return items


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
            category=_infer_activity_category(
                title=item.title,
                source=" ".join(str(value) for value in (item.tags_json or []) if value),
            ),
            start_time=item.start_time,
            duration_min=item.duration_min,
            estimated_cost_amount=item.estimated_cost_amount,
            estimated_cost_currency=item.estimated_cost_currency,
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
            select(ItineraryProposalActivity).where(
                ItineraryProposalActivity.proposal_id == proposal.id
            )
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
                    select(func.count(ItineraryProposal.id)).where(
                        ItineraryProposal.trip_id == trip_id
                    )
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
            .where(
                _trip_access_clause(
                    user_id=user_id,
                    trip_id_column=Trip.id,
                    owner_user_id_column=Trip.user_id,
                )
            )
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
            before_json=_normalize_audit_payload(before),
            after_json=_normalize_audit_payload(after),
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
            (
                await db.execute(select(func.count(Job.id)).where(Job.status == JobStatus.PENDING))
            ).scalar_one()
        )
        running = int(
            (
                await db.execute(select(func.count(Job.id)).where(Job.status == JobStatus.RUNNING))
            ).scalar_one()
        )
        return pending, running


class AssistantRepository:
    @staticmethod
    async def get_or_create_thread(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
    ) -> AssistantThread:
        await TripRepository.get_trip(db, user_id, trip_id)
        result = await db.execute(
            select(AssistantThread)
            .where(AssistantThread.trip_id == trip_id)
            .where(AssistantThread.user_id == user_id)
        )
        thread = result.scalar_one_or_none()
        if thread is not None:
            return thread

        thread = AssistantThread(trip_id=trip_id, user_id=user_id)
        db.add(thread)
        await db.flush()
        await db.refresh(thread)
        return thread

    @staticmethod
    async def get_thread_with_messages(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
    ) -> tuple[AssistantThread, list[AssistantMessage]]:
        thread = await AssistantRepository.get_or_create_thread(
            db,
            user_id=user_id,
            trip_id=trip_id,
        )
        rows = await db.execute(
            select(AssistantMessage)
            .where(AssistantMessage.thread_id == thread.id)
            .order_by(AssistantMessage.created_at.asc(), AssistantMessage.id.asc())
        )
        return thread, list(rows.scalars().all())

    @staticmethod
    async def create_message(
        db: AsyncSession,
        *,
        thread_id: uuid.UUID,
        role: str,
        parts: list[dict] | None = None,
        metadata: dict | None = None,
        status: str = "complete",
        source_job_id: uuid.UUID | None = None,
        message_id: uuid.UUID | None = None,
    ) -> AssistantMessage:
        message = AssistantMessage(
            id=message_id or uuid.uuid4(),
            thread_id=thread_id,
            role=role,
            status=status,
            parts_json=parts or [],
            metadata_json=metadata or {},
            source_job_id=source_job_id,
        )
        db.add(message)
        await db.flush()
        await db.refresh(message)
        return message

    @staticmethod
    async def get_message_for_trip(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        message_id: uuid.UUID,
    ) -> AssistantMessage:
        thread = await AssistantRepository.get_or_create_thread(
            db,
            user_id=user_id,
            trip_id=trip_id,
        )
        result = await db.execute(
            select(AssistantMessage)
            .where(AssistantMessage.thread_id == thread.id)
            .where(AssistantMessage.id == message_id)
        )
        message = result.scalar_one_or_none()
        if message is None:
            raise NotFoundError("Assistant message not found")
        return message

    @staticmethod
    async def update_message(
        db: AsyncSession,
        message: AssistantMessage,
        *,
        status: str | object = _UNSET,
        parts: list[dict] | object = _UNSET,
        metadata: dict | object = _UNSET,
        source_job_id: uuid.UUID | None | object = _UNSET,
    ) -> AssistantMessage:
        if status is not _UNSET:
            message.status = str(status)
        if parts is not _UNSET:
            message.parts_json = list(parts) if isinstance(parts, list) else []
        if metadata is not _UNSET:
            message.metadata_json = metadata if isinstance(metadata, dict) else {}
        if source_job_id is not _UNSET:
            message.source_job_id = source_job_id
        await db.flush()
        await db.refresh(message)
        return message

    @staticmethod
    async def get_message_by_source_job_id(
        db: AsyncSession,
        *,
        job_id: uuid.UUID,
    ) -> AssistantMessage | None:
        result = await db.execute(
            select(AssistantMessage).where(AssistantMessage.source_job_id == job_id)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def upsert_mirrored_job_messages(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        job_id: uuid.UUID,
        request_text: str,
        action: str,
    ) -> tuple[AssistantThread, AssistantMessage | None, AssistantMessage]:
        thread = await AssistantRepository.get_or_create_thread(
            db,
            user_id=user_id,
            trip_id=trip_id,
        )
        existing = await AssistantRepository.get_message_by_source_job_id(db, job_id=job_id)
        if existing is not None:
            return thread, None, existing

        user_message = await AssistantRepository.create_message(
            db,
            thread_id=thread.id,
            role="user",
            parts=[{"type": "text", "text": request_text}],
            metadata={"kind": "mirrored-job-request", "action": action},
            status="complete",
        )
        assistant_message = await AssistantRepository.create_message(
            db,
            thread_id=thread.id,
            role="assistant",
            parts=[
                {
                    "type": "data",
                    "name": "job-progress",
                    "data": {
                        "job_id": str(job_id),
                        "action": action,
                        "request_text": request_text,
                        "job_status": "PENDING",
                        "events": [],
                        "summary": None,
                    },
                }
            ],
            metadata={"kind": "job-progress", "action": action},
            status="running",
            source_job_id=job_id,
        )
        return thread, user_message, assistant_message

    @staticmethod
    async def append_job_progress_event(
        db: AsyncSession,
        *,
        job_id: uuid.UUID,
        event: dict[str, Any],
    ) -> AssistantMessage | None:
        message = await AssistantRepository.get_message_by_source_job_id(db, job_id=job_id)
        if message is None:
            return None

        parts = list(message.parts_json or [])
        part_index = next(
            (
                idx
                for idx, part in enumerate(parts)
                if isinstance(part, dict)
                and part.get("type") == "data"
                and part.get("name") == "job-progress"
            ),
            -1,
        )
        progress_part = parts[part_index] if part_index >= 0 else None
        progress_data = (
            dict(progress_part.get("data") or {})
            if isinstance(progress_part, dict)
            else {
                "job_id": str(job_id),
                "job_status": "PENDING",
                "events": [],
                "summary": None,
            }
        )

        existing_events = [
            item for item in progress_data.get("events", []) if isinstance(item, dict)
        ]
        event_id = str(event.get("event_id") or "")
        if event_id and not any(str(item.get("event_id")) == event_id for item in existing_events):
            existing_events.append(event)
        progress_data["events"] = existing_events

        if event.get("type") == "done":
            progress_data["job_status"] = str(event.get("status") or "FAILED")
            progress_data["summary"] = event.get("summary")
            message.status = (
                "complete"
                if str(event.get("status") or "").upper() == "SUCCEEDED"
                else "incomplete"
            )
        else:
            progress_data["job_status"] = "RUNNING"
            if message.status == "complete":
                message.status = "running"

        progress_payload = {"type": "data", "name": "job-progress", "data": progress_data}
        if part_index >= 0:
            parts[part_index] = progress_payload
        else:
            parts.append(progress_payload)

        message.parts_json = parts
        metadata = dict(message.metadata_json or {})
        metadata["kind"] = "job-progress"
        metadata["last_event_id"] = event_id or metadata.get("last_event_id")
        message.metadata_json = metadata
        await db.flush()
        await db.refresh(message)
        return message


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
