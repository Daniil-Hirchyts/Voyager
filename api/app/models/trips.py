from datetime import date, datetime, time
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.places import PlacePhotoSummary
from app.models.routing import RouteTravelMode


class TripCreateRequest(BaseModel):
    destination_text: str
    start_date: date
    end_date: date
    budget_amount: Decimal | None = None
    budget_currency: str | None = None
    trip_type: str | None = None
    route_travel_mode: RouteTravelMode = RouteTravelMode.WALK


class TripPatchRequest(BaseModel):
    title: str | None = None
    destination_text: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    budget_amount: Decimal | None = None
    budget_currency: str | None = None
    trip_type: str | None = None
    route_travel_mode: RouteTravelMode | None = None


class TripAccessRole(StrEnum):
    OWNER = "owner"
    EDITOR = "editor"


class TripResponse(BaseModel):
    id: UUID
    user_id: UUID
    title: str
    destination_text: str
    start_date: date
    end_date: date
    budget_amount: Decimal | None
    budget_currency: str | None
    trip_type: str | None
    route_travel_mode: RouteTravelMode
    current_user_role: TripAccessRole
    collaborator_count: int
    version: int
    created_at: datetime
    updated_at: datetime


class TripListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[TripResponse]


class DayResponse(BaseModel):
    id: UUID
    trip_id: UUID
    day_index: int
    date: date
    notes: str | None
    created_at: datetime
    updated_at: datetime


class DayPatchRequest(BaseModel):
    notes: str | None = None


class DayListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[DayResponse]


class PlannerPlaceSummary(BaseModel):
    id: UUID
    name: str
    category: str | None
    address_text: str | None
    lat: float | None
    lon: float | None
    photo_count: int = 0
    primary_photo: PlacePhotoSummary | None = None


class ActivityCategory(StrEnum):
    VISIT = "visit"
    EAT = "eat"
    ACTIVITY = "activity"
    HOTEL = "hotel"
    TRAVEL = "travel"


class ActivityResponse(BaseModel):
    id: UUID
    trip_day_id: UUID | None
    order_index: int
    category: ActivityCategory
    category_details: dict = Field(default_factory=dict)
    title: str
    description: str | None
    start_time: time | None
    duration_min: int | None
    estimated_cost_amount: Decimal | None
    estimated_cost_currency: str | None
    place_id: UUID | None
    event_snapshot_id: UUID | None
    notes: str | None
    is_favorite: bool
    visited_at: datetime | None
    source: str
    created_at: datetime
    updated_at: datetime


class PlannerActivityResponse(BaseModel):
    id: UUID
    trip_day_id: UUID | None
    order_index: int
    category: ActivityCategory
    category_details: dict = Field(default_factory=dict)
    title: str
    description: str | None
    start_time: time | None
    duration_min: int | None
    estimated_cost_amount: Decimal | None
    estimated_cost_currency: str | None
    place_id: UUID | None
    place: PlannerPlaceSummary | None = None
    event_snapshot_id: UUID | None
    notes: str | None
    is_favorite: bool
    visited_at: datetime | None
    source: str
    created_at: datetime
    updated_at: datetime


class ActivityCreateRequest(BaseModel):
    trip_day_id: UUID | None = None
    category: ActivityCategory = ActivityCategory.VISIT
    category_details: dict = Field(default_factory=dict)
    title: str
    description: str | None = None
    start_time: time | None = None
    duration_min: int | None = None
    estimated_cost_amount: Decimal | None = None
    estimated_cost_currency: str | None = None
    place_id: UUID | None = None
    event_snapshot_id: UUID | None = None
    notes: str | None = None
    is_favorite: bool = False
    source: str = "manual"


class ActivityPatchRequest(BaseModel):
    category: ActivityCategory | None = None
    category_details: dict | None = None
    title: str | None = None
    description: str | None = None
    start_time: time | None = None
    duration_min: int | None = None
    estimated_cost_amount: Decimal | None = None
    estimated_cost_currency: str | None = None
    place_id: UUID | None = None
    notes: str | None = None
    is_favorite: bool | None = None
    visited_at: datetime | None = None
    source: str | None = None


class ActivityListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[ActivityResponse]


class ActivityReorderItem(BaseModel):
    activity_id: UUID
    order_index: int


class ActivityReorderRequest(BaseModel):
    items: list[ActivityReorderItem]


class ActivityMoveRequest(BaseModel):
    target_day_id: UUID | None
    target_index: int


class PlannerDayResponse(DayResponse):
    activities: list[PlannerActivityResponse] = Field(default_factory=list)


class TripPlannerResponse(BaseModel):
    trip: TripResponse
    inbox_activities: list[PlannerActivityResponse] = Field(default_factory=list)
    days: list[PlannerDayResponse]


class GenerationMode(StrEnum):
    REPLACE = "replace"
    MERGE = "merge"
    APPEND = "append"


class TripGenerateRequest(BaseModel):
    mode: GenerationMode
    day_ids: list[UUID] | None = None
    constraints: dict = Field(default_factory=dict)
    seed: int | None = None


class TripRegenerateRequest(BaseModel):
    mode: GenerationMode = GenerationMode.REPLACE
    day_ids: list[UUID] | None = None
    constraints: dict = Field(default_factory=dict)
    seed: int | None = None


class TripResetItineraryRequest(BaseModel):
    day_ids: list[UUID] = Field(min_length=1)


class TripCollaboratorResponse(BaseModel):
    id: UUID
    trip_id: UUID
    user_id: UUID
    role: TripAccessRole
    email: str | None
    display_name: str
    invited_by_user_id: UUID | None
    created_at: datetime
    updated_at: datetime


class TripInvitationCreateRequest(BaseModel):
    role: TripAccessRole = TripAccessRole.EDITOR


class TripInvitationResponse(BaseModel):
    id: UUID
    trip_id: UUID
    created_by_user_id: UUID
    role: TripAccessRole
    invite_path: str
    accepted_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TripInvitationCreateResponse(BaseModel):
    invitation: TripInvitationResponse


class TripSharingResponse(BaseModel):
    trip_id: UUID
    current_user_role: TripAccessRole
    collaborators: list[TripCollaboratorResponse]
    pending_invitations: list[TripInvitationResponse]


class TripInvitationPreviewResponse(BaseModel):
    invitation_id: UUID
    trip_id: UUID
    trip_title: str
    destination_text: str
    inviter_display_name: str
    inviter_email: str | None
    role: TripAccessRole
    created_at: datetime
