from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.activity_discovery import (
    ActivityDiscoveryBookingLink,
    ActivityDiscoveryHoursDay,
    ActivityDiscoveryPhoto,
    ActivityDiscoveryReview,
)
from app.models.places import PlaceResponse
from app.models.trips import ActivityCategory


class PlannerMapMentionLink(BaseModel):
    label: str
    url: str | None = None


class PlannerMapRelatedActivitySummary(BaseModel):
    activity_id: UUID
    trip_day_id: UUID | None
    order_index: int
    title: str
    category: ActivityCategory
    visited_at: datetime | None = None


class PlannerMapPlaceDetailResponse(BaseModel):
    place: PlaceResponse
    summary: str | None = None
    rating: float | None = None
    review_count: int | None = None
    status_text: str | None = None
    price_label: str | None = None
    photos: list[ActivityDiscoveryPhoto] = Field(default_factory=list)
    reviews: list[ActivityDiscoveryReview] = Field(default_factory=list)
    hours: list[ActivityDiscoveryHoursDay] = Field(default_factory=list)
    booking_links: list[ActivityDiscoveryBookingLink] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    mentions: list[PlannerMapMentionLink] = Field(default_factory=list)
    related_activities: list[PlannerMapRelatedActivitySummary] = Field(default_factory=list)
