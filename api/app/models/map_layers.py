from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field


class MapLayerRenderer(StrEnum):
    NATIVE = "native"
    DECKGL = "deckgl"
    DDS_BOUNDARY = "dds-boundary"
    DDS_DATASET = "dds-dataset"


class MapLayerSource(StrEnum):
    MANUAL_DRAW = "manual_draw"
    ROUTES = "routes"
    PLACES = "places"
    ANALYTICS = "analytics"


class TripMapLayerCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    source: MapLayerSource
    renderer: MapLayerRenderer
    feature_collection: dict = Field(default_factory=dict)
    style: dict = Field(default_factory=dict)
    metadata: dict = Field(default_factory=dict)
    is_visible: bool = True
    is_locked: bool = False
    order_index: int | None = Field(default=None, ge=0)


class TripMapLayerPatchRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    source: MapLayerSource | None = None
    renderer: MapLayerRenderer | None = None
    feature_collection: dict | None = None
    style: dict | None = None
    metadata: dict | None = None
    is_visible: bool | None = None
    is_locked: bool | None = None
    order_index: int | None = Field(default=None, ge=0)


class TripMapLayerResponse(BaseModel):
    id: UUID
    trip_id: UUID
    name: str
    source: MapLayerSource
    renderer: MapLayerRenderer
    feature_collection: dict
    style: dict
    metadata: dict
    is_visible: bool
    is_locked: bool
    order_index: int
    created_at: datetime
    updated_at: datetime


class TripMapLayerListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[TripMapLayerResponse]
