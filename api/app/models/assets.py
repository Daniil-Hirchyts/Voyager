from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel


class TripAssetKind(StrEnum):
    PHOTO = "photo"
    FILE = "file"


class TripAssetResponse(BaseModel):
    id: UUID
    user_id: UUID
    trip_id: UUID
    activity_id: UUID | None
    kind: TripAssetKind
    original_filename: str
    content_type: str
    size_bytes: int
    sha256: str
    image_width: int | None
    image_height: int | None
    preview_url: str | None
    download_url: str
    created_at: datetime
    updated_at: datetime


class TripAssetListResponse(BaseModel):
    total: int
    items: list[TripAssetResponse]
