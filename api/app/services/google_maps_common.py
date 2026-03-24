from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from app.config import get_settings
from app.models.places import GooglePlaceCandidate

logger = logging.getLogger(__name__)

_PLACES_BASE_URL = "https://places.googleapis.com/v1"
_ROUTES_BASE_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
_GEOCODING_BASE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
_TIME_ZONE_BASE_URL = "https://maps.googleapis.com/maps/api/timezone/json"
_ADDRESS_VALIDATION_BASE_URL = "https://addressvalidation.googleapis.com/v1:validateAddress"


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
class GooglePlacePhoto:
    name: str
    width_px: int | None
    height_px: int | None
    attribution_text: str | None
    author_name: str | None
    author_url: str | None


@dataclass(slots=True)
class GooglePlaceRichDetail:
    place: GooglePlaceCandidate
    summary: str | None
    rating: float | None
    review_count: int | None
    status_text: str | None
    price_label: str | None
    photos: list[dict[str, Any]]
    reviews: list[dict[str, Any]]
    hours: list[dict[str, Any]]
    booking_links: list[dict[str, str]]
    tags: list[str]
    mentions: list[dict[str, str | None]]


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
            component.get("shortText") or component.get("short_name") or component.get("shortName")
        )
    return _field_text(
        component.get("longText") or component.get("long_name") or component.get("longName")
    )


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


def _coerce_int(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _coerce_float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _google_place_photo_media_url(photo_name: str, *, max_width_px: int) -> str:
    return f"{_PLACES_BASE_URL}/{photo_name}/media?maxWidthPx={max(1, int(max_width_px))}"


def _google_place_photo_asset_url(photo_name: str, *, max_width_px: int) -> str:
    return (
        "/places/google-photo-asset"
        f"?name={quote(photo_name, safe='')}"
        f"&max_width_px={max(1, int(max_width_px))}"
    )


def _author_attribution_fields(raw: Any) -> tuple[str | None, str | None, str | None]:
    if not isinstance(raw, list):
        return None, None, None

    labels: list[str] = []
    first_name: str | None = None
    first_url: str | None = None
    for item in raw:
        if not isinstance(item, dict):
            continue
        display_name = _field_text(item.get("displayName"))
        uri = _field_text(item.get("uri"))
        if display_name:
            labels.append(display_name)
            if first_name is None:
                first_name = display_name
        if uri and first_url is None:
            first_url = uri

    attribution_text = ", ".join(labels) if labels else None
    return attribution_text, first_name, first_url


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
            _field_text(payload.get("error_message"))
            or f"Google Maps request failed with status {status}"
        )
    return payload


async def fetch_google_place_photo_asset(
    photo_name: str, *, max_width_px: int = 1600
) -> tuple[bytes, str | None]:
    normalized_photo_name = _field_text(photo_name)
    if not normalized_photo_name:
        raise GoogleMapsRequestError("Google Place photo name is required")

    settings = _settings()
    if not settings.google_maps_api_key:
        raise GoogleMapsNotConfiguredError("Google Maps API key is not configured")

    headers = {
        "User-Agent": settings.media_user_agent,
        "X-Goog-Api-Key": settings.google_maps_api_key,
    }

    try:
        async with httpx.AsyncClient(
            timeout=settings.google_places_timeout_sec,
            headers=headers,
            follow_redirects=True,
        ) as client:
            response = await client.get(
                _google_place_photo_media_url(normalized_photo_name, max_width_px=max_width_px)
            )
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        body = exc.response.text[:500]
        logger.warning("google place photo request failed: %s %s", exc, body)
        raise GoogleMapsRequestError("Google Place photo request failed") from exc
    except httpx.HTTPError as exc:
        logger.warning("google place photo transport failed: %s", exc)
        raise GoogleMapsRequestError("Google Place photo request failed") from exc

    return response.content, response.headers.get("content-type")
