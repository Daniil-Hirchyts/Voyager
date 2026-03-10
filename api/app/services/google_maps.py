from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import get_settings
from app.models.places import DestinationAutocompleteItem, GooglePlaceCandidate
from app.models.routing import RoutePreviewItem, RoutePreviewRequest, RouteTravelMode

logger = logging.getLogger(__name__)

_PLACES_BASE_URL = "https://places.googleapis.com/v1"
_ROUTES_BASE_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
_GEOCODING_BASE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
_TIME_ZONE_BASE_URL = "https://maps.googleapis.com/maps/api/timezone/json"
_ADDRESS_VALIDATION_BASE_URL = "https://addressvalidation.googleapis.com/v1:validateAddress"
_DESTINATION_TYPES = {
    "country",
    "locality",
    "administrative_area_level_1",
    "administrative_area_level_2",
    "postal_town",
    "sublocality",
    "neighborhood",
}


class GoogleMapsError(RuntimeError):
    pass


class GoogleMapsNotConfiguredError(GoogleMapsError):
    pass


class GoogleMapsRequestError(GoogleMapsError):
    pass


@dataclass(slots=True)
class GooglePlaceDetails:
    place_id: str
    name: str | None
    formatted_address: str | None
    category: str | None
    country: str | None
    region: str | None
    lat: float | None
    lng: float | None
    timezone: str | None
    metadata: dict[str, Any]


@dataclass(slots=True)
class GeocodeResult:
    place_id: str | None
    formatted_address: str | None
    lat: float | None
    lng: float | None
    country: str | None
    region: str | None
    metadata: dict[str, Any]


@dataclass(slots=True)
class AddressValidationResult:
    formatted_address: str | None
    region_code: str | None
    verdict: dict[str, Any]
    address: dict[str, Any]
    geocode: dict[str, Any]
    metadata: dict[str, Any]


def _settings():
    return get_settings()


def google_maps_enabled() -> bool:
    return bool(_settings().google_maps_api_key)


def _field_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _component_text(component: dict[str, Any], *, short: bool = False) -> str | None:
    if short:
        return _field_text(
            component.get("shortText")
            or component.get("short_name")
            or component.get("shortName")
        )
    return _field_text(component.get("longText") or component.get("long_name") or component.get("longName"))


def _component_types(component: dict[str, Any]) -> list[str]:
    raw = component.get("types")
    if isinstance(raw, list):
        return [str(item) for item in raw if isinstance(item, str)]
    return []


def _find_component(components: list[dict[str, Any]], component_type: str) -> dict[str, Any] | None:
    return next((item for item in components if component_type in _component_types(item)), None)


def _country_from_components(components: list[dict[str, Any]]) -> str | None:
    item = _find_component(components, "country")
    return _component_text(item or {}) if item else None


def _region_from_components(components: list[dict[str, Any]]) -> str | None:
    for component_type in (
        "administrative_area_level_1",
        "administrative_area_level_2",
        "locality",
        "postal_town",
    ):
        item = _find_component(components, component_type)
        if item:
            return _component_text(item)
    return None


def _lat_lng_from_location(location: Any) -> tuple[float | None, float | None]:
    if not isinstance(location, dict):
        return None, None
    lat = location.get("latitude") if "latitude" in location else location.get("lat")
    lng = location.get("longitude") if "longitude" in location else location.get("lng")
    try:
        lat_value = float(lat) if lat is not None else None
    except (TypeError, ValueError):
        lat_value = None
    try:
        lng_value = float(lng) if lng is not None else None
    except (TypeError, ValueError):
        lng_value = None
    return lat_value, lng_value


def _duration_minutes(value: str | None) -> float | None:
    if not value or not value.endswith("s"):
        return None
    try:
        seconds = float(value[:-1])
    except ValueError:
        return None
    return round(seconds / 60.0, 1)


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


