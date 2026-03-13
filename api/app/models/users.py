from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class UserProfileResponse(BaseModel):
    id: UUID
    keycloak_sub: str
    email: str | None
    first_name: str | None = None
    last_name: str | None = None
    display_name: str
    avatar_url: str | None = None
    avatar_thumbnail_url: str | None = None
    preferences: dict = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class UserProfilePatchRequest(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    preferences: dict | None = None
