from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class EventSearchRequest(BaseModel):
    trip_id: UUID
    trip_day_id: UUID | None = None
    day_ids: list[UUID] | None = None
    location_text: str | None = None
    start_date: date
    end_date: date
    segment: str | None = None
    keyword: str | None = None
    size: int = Field(default=20, ge=1, le=100)
    providers: list[str] | None = None
    constraints: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_date_range(self) -> "EventSearchRequest":
        if self.end_date < self.start_date:
            raise ValueError("end_date must be greater than or equal to start_date")
        return self


class EventAttachDayRequest(BaseModel):
    trip_day_id: UUID


class EventResponse(BaseModel):
    id: UUID
    trip_id: UUID
    trip_day_id: UUID | None
    provider: str
    provider_event_ref: str
    title: str
    summary: str | None
    start_at: datetime | None
    end_at: datetime | None
    timezone: str | None
    venue_name: str | None
    venue_address: str | None
    place_id: UUID | None
    segment: str | None
    genre: str | None
    min_price: Decimal | None
    max_price: Decimal | None
    currency: str | None
    image_url: str | None
    deep_link: str | None
    sales_status: str | None
    expires_at: datetime | None
    created_at: datetime
    updated_at: datetime


class EventListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[EventResponse]
