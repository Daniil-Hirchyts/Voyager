from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class AssistantMessageResponse(BaseModel):
    id: UUID
    thread_id: UUID
    role: str
    status: str
    parts: list[dict] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)
    source_job_id: UUID | None = None
    created_at: datetime
    updated_at: datetime


class AssistantThreadResponse(BaseModel):
    id: UUID
    trip_id: UUID
    user_id: UUID
    messages: list[AssistantMessageResponse] = Field(default_factory=list)


class AssistantConfirmationRequest(BaseModel):
    message_id: UUID
    tool_call_id: str
    confirmed: bool


class AssistantMessageStreamRequest(BaseModel):
    client_message_id: UUID | None = None
    text: str | None = None
    confirmation: AssistantConfirmationRequest | None = None


class AssistantMirrorJobRequest(BaseModel):
    job_id: UUID
    request_text: str
    action: str

