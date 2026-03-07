from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field


class ActivityEntityType(StrEnum):
    ATTRACTION = "attraction"
    RESTAURANT = "restaurant"
    HOTEL = "hotel"
    CRUISE = "cruise"


class ActivityDiscoveryItem(BaseModel):
    id: str
    snapshot_id: UUID | None = None
    trip_id: UUID | None = None
    trip_day_id: UUID | None = None
    place_id: UUID | None = None
    entity_type: ActivityEntityType
    provider: str
    provider_ref: str
    title: str
    summary: str | None
    rating: float | None = None
    review_count: int | None = None
    price_label: str | None = None
    image_url: str | None = None
    detail_url: str | None = None
    address_text: str | None = None
    lat: float | None = None
    lon: float | None = None
    tags: list[str] = Field(default_factory=list)
    status_text: str | None = None
    is_attachable: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ActivityDiscoveryPhoto(BaseModel):
    image_url: str
    thumbnail_url: str | None = None
    width: int | None = None
    height: int | None = None
    caption: str | None = None


class ActivityDiscoveryReview(BaseModel):
    review_id: str
    title: str | None = None
    text: str | None = None
    rating: float | None = None
    published_at: str | None = None
    reviewer_name: str | None = None
    reviewer_username: str | None = None
    review_url: str | None = None


class ActivityDiscoveryHoursWindow(BaseModel):
    open: str | None = None
    close: str | None = None


class ActivityDiscoveryHoursDay(BaseModel):
    day: str
    times: list[ActivityDiscoveryHoursWindow] = Field(default_factory=list)


class ActivityDiscoveryBookingLink(BaseModel):
    label: str
    url: str


class ActivityDiscoveryDetail(ActivityDiscoveryItem):
    photos: list[ActivityDiscoveryPhoto] = Field(default_factory=list)
    reviews: list[ActivityDiscoveryReview] = Field(default_factory=list)
    hours: list[ActivityDiscoveryHoursDay] = Field(default_factory=list)
    booking_links: list[ActivityDiscoveryBookingLink] = Field(default_factory=list)
    provider_payload: dict = Field(default_factory=dict)


class ActivityDiscoveryListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    page: int
    entity_type: ActivityEntityType
    items: list[ActivityDiscoveryItem]


class ActivityShortlistSaveRequest(BaseModel):
    entity_type: ActivityEntityType
    provider: str = "tripadvisor"
    provider_ref: str
    title: str
    summary: str | None = None
    rating: float | None = None
    review_count: int | None = None
    price_label: str | None = None
    image_url: str | None = None
    detail_url: str | None = None
    address_text: str | None = None
    lat: float | None = None
    lon: float | None = None
    tags: list[str] = Field(default_factory=list)
    status_text: str | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    timezone: str | None = None
    min_price: str | None = None
    max_price: str | None = None
    currency: str | None = None
    raw_payload: dict = Field(default_factory=dict)


class ActivityShortlistListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[ActivityDiscoveryItem]


class ActivityAttachDayRequest(BaseModel):
    trip_day_id: UUID


class ActivityRecommendationRequest(BaseModel):
    day_ids: list[UUID] | None = None
    snapshot_ids: list[UUID] | None = None
    limit: int = Field(default=6, ge=1, le=20)
    use_llm_rationale: bool = True


class ActivityRecommendationItem(BaseModel):
    snapshot_id: UUID
    trip_day_id: UUID
    score: float
    rationale: str
    item: ActivityDiscoveryItem


class ActivityRecommendationResponse(BaseModel):
    total: int
    items: list[ActivityRecommendationItem]
