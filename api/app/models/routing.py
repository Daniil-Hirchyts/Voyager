from enum import StrEnum

from pydantic import BaseModel, Field


class RouteTravelMode(StrEnum):
    WALK = "WALK"
    DRIVE = "DRIVE"
    BICYCLE = "BICYCLE"
    TRANSIT = "TRANSIT"


class RoutePoint(BaseModel):
    lat: float
    lng: float


class RoutePreviewRequest(BaseModel):
    origin: RoutePoint
    destination: RoutePoint
    waypoints: list[RoutePoint] = Field(default_factory=list)
    travel_mode: RouteTravelMode = RouteTravelMode.WALK
    compute_alternatives: bool = True


class RoutePreviewItem(BaseModel):
    summary: str | None = None
    distance_m: int | None = None
    duration_min: float | None = None
    static_duration_min: float | None = None
    path: list[RoutePoint] = Field(default_factory=list)


class RoutePreviewResponse(BaseModel):
    routes: list[RoutePreviewItem] = Field(default_factory=list)


class RouteLegEstimateRequestItem(BaseModel):
    from_activity_id: str
    to_activity_id: str
    origin: RoutePoint
    destination: RoutePoint


class RouteLegEstimateRequest(BaseModel):
    legs: list[RouteLegEstimateRequestItem] = Field(default_factory=list)
    travel_mode: RouteTravelMode = RouteTravelMode.WALK


class RouteLegEstimateItem(BaseModel):
    from_activity_id: str
    to_activity_id: str
    distance_km: float | None = None
    duration_min: float | None = None


class RouteLegEstimateResponse(BaseModel):
    items: list[RouteLegEstimateItem] = Field(default_factory=list)
