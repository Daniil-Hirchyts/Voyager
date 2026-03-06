from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class AuditLogEntry(BaseModel):
    id: UUID
    user_id: UUID | None
    trip_id: UUID | None
    entity_type: str
    entity_id: UUID | None
    action: str
    before: dict | None
    after: dict | None
    correlation_id: str | None
    request_path: str | None
    created_at: datetime


class AuditLogListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[AuditLogEntry]

