from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class OfferKind(StrEnum):
    TRANSPORT = "transport"
    LODGING = "lodging"


class TransportMode(StrEnum):
    FLIGHT = "flight"


class LodgingType(StrEnum):
    HOTEL = "hotel"


class TransportOfferSearchRequest(BaseModel):
    trip_id: UUID
    trip_day_id: UUID | None = None
    origin_text: str
    destination_text: str | None = None
    depart_date: date
    return_date: date | None = None
    adults: int = Field(default=1, ge=1, le=9)
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    transport_modes: list[TransportMode] | None = None
    providers: list[str] | None = None
    constraints: dict = Field(default_factory=dict)


class LodgingOfferSearchRequest(BaseModel):
    trip_id: UUID
    trip_day_id: UUID | None = None
    location_text: str | None = None
    checkin_date: date
    checkout_date: date
    guests: int = Field(default=2, ge=1, le=16)
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    lodging_types: list[LodgingType] | None = None
    providers: list[str] | None = None
    constraints: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_date_range(self) -> "LodgingOfferSearchRequest":
        if self.checkout_date <= self.checkin_date:
            raise ValueError("checkout_date must be greater than checkin_date")
        return self


class OfferAttachDayRequest(BaseModel):
    offer_kind: OfferKind
    trip_day_id: UUID


class OfferRefreshRequest(BaseModel):
    offer_kind: OfferKind
    constraints: dict = Field(default_factory=dict)


class TripOffersRefreshRequest(BaseModel):
    offer_kind: OfferKind | None = None
    current_only: bool = True
    constraints: dict = Field(default_factory=dict)


class OfferResponse(BaseModel):
    id: UUID
    kind: OfferKind
    trip_id: UUID
    trip_day_id: UUID | None
    provider: str
    title: str
    price_amount: Decimal
    currency: str
    deep_link: str | None
    expires_at: datetime
    is_current: bool
    superseded_by_offer_id: UUID | None
    created_at: datetime
    updated_at: datetime

    transport_mode: str | None = None
    origin_text: str | None = None
    destination_text: str | None = None
    depart_at: datetime | None = None
    arrive_at: datetime | None = None

    location_text: str | None = None
    lodging_type: str | None = None
    room_type: str | None = None
    checkin_date: date | None = None
    checkout_date: date | None = None
    nights: int | None = None


class OfferListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[OfferResponse]
