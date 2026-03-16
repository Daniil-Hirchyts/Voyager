import uuid
from datetime import date as date_value
from datetime import datetime as datetime_value
from datetime import time as time_value
from decimal import Decimal as DecimalValue
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class JobStatus(StrEnum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"


class ActivityCategory(StrEnum):
    VISIT = "visit"
    EAT = "eat"
    ACTIVITY = "activity"
    HOTEL = "hotel"
    TRAVEL = "travel"


class TripAccessRole(StrEnum):
    OWNER = "owner"
    EDITOR = "editor"


class UserProfile(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "user_profile"

    keycloak_sub: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    first_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    preferences_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    avatar_object_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_thumbnail_object_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    avatar_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)

    trips: Mapped[list["Trip"]] = relationship("Trip", back_populates="user", cascade="all,delete")
    shared_trips: Mapped[list["TripCollaborator"]] = relationship(
        "TripCollaborator",
        back_populates="user",
        cascade="all,delete",
        foreign_keys="TripCollaborator.user_id",
    )
    invited_trip_collaborators: Mapped[list["TripCollaborator"]] = relationship(
        "TripCollaborator",
        back_populates="invited_by",
        foreign_keys="TripCollaborator.invited_by_user_id",
    )
    created_trip_invitations: Mapped[list["TripInvitation"]] = relationship(
        "TripInvitation",
        back_populates="created_by",
        foreign_keys="TripInvitation.created_by_user_id",
    )
    accepted_trip_invitations: Mapped[list["TripInvitation"]] = relationship(
        "TripInvitation",
        back_populates="accepted_by",
        foreign_keys="TripInvitation.accepted_by_user_id",
    )


class Trip(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "trip"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_profile.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    destination_text: Mapped[str] = mapped_column(String(255), nullable=False)
    start_date: Mapped[date_value] = mapped_column(Date, nullable=False)
    end_date: Mapped[date_value] = mapped_column(Date, nullable=False)
    budget_amount: Mapped[DecimalValue | None] = mapped_column(Numeric(12, 2), nullable=True)
    budget_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    trip_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    route_travel_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="WALK")
    cover_preference_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, index=True)
    last_generated_at: Mapped[datetime_value | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    generation_state: Mapped[str] = mapped_column(String(32), nullable=False, default="NEVER")

    user: Mapped[UserProfile] = relationship("UserProfile", back_populates="trips")
    days: Mapped[list["TripDay"]] = relationship(
        "TripDay", back_populates="trip", cascade="all,delete", order_by="TripDay.day_index"
    )
    activities: Mapped[list["Activity"]] = relationship(
        "Activity", back_populates="trip", cascade="all,delete", order_by="Activity.order_index"
    )
    exports: Mapped[list["TripExport"]] = relationship(
        "TripExport",
        back_populates="trip",
        cascade="all,delete",
        order_by="TripExport.created_at.desc()",
    )
    assets: Mapped[list["TripAsset"]] = relationship(
        "TripAsset",
        back_populates="trip",
        cascade="all,delete",
        order_by="TripAsset.created_at.desc()",
    )
    event_snapshots: Mapped[list["EventSnapshot"]] = relationship(
        "EventSnapshot",
        back_populates="trip",
        cascade="all,delete",
        order_by="EventSnapshot.created_at.desc()",
    )
    proposals: Mapped[list["ItineraryProposal"]] = relationship(
        "ItineraryProposal",
        back_populates="trip",
        cascade="all,delete",
        order_by="ItineraryProposal.created_at.desc()",
    )
    map_layers: Mapped[list["TripMapLayer"]] = relationship(
        "TripMapLayer",
        back_populates="trip",
        cascade="all,delete",
        order_by="TripMapLayer.order_index",
    )
    collaborators: Mapped[list["TripCollaborator"]] = relationship(
        "TripCollaborator",
        back_populates="trip",
        cascade="all,delete",
        order_by="TripCollaborator.created_at.asc()",
    )
    invitations: Mapped[list["TripInvitation"]] = relationship(
        "TripInvitation",
        back_populates="trip",
        cascade="all,delete",
        order_by="TripInvitation.created_at.desc()",
    )

    __table_args__ = (CheckConstraint("end_date >= start_date", name="trip_valid_date_range"),)


class TripCollaborator(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "trip_collaborator"

    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_profile.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[TripAccessRole] = mapped_column(
        Enum(TripAccessRole, name="trip_access_role_enum", native_enum=False),
        nullable=False,
        default=TripAccessRole.EDITOR,
    )
    invited_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_profile.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    trip: Mapped["Trip"] = relationship("Trip", back_populates="collaborators")
    user: Mapped["UserProfile"] = relationship(
        "UserProfile",
        back_populates="shared_trips",
        foreign_keys=[user_id],
    )
    invited_by: Mapped["UserProfile | None"] = relationship(
        "UserProfile",
        back_populates="invited_trip_collaborators",
        foreign_keys=[invited_by_user_id],
    )

    __table_args__ = (
        UniqueConstraint("trip_id", "user_id", name="uq_trip_collaborator_trip_user"),
        Index("ix_trip_collaborator_trip_created", "trip_id", "created_at"),
    )


class TripInvitation(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "trip_invitation"

    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_profile.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    accepted_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_profile.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    role: Mapped[TripAccessRole] = mapped_column(
        Enum(TripAccessRole, name="trip_access_role_enum", native_enum=False),
        nullable=False,
        default=TripAccessRole.EDITOR,
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    accepted_at: Mapped[datetime_value | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime_value | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    trip: Mapped["Trip"] = relationship("Trip", back_populates="invitations")
    created_by: Mapped["UserProfile"] = relationship(
        "UserProfile",
        back_populates="created_trip_invitations",
        foreign_keys=[created_by_user_id],
    )
    accepted_by: Mapped["UserProfile | None"] = relationship(
        "UserProfile",
        back_populates="accepted_trip_invitations",
        foreign_keys=[accepted_by_user_id],
    )

    __table_args__ = (
        Index("ix_trip_invitation_trip_created", "trip_id", "created_at"),
        Index("ix_trip_invitation_trip_pending", "trip_id", "revoked_at", "accepted_at"),
    )


class TripDay(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "trip_day"

    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    day_index: Mapped[int] = mapped_column(Integer, nullable=False)
    date: Mapped[date_value] = mapped_column(Date, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    trip: Mapped[Trip] = relationship("Trip", back_populates="days")
    activities: Mapped[list["Activity"]] = relationship(
        "Activity", back_populates="trip_day", cascade="all,delete", order_by="Activity.order_index"
    )
    event_snapshots: Mapped[list["EventSnapshot"]] = relationship(
        "EventSnapshot",
        back_populates="trip_day",
    )
    proposal_activities: Mapped[list["ItineraryProposalActivity"]] = relationship(
        "ItineraryProposalActivity",
        back_populates="trip_day",
    )

    __table_args__ = (
        UniqueConstraint("trip_id", "day_index", name="uq_trip_day_trip_id_day_index"),
    )


class TripMapLayer(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "trip_map_layer"

    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    renderer: Mapped[str] = mapped_column(String(32), nullable=False)
    feature_collection_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    style_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    metadata_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    is_visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    trip: Mapped["Trip"] = relationship("Trip", back_populates="map_layers")

    __table_args__ = (Index("ix_trip_map_layer_trip_order", "trip_id", "order_index"),)


class Place(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "place"

    source: Mapped[str] = mapped_column(String(64), nullable=False)
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    category: Mapped[str | None] = mapped_column(String(128), nullable=True)
    address_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    lat: Mapped[float | None] = mapped_column(nullable=True)
    lon: Mapped[float | None] = mapped_column(nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    canonical_place_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("place.id", ondelete="SET NULL"), nullable=True, index=True
    )
    dedup_confidence: Mapped[float | None] = mapped_column(nullable=True)
    merged_at: Mapped[datetime_value | None] = mapped_column(DateTime(timezone=True), nullable=True)

    activities: Mapped[list["Activity"]] = relationship("Activity", back_populates="place")
    event_snapshots: Mapped[list["EventSnapshot"]] = relationship(
        "EventSnapshot",
        back_populates="place",
    )
    photos: Mapped[list["PlacePhoto"]] = relationship(
        "PlacePhoto",
        back_populates="place",
        cascade="all,delete",
        order_by="PlacePhoto.rank.asc()",
    )
    proposal_activities: Mapped[list["ItineraryProposalActivity"]] = relationship(
        "ItineraryProposalActivity",
        back_populates="place",
    )


Index(
    "uq_place_source_external_id_not_null",
    Place.source,
    Place.external_id,
    unique=True,
    postgresql_where=Place.external_id.isnot(None),
)


class Activity(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "activity"

    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trip.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    trip_day_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trip_day.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    category: Mapped[ActivityCategory] = mapped_column(
        Enum(ActivityCategory, name="activity_category_enum", native_enum=False),
        nullable=False,
        default=ActivityCategory.VISIT,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_time: Mapped[time_value | None] = mapped_column(nullable=True)
    duration_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    category_details_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    estimated_cost_amount: Mapped[DecimalValue | None] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    estimated_cost_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    place_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("place.id", ondelete="SET NULL"), nullable=True, index=True
    )
    event_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("event_snapshot.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    visited_at: Mapped[datetime_value | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    generation_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True, index=True
    )

    trip: Mapped[Trip] = relationship("Trip", back_populates="activities")
    trip_day: Mapped[TripDay | None] = relationship("TripDay", back_populates="activities")
    place: Mapped[Place | None] = relationship("Place", back_populates="activities")
    event_snapshot: Mapped["EventSnapshot | None"] = relationship(
        "EventSnapshot",
        back_populates="activities",
    )
    assets: Mapped[list["TripAsset"]] = relationship(
        "TripAsset",
        back_populates="activity",
        order_by="TripAsset.created_at.desc()",
    )

    __table_args__ = (
        Index(
            "ix_activity_trip_day_order_assigned",
            "trip_day_id",
            "order_index",
            unique=True,
            postgresql_where=text("trip_day_id IS NOT NULL"),
        ),
        Index(
            "ix_activity_trip_order_inbox",
            "trip_id",
            "order_index",
            unique=True,
            postgresql_where=text("trip_day_id IS NULL"),
        ),
    )


class Job(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "job"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_profile.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    job_type: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[JobStatus] = mapped_column(
        Enum(JobStatus, name="job_status_enum", native_enum=False),
        nullable=False,
        default=JobStatus.PENDING,
    )
    payload_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    result_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    available_at: Mapped[datetime_value] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    dead_lettered_at: Mapped[datetime_value | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime_value] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    started_at: Mapped[datetime_value | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime_value | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (Index("ix_job_status_available_at", "status", "available_at"),)


class AssistantThread(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "assistant_thread"

    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_profile.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    trip: Mapped["Trip"] = relationship("Trip")
    user: Mapped["UserProfile"] = relationship("UserProfile")
    messages: Mapped[list["AssistantMessage"]] = relationship(
        "AssistantMessage",
        back_populates="thread",
        cascade="all,delete",
        order_by="AssistantMessage.created_at.asc()",
    )

    __table_args__ = (
        UniqueConstraint("trip_id", "user_id", name="uq_assistant_thread_trip_user"),
        Index("ix_assistant_thread_trip_created", "trip_id", "created_at"),
    )


class AssistantMessage(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "assistant_message"

    thread_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("assistant_thread.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="complete")
    parts_json: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    metadata_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    source_job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("job.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    thread: Mapped["AssistantThread"] = relationship("AssistantThread", back_populates="messages")
    source_job: Mapped["Job | None"] = relationship("Job")

    __table_args__ = (
        Index("ix_assistant_message_thread_created", "thread_id", "created_at"),
        UniqueConstraint("source_job_id", name="uq_assistant_message_source_job_id"),
    )


class EventSnapshot(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "event_snapshot"

    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    trip_day_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trip_day.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    provider: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    entity_type: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    provider_event_ref: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_at: Mapped[datetime_value | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_at: Mapped[datetime_value | None] = mapped_column(DateTime(timezone=True), nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    venue_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    venue_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    rating: Mapped[DecimalValue | None] = mapped_column(Numeric(4, 2), nullable=True)
    review_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    price_label: Mapped[str | None] = mapped_column(String(128), nullable=True)
    place_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("place.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    segment: Mapped[str | None] = mapped_column(String(128), nullable=True)
    genre: Mapped[str | None] = mapped_column(String(128), nullable=True)
    tags_json: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    status_text: Mapped[str | None] = mapped_column(String(255), nullable=True)
    min_price: Mapped[DecimalValue | None] = mapped_column(Numeric(12, 2), nullable=True)
    max_price: Mapped[DecimalValue | None] = mapped_column(Numeric(12, 2), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    deep_link: Mapped[str | None] = mapped_column(Text, nullable=True)
    sales_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    request_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    raw_payload_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    provider_detail_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    expires_at: Mapped[datetime_value | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    trip: Mapped["Trip"] = relationship("Trip", back_populates="event_snapshots")
    trip_day: Mapped["TripDay | None"] = relationship("TripDay", back_populates="event_snapshots")
    place: Mapped["Place | None"] = relationship("Place", back_populates="event_snapshots")
    activities: Mapped[list["Activity"]] = relationship(
        "Activity",
        back_populates="event_snapshot",
    )
    proposal_activities: Mapped[list["ItineraryProposalActivity"]] = relationship(
        "ItineraryProposalActivity",
        back_populates="event_snapshot",
    )

    __table_args__ = (
        Index("ix_event_snapshot_trip_created", "trip_id", "created_at"),
        Index(
            "uq_event_snapshot_provider_ref_trip",
            "provider",
            "provider_event_ref",
            "trip_id",
            unique=True,
        ),
    )


class PlacePhoto(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "place_photo"

    place_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("place.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    source_media_ref: Mapped[str] = mapped_column(Text, nullable=False)
    image_url: Mapped[str] = mapped_column(Text, nullable=False)
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    license_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    license_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    author_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    author_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    attribution_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    rank: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    raw_payload_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    place: Mapped["Place"] = relationship("Place", back_populates="photos")

    __table_args__ = (
        Index("ix_place_photo_place_rank", "place_id", "rank"),
        Index(
            "uq_place_photo_source_ref_place",
            "place_id",
            "source",
            "source_media_ref",
            unique=True,
        ),
    )


class ItineraryProposal(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "itinerary_proposal"

    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trip.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_profile.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("job.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    based_on_trip_version: Mapped[int] = mapped_column(Integer, nullable=False)
    objective: Mapped[str] = mapped_column(String(64), nullable=False)
    scope_day_ids_json: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="READY", index=True)
    summary_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    score_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    trip: Mapped["Trip"] = relationship("Trip", back_populates="proposals")
    user: Mapped["UserProfile"] = relationship("UserProfile")
    items: Mapped[list["ItineraryProposalActivity"]] = relationship(
        "ItineraryProposalActivity",
        back_populates="proposal",
        cascade="all,delete",
        order_by="ItineraryProposalActivity.order_index",
    )

    __table_args__ = (
        Index("ix_itinerary_proposal_trip_created", "trip_id", "created_at"),
        Index("ix_itinerary_proposal_user_created", "user_id", "created_at"),
    )


class ItineraryProposalActivity(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "itinerary_proposal_activity"

    proposal_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("itinerary_proposal.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    trip_day_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trip_day.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_activity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("activity.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    event_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("event_snapshot.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    place_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("place.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_time: Mapped[time_value | None] = mapped_column(nullable=True)
    duration_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    estimated_cost_amount: Mapped[DecimalValue | None] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    estimated_cost_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    tags_json: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    rationale_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    score_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    proposal: Mapped["ItineraryProposal"] = relationship(
        "ItineraryProposal", back_populates="items"
    )
    trip_day: Mapped["TripDay"] = relationship("TripDay", back_populates="proposal_activities")
    source_activity: Mapped["Activity | None"] = relationship("Activity")
    event_snapshot: Mapped["EventSnapshot | None"] = relationship(
        "EventSnapshot",
        back_populates="proposal_activities",
    )
    place: Mapped["Place | None"] = relationship("Place", back_populates="proposal_activities")

    __table_args__ = (
        UniqueConstraint(
            "proposal_id",
            "trip_day_id",
            "order_index",
            name="uq_itinerary_proposal_activity_order",
        ),
        Index("ix_itinerary_proposal_activity_proposal_order", "proposal_id", "order_index"),
    )


class TripAsset(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "trip_asset"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_profile.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trip.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    activity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("activity.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    object_key: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    thumbnail_object_key: Mapped[str | None] = mapped_column(Text, nullable=True, unique=True)
    image_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    image_height: Mapped[int | None] = mapped_column(Integer, nullable=True)

    trip: Mapped["Trip"] = relationship("Trip", back_populates="assets")
    activity: Mapped["Activity | None"] = relationship("Activity", back_populates="assets")
    user: Mapped["UserProfile"] = relationship("UserProfile")

    __table_args__ = (
        CheckConstraint("kind IN ('photo', 'file')", name="trip_asset_kind"),
        Index("ix_trip_asset_trip_activity_created", "trip_id", "activity_id", "created_at"),
        Index("ix_trip_asset_user_created", "user_id", "created_at"),
    )


class TripExport(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "trip_export"

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("job.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_profile.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trip.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    format: Mapped[str] = mapped_column(String(16), nullable=False)
    trip_version: Mapped[int] = mapped_column(Integer, nullable=False)
    file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime_value] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    finished_at: Mapped[datetime_value | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expires_at: Mapped[datetime_value | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    deleted_at: Mapped[datetime_value | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    trip: Mapped["Trip"] = relationship("Trip", back_populates="exports")
    user: Mapped["UserProfile"] = relationship("UserProfile")

    __table_args__ = (
        Index("ix_trip_export_trip_created_desc", "trip_id", "created_at"),
        Index("ix_trip_export_user_created_desc", "user_id", "created_at"),
    )


class AuditLog(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "audit_log"

    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    trip_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    before_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    after_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    correlation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    request_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime_value] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        Index("ix_audit_log_trip_created_desc", "trip_id", "created_at"),
        Index("ix_audit_log_user_created_desc", "user_id", "created_at"),
        Index("ix_audit_log_entity_created_desc", "entity_type", "entity_id", "created_at"),
    )
