from datetime import datetime

from pydantic import BaseModel, ConfigDict


class APIModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class PaginationResponse(APIModel):
    total: int
    limit: int
    offset: int


class Timestamped(APIModel):
    created_at: datetime
    updated_at: datetime
