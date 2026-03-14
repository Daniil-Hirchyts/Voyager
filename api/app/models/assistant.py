from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


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


class AssistantCommandRequest(BaseModel):
    name: str
    args: dict = Field(default_factory=dict)


class AssistantMessageStreamRequest(BaseModel):
    client_message_id: UUID | None = None
    text: str | None = None
    confirmation: AssistantConfirmationRequest | None = None
    command: AssistantCommandRequest | None = None

    @model_validator(mode="after")
    def validate_single_action(self) -> "AssistantMessageStreamRequest":
        actions = [
            self.text is not None,
            self.confirmation is not None,
            self.command is not None,
        ]
        if sum(actions) != 1:
            raise ValueError("Provide exactly one of text, confirmation, or command")
        if self.text is not None and len(self.text.strip()) == 0:
            raise ValueError("text must not be empty")
        return self


class AssistantMirrorJobRequest(BaseModel):
    job_id: UUID
    request_text: str
    action: str
