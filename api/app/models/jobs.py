from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class JobResponse(BaseModel):
    id: UUID
    user_id: UUID
    job_type: str
    status: str
    payload: dict
    result: dict | None
    error: dict | None
    attempts: int
    max_attempts: int
    available_at: datetime
    dead_lettered_at: datetime | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class JobListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[JobResponse]


class JobAcceptedResponse(BaseModel):
    job_id: UUID
    status: str
    poll_url: str
