from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.activity_discovery import (
    ActivityDiscoveryBookingLink,
    ActivityDiscoveryHoursDay,
    ActivityDiscoveryPhoto,
    ActivityDiscoveryReview,
)


class PlaceCreateRequest(BaseModel):
    source: str
    external_id: str | None = None
    name: str
    category: str | None = None
    address_text: str | None = None
    lat: float | None = None
    lon: float | None = None
    metadata: dict = Field(default_factory=dict)


class PlacePhotoSummary(BaseModel):
    id: UUID
    source: str
    image_url: str
    thumbnail_url: str | None
    display_url: str | None = None
    display_thumbnail_url: str | None = None
    license_code: str | None
    license_url: str | None
    attribution_text: str | None


class PlaceResponse(BaseModel):
    id: UUID
    source: str
    external_id: str | None
    name: str
    category: str | None
    address_text: str | None
    lat: float | None
    lon: float | None
    metadata: dict
    canonical_place_id: UUID | None
    is_canonical: bool
    dedup_confidence: float | None
    merged_at: datetime | None
    photo_count: int = 0
    primary_photo: PlacePhotoSummary | None = None
    distance_m: float | None = None
    created_at: datetime
    updated_at: datetime


class PlaceListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[PlaceResponse]


class DestinationAutocompleteItem(BaseModel):
    id: str
    label: str
    name: str | None = None
    country: str | None = None
    region: str | None = None
    lat: float | None = None
    lon: float | None = None
    address_text: str | None = None
    category: str | None = None
    timezone: str | None = None
    metadata: dict = Field(default_factory=dict)


class DestinationAutocompleteResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[DestinationAutocompleteItem]


class PlaceMetadataPatchRequest(BaseModel):
    metadata: dict = Field(default_factory=dict)


class GooglePlaceCandidate(BaseModel):
    place_id: str
    label: str
    name: str
    address_text: str | None = None
    category: str | None = None
    country: str | None = None
    region: str | None = None
    lat: float | None = None
    lon: float | None = None
    timezone: str | None = None
    metadata: dict = Field(default_factory=dict)


class GooglePlaceSearchResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[GooglePlaceCandidate]


class GooglePlaceMentionLink(BaseModel):
    label: str
    url: str | None = None


class GooglePlaceDetailResponse(BaseModel):
    place: GooglePlaceCandidate
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
    mentions: list[GooglePlaceMentionLink] = Field(default_factory=list)


class PlaceMergeRequest(BaseModel):
    source_place_ids: list[UUID] = Field(min_length=1)
    dedup_confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class PlaceMergeResponse(BaseModel):
    canonical_place_id: UUID
    merged_places: int
    relinked_aliases: int
    remapped_activities: int


class PlaceDedupRunRequest(BaseModel):
    radius_m: int = Field(default=120, ge=1, le=50_000)
    max_groups: int = Field(default=500, ge=1, le=10_000)


class PlacePhotoResponse(BaseModel):
    id: UUID
    place_id: UUID
    source: str
    source_media_ref: str
    image_url: str
    thumbnail_url: str | None
    display_url: str | None = None
    display_thumbnail_url: str | None = None
    width: int | None
    height: int | None
    license_code: str | None
    license_url: str | None
    author_name: str | None
    author_url: str | None
    attribution_text: str | None
    rank: int
    is_primary: bool
    created_at: datetime
    updated_at: datetime


class PlacePhotoListResponse(BaseModel):
    total: int
    items: list[PlacePhotoResponse]
