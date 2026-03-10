from datetime import date, datetime, time
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.places import PlacePhotoSummary


class TripCreateRequest(BaseModel):
    title: str
    destination_text: str
    start_date: date
    end_date: date
    budget_amount: Decimal | None = None
    budget_currency: str | None = None
    trip_type: str | None = None
    preferences: list[str] = Field(default_factory=list)


class TripPatchRequest(BaseModel):
    title: str | None = None
    destination_text: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    budget_amount: Decimal | None = None
    budget_currency: str | None = None
    trip_type: str | None = None
    preferences: list[str] | None = None


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
    preferences: list[str]
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


class ActivityResponse(BaseModel):
    id: UUID
    trip_day_id: UUID | None
    order_index: int
    title: str
    description: str | None
    start_time: time | None
    duration_min: int | None
    tags: list[str]
    estimated_cost_amount: Decimal | None
    estimated_cost_currency: str | None
    place_id: UUID | None
    event_snapshot_id: UUID | None
    notes: str | None
    is_favorite: bool
    source: str
    created_at: datetime
    updated_at: datetime


class PlannerActivityResponse(BaseModel):
    id: UUID
    trip_day_id: UUID | None
    order_index: int
    title: str
    description: str | None
    start_time: time | None
    end_time: time | None
    duration_min: int | None
    tags: list[str]
    estimated_cost_amount: Decimal | None
    estimated_cost_currency: str | None
    place_id: UUID | None
    place: PlannerPlaceSummary | None = None
    event_snapshot_id: UUID | None
    notes: str | None
    is_favorite: bool
    source: str
    created_at: datetime
    updated_at: datetime


class ActivityCreateRequest(BaseModel):
    trip_day_id: UUID | None = None
    title: str
    description: str | None = None
    start_time: time | None = None
    duration_min: int | None = None
    tags: list[str] = Field(default_factory=list)
    estimated_cost_amount: Decimal | None = None
    estimated_cost_currency: str | None = None
    place_id: UUID | None = None
    notes: str | None = None
    is_favorite: bool = False
    source: str = "manual"


class ActivityPatchRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    start_time: time | None = None
    duration_min: int | None = None
    tags: list[str] | None = None
    estimated_cost_amount: Decimal | None = None
    estimated_cost_currency: str | None = None
    place_id: UUID | None = None
    notes: str | None = None
    is_favorite: bool | None = None
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
    start_time: time | None = None


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
