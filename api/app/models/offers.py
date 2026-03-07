from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.models.places import PlacePhotoSummary


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


class OfferGeoPoint(BaseModel):
    latitude: float
    longitude: float


class TransportSegmentDetail(BaseModel):
    itinerary_index: int = 0
    sequence: int = 0
    airline_code: str | None = None
    airline_name: str | None = None
    operating_airline_code: str | None = None
    operating_airline_name: str | None = None
    flight_number: str | None = None
    departure_iata: str | None = None
    departure_at: datetime | None = None
    departure_terminal: str | None = None
    arrival_iata: str | None = None
    arrival_at: datetime | None = None
    arrival_terminal: str | None = None
    duration_min: int | None = None
    cabin: str | None = None
    fare_basis: str | None = None
    branded_fare: str | None = None
    baggage_summary: str | None = None


class TransportLayoverDetail(BaseModel):
    itinerary_index: int = 0
    airport_code: str | None = None
    duration_min: int | None = None


class TransportOfferDetails(BaseModel):
    segments: list[TransportSegmentDetail] = Field(default_factory=list)
    layovers: list[TransportLayoverDetail] = Field(default_factory=list)
    stops_count: int | None = None
    total_duration_min: int | None = None
    cabin: str | None = None
    baggage_summary: str | None = None
    validating_airline_codes: list[str] = Field(default_factory=list)
    bookable_seats: int | None = None
    additional_baggage_price: Decimal | None = None
    additional_baggage_currency: str | None = None
    emissions_kg: Decimal | None = None
    emissions_description: str | None = None
    origin_geo: OfferGeoPoint | None = None
    destination_geo: OfferGeoPoint | None = None


class LodgingOfferDetails(BaseModel):
    hotel_id: str | None = None
    hotel_name: str | None = None
    chain_code: str | None = None
    brand: str | None = None
    star_rating: int | None = None
    sentiment_rating: int | None = None
    amenities: list[str] = Field(default_factory=list)
    address_text: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    distance_km: float | None = None
    room_description: str | None = None
    payment_type: str | None = None
    cancellation_summary: str | None = None
    nightly_rate_amount: Decimal | None = None
    taxes_amount: Decimal | None = None
    place_id: UUID | None = None
    photo_count: int = 0
    primary_photo: PlacePhotoSummary | None = None


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
    raw_payload_json: dict | None = None

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
    transport_details: TransportOfferDetails | None = None
    lodging_details: LodgingOfferDetails | None = None


class OfferListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[OfferResponse]