async def _request_json(
    *,
    method: str,
    url: str,
    timeout: int,
    field_mask: str | None = None,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    settings = _settings()
    if not settings.google_maps_api_key:
        raise GoogleMapsNotConfiguredError("Google Maps API key is not configured")

    headers = {
        "User-Agent": settings.media_user_agent,
        "X-Goog-Api-Key": settings.google_maps_api_key,
    }
    if field_mask:
        headers["X-Goog-FieldMask"] = field_mask

    try:
        async with httpx.AsyncClient(
            timeout=timeout,
            headers=headers,
            follow_redirects=True,
        ) as client:
            response = await client.request(method, url, params=params, json=json_body)
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        body = exc.response.text[:500]
        logger.warning("google maps request failed: %s %s", exc, body)
        raise GoogleMapsRequestError("Google Maps request failed") from exc
    except httpx.HTTPError as exc:
        logger.warning("google maps transport failed: %s", exc)
        raise GoogleMapsRequestError("Google Maps request failed") from exc

    payload = response.json()
    if not isinstance(payload, dict):
        raise GoogleMapsRequestError("Unexpected Google Maps response")
    status = payload.get("status")
    if isinstance(status, str) and status not in {"OK", "ZERO_RESULTS"}:
        raise GoogleMapsRequestError(
            _field_text(payload.get("error_message")) or f"Google Maps request failed with status {status}"
        )
    return payload


async def lookup_google_place(place_id: str) -> GooglePlaceDetails | None:
    normalized_place_id = _field_text(place_id)
    if not normalized_place_id:
        return None

    payload = await _request_json(
        method="GET",
        url=f"{_PLACES_BASE_URL}/places/{normalized_place_id}",
        timeout=_settings().google_places_timeout_sec,
        field_mask="id,displayName,formattedAddress,location,primaryType,types,addressComponents,googleMapsUri,websiteUri,viewport",
    )
    components = payload.get("addressComponents")
    if not isinstance(components, list):
        components = []
    lat, lng = _lat_lng_from_location(payload.get("location"))
    try:
        timezone = await resolve_time_zone(lat=lat, lng=lng) if lat is not None and lng is not None else None
    except GoogleMapsError:
        timezone = None
    return GooglePlaceDetails(
        place_id=_field_text(payload.get("id")) or normalized_place_id,
        name=_field_text((payload.get("displayName") or {}).get("text")),
        formatted_address=_field_text(payload.get("formattedAddress")),
        category=_field_text(payload.get("primaryType")),
        country=_country_from_components(components),
        region=_region_from_components(components),
        lat=lat,
        lng=lng,
        timezone=timezone,
        metadata={
            "types": payload.get("types") if isinstance(payload.get("types"), list) else [],
            "google_maps_uri": _field_text(payload.get("googleMapsUri")),
            "website_uri": _field_text(payload.get("websiteUri")),
            "viewport": payload.get("viewport") if isinstance(payload.get("viewport"), dict) else None,
        },
    )


def _score_candidate(name: str | None, label: str, query: str) -> int:
    normalized_name = " ".join((name or "").strip().lower().split())
    normalized_label = " ".join(label.strip().lower().split())
    normalized_query = " ".join(query.strip().lower().split())
    if not normalized_query:
        return 99
    if normalized_name == normalized_query:
        return 0
    if normalized_label == normalized_query:
        return 1
    if normalized_label.startswith(f"{normalized_query},"):
        return 2
    if normalized_name.startswith(normalized_query):
        return 3
    if normalized_query in normalized_name:
        return 4
    if normalized_query in normalized_label:
        return 5
    return 99


def _place_candidate_from_details(details: GooglePlaceDetails) -> GooglePlaceCandidate:
    label = details.formatted_address or details.name or details.place_id
    return GooglePlaceCandidate(
        place_id=details.place_id,
        label=label,
        name=details.name or label,
        address_text=details.formatted_address,
        category=details.category,
        country=details.country,
        region=details.region,
        lat=details.lat,
        lon=details.lng,
        timezone=details.timezone,
        metadata=details.metadata,
    )


def _destination_item_from_details(details: GooglePlaceDetails) -> DestinationAutocompleteItem:
    label = details.formatted_address or details.name or details.place_id
    return DestinationAutocompleteItem(
        id=details.place_id,
        label=label,
        name=details.name or label,
        country=details.country,
        region=details.region,
        lat=details.lat,
        lon=details.lng,
        address_text=details.formatted_address,
        category=details.category,
        timezone=details.timezone,
        metadata=details.metadata,
    )


def _prediction_types(prediction: dict[str, Any]) -> list[str]:
    raw = prediction.get("types")
    if isinstance(raw, list):
        return [str(item) for item in raw if isinstance(item, str)]
    return []


def _prediction_score(prediction: dict[str, Any], query: str) -> int:
    text = _field_text((prediction.get("text") or {}).get("text"))
    main_text = _field_text(
        ((prediction.get("structuredFormat") or {}).get("mainText") or {}).get("text")
    )
    label = text or main_text or ""
    return _score_candidate(main_text or text, label, query)


async def search_destination_suggestions(q: str, limit: int) -> list[DestinationAutocompleteItem]:
    query = q.strip()
    if len(query) < 2 or not google_maps_enabled():
        return []

    payload = await _request_json(
        method="POST",
        url=f"{_PLACES_BASE_URL}/places:autocomplete",
        timeout=_settings().google_places_timeout_sec,
        field_mask="suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types",
        json_body={
            "input": query,
            "languageCode": _settings().google_maps_language,
            "includeQueryPredictions": False,
            **(
                {"regionCode": _settings().google_maps_region}
                if _settings().google_maps_region
                else {}
            ),
        },
    )
    suggestions = payload.get("suggestions")
    if not isinstance(suggestions, list):
        return []

    predictions: list[dict[str, Any]] = []
    for item in suggestions:
        prediction = item.get("placePrediction") if isinstance(item, dict) else None
        if not isinstance(prediction, dict):
            continue
        predictions.append(prediction)

    predictions.sort(
        key=lambda prediction: (
            0 if _DESTINATION_TYPES & set(_prediction_types(prediction)) else 1,
            _prediction_score(prediction, query),
        )
    )

    candidate_place_ids: list[str] = []
    seen: set[str] = set()
    for prediction in predictions:
        place_id = _field_text(prediction.get("placeId"))
        if not place_id or place_id in seen:
            continue
        seen.add(place_id)
        candidate_place_ids.append(place_id)
        if len(candidate_place_ids) >= max(limit * 2, limit):
            break

    details = await asyncio.gather(
        *(lookup_google_place(place_id) for place_id in candidate_place_ids),
        return_exceptions=True,
    )
    ranked_items: list[tuple[int, DestinationAutocompleteItem]] = []
    for detail in details:
        if isinstance(detail, Exception) or detail is None:
            continue
        item = _destination_item_from_details(detail)
        score = _score_candidate(item.name, item.label, query)
        if score == 99:
            continue
        ranked_items.append((score, item))

    ranked_items.sort(key=lambda entry: (entry[0], len(entry[1].label), entry[1].label))
    return [item for _, item in ranked_items[:limit]]


async def search_google_places(q: str, limit: int) -> list[GooglePlaceCandidate]:
    query = q.strip()
    if len(query) < 2 or not google_maps_enabled():
        return []

    payload = await _request_json(
        method="POST",
        url=f"{_PLACES_BASE_URL}/places:searchText",
        timeout=_settings().google_places_timeout_sec,
        field_mask="places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types,places.googleMapsUri,places.websiteUri,places.addressComponents,places.viewport",
        json_body={
            "textQuery": query,
            "pageSize": max(1, min(limit, 10)),
            "languageCode": _settings().google_maps_language,
            **(
                {"regionCode": _settings().google_maps_region}
                if _settings().google_maps_region
                else {}
            ),
        },
    )
    places = payload.get("places")
    if not isinstance(places, list):
        return []

    candidates: list[GooglePlaceCandidate] = []
    for place in places[:limit]:
        if not isinstance(place, dict):
            continue
        components = place.get("addressComponents")
        if not isinstance(components, list):
            components = []
        lat, lng = _lat_lng_from_location(place.get("location"))
        candidates.append(
            GooglePlaceCandidate(
                place_id=_field_text(place.get("id")) or "",
                label=_field_text(place.get("formattedAddress"))
                or _field_text((place.get("displayName") or {}).get("text"))
                or "",
                name=_field_text((place.get("displayName") or {}).get("text")) or query,
                address_text=_field_text(place.get("formattedAddress")),
                category=_field_text(place.get("primaryType")),
                country=_country_from_components(components),
                region=_region_from_components(components),
                lat=lat,
                lon=lng,
                metadata={
                    "types": place.get("types") if isinstance(place.get("types"), list) else [],
                    "google_maps_uri": _field_text(place.get("googleMapsUri")),
                    "website_uri": _field_text(place.get("websiteUri")),
                    "viewport": place.get("viewport") if isinstance(place.get("viewport"), dict) else None,
                },
            )
        )
    return [candidate for candidate in candidates if candidate.place_id]


async def geocode_address(address_text: str) -> GeocodeResult | None:
    query = _field_text(address_text)
    if not query or not google_maps_enabled():
        return None
    payload = await _request_json(
        method="GET",
        url=_GEOCODING_BASE_URL,
        timeout=_settings().google_places_timeout_sec,
        params={
            "address": query,
            "key": _settings().google_maps_api_key,
            "language": _settings().google_maps_language,
            **({"region": _settings().google_maps_region} if _settings().google_maps_region else {}),
        },
    )
    results = payload.get("results")
    if not isinstance(results, list) or not results:
        return None
    first = results[0]
    if not isinstance(first, dict):
        return None
    components = first.get("address_components")
    if not isinstance(components, list):
        components = []
    lat, lng = _lat_lng_from_location((first.get("geometry") or {}).get("location"))
    return GeocodeResult(
        place_id=_field_text(first.get("place_id")),
        formatted_address=_field_text(first.get("formatted_address")),
        lat=lat,
        lng=lng,
        country=_country_from_components(components),
        region=_region_from_components(components),
        metadata={
            "location_type": _field_text((first.get("geometry") or {}).get("location_type")),
            "partial_match": bool(first.get("partial_match")),
        },
    )


async def resolve_time_zone(*, lat: float | None, lng: float | None) -> str | None:
    if lat is None or lng is None or not google_maps_enabled():
        return None
    payload = await _request_json(
        method="GET",
        url=_TIME_ZONE_BASE_URL,
        timeout=_settings().google_places_timeout_sec,
        params={
            "location": f"{lat},{lng}",
            "timestamp": int(time.time()),
            "key": _settings().google_maps_api_key,
            "language": _settings().google_maps_language,
        },
    )
    return _field_text(payload.get("timeZoneId"))


async def validate_address(address_text: str) -> AddressValidationResult | None:
    query = _field_text(address_text)
    if not query or not google_maps_enabled():
        return None
    payload = await _request_json(
        method="POST",
        url=_ADDRESS_VALIDATION_BASE_URL,
        timeout=_settings().google_places_timeout_sec,
        json_body={
            "address": {
                "addressLines": [query],
                **(
                    {"regionCode": _settings().google_maps_region}
                    if _settings().google_maps_region
                    else {}
                ),
            }
        },
    )
    result = payload.get("result")
    if not isinstance(result, dict):
        return None
    address = result.get("address")
    geocode = result.get("geocode")
    verdict = result.get("verdict")
    address_dict = address if isinstance(address, dict) else {}
    geocode_dict = geocode if isinstance(geocode, dict) else {}
    verdict_dict = verdict if isinstance(verdict, dict) else {}
    return AddressValidationResult(
        formatted_address=_field_text(address_dict.get("formattedAddress")),
        region_code=_field_text(address_dict.get("regionCode")),
        verdict=verdict_dict,
        address=address_dict,
        geocode=geocode_dict,
        metadata=result,
    )


async def compute_routes(request: RoutePreviewRequest) -> list[RoutePreviewItem]:
    if not google_maps_enabled():
        return []
    payload = await _request_json(
        method="POST",
        url=_ROUTES_BASE_URL,
        timeout=_settings().google_routes_timeout_sec,
        field_mask="routes.description,routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline",
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
                distance_m=int(route["distanceMeters"]) if route.get("distanceMeters") is not None else None,
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
