from __future__ import annotations

from typing import Any

from app.models.routing import RoutePreviewItem, RoutePreviewRequest, RouteTravelMode
from app.services.google_maps_common import (
    _ROUTES_BASE_URL,
    _duration_minutes,
    _field_text,
    _request_json,
    _settings,
    google_maps_enabled,
)


def _decode_polyline(encoded: str | None) -> list[dict[str, float]]:
    if not encoded:
        return []
    index = 0
    lat = 0
    lng = 0
    points: list[dict[str, float]] = []

    while index < len(encoded):
        result = 0
        shift = 0
        while True:
            byte = ord(encoded[index]) - 63
            index += 1
            result |= (byte & 0x1F) << shift
            shift += 5
            if byte < 0x20:
                break
        delta = ~(result >> 1) if result & 1 else result >> 1
        lat += delta

        result = 0
        shift = 0
        while True:
            byte = ord(encoded[index]) - 63
            index += 1
            result |= (byte & 0x1F) << shift
            shift += 5
            if byte < 0x20:
                break
        delta = ~(result >> 1) if result & 1 else result >> 1
        lng += delta

        points.append({"lat": lat / 1e5, "lng": lng / 1e5})

    return points


def _route_request_body(
    request: RoutePreviewRequest,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "origin": {
            "location": {
                "latLng": {
                    "latitude": request.origin.lat,
                    "longitude": request.origin.lng,
                }
            }
        },
        "destination": {
            "location": {
                "latLng": {
                    "latitude": request.destination.lat,
                    "longitude": request.destination.lng,
                }
            }
        },
        "travelMode": request.travel_mode.value,
        "computeAlternativeRoutes": request.compute_alternatives,
        "polylineQuality": "HIGH_QUALITY",
        "units": "METRIC",
        "languageCode": _settings().google_maps_language,
    }

    if _settings().google_maps_region:
        body["regionCode"] = _settings().google_maps_region

    if request.waypoints:
        body["intermediates"] = [
            {
                "location": {
                    "latLng": {
                        "latitude": point.lat,
                        "longitude": point.lng,
                    }
                }
            }
            for point in request.waypoints
        ]

    if request.travel_mode == RouteTravelMode.DRIVE:
        body["routingPreference"] = "TRAFFIC_UNAWARE"

    return body


async def compute_routes(request: RoutePreviewRequest) -> list[RoutePreviewItem]:
    if not google_maps_enabled():
        return []
    payload = await _request_json(
        method="POST",
        url=_ROUTES_BASE_URL,
        timeout=_settings().google_routes_timeout_sec,
        field_mask=(
            "routes.description,routes.distanceMeters,routes.duration,"
            "routes.staticDuration,routes.polyline.encodedPolyline"
        ),
        json_body=_route_request_body(request),
    )
    routes = payload.get("routes")
    if not isinstance(routes, list):
        return []
    items: list[RoutePreviewItem] = []
    for index, route in enumerate(routes):
        if not isinstance(route, dict):
            continue
        items.append(
            RoutePreviewItem(
                summary=_field_text(route.get("description")) or f"Route {index + 1}",
                distance_m=int(route["distanceMeters"])
                if route.get("distanceMeters") is not None
                else None,
                duration_min=_duration_minutes(_field_text(route.get("duration"))),
                static_duration_min=_duration_minutes(_field_text(route.get("staticDuration"))),
                path=[
                    {"lat": point["lat"], "lng": point["lng"]}
                    for point in _decode_polyline(
                        _field_text((route.get("polyline") or {}).get("encodedPolyline"))
                    )
                ],
            )
        )
    return items


async def compute_route_leg(
    *,
    origin: tuple[float, float],
    destination: tuple[float, float],
    travel_mode: RouteTravelMode = RouteTravelMode.WALK,
) -> tuple[float | None, float | None]:
    routes = await compute_routes(
        RoutePreviewRequest(
            origin={"lat": origin[0], "lng": origin[1]},
            destination={"lat": destination[0], "lng": destination[1]},
            travel_mode=travel_mode,
            compute_alternatives=False,
        )
    )
    if not routes:
        return None, None
    first = routes[0]
    distance_km = round(first.distance_m / 1000.0, 2) if first.distance_m is not None else None
    return distance_km, first.duration_min
