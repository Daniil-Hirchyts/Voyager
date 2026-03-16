from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel


class ExportFormat(StrEnum):
    JSON = "json"
    ICS = "ics"
    PDF = "pdf"


class TripExportCreateRequest(BaseModel):
    format: ExportFormat


class ExportResponse(BaseModel):
    id: UUID
    job_id: UUID
    user_id: UUID
    trip_id: UUID
    format: ExportFormat
    status: str
    trip_version: int
    content_type: str | None
    size_bytes: int | None
    sha256: str | None
    error: dict | None
    created_at: datetime
    finished_at: datetime | None
    expires_at: datetime | None
    deleted_at: datetime | None
    download_url: str | None
