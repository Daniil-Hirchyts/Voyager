from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class UserProfileResponse(BaseModel):
    id: UUID
    keycloak_sub: str
    preferences: dict = Field(default_factory=dict)
    created_at: datetime


class UserProfilePatchRequest(BaseModel):
    preferences: dict = Field(default_factory=dict)
