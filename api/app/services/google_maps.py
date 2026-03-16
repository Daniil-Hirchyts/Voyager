from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

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


async def _google_place_payload(place_id: str, *, field_mask: str) -> dict[str, Any]:
    normalized_place_id = _field_text(place_id)
    if not normalized_place_id:
        raise GoogleMapsRequestError("Google Place id is required")

    return await _request_json(
        method="GET",
        url=f"{_PLACES_BASE_URL}/places/{normalized_place_id}",
        timeout=_settings().google_places_timeout_sec,
        field_mask=field_mask,
    )


def _google_place_details_from_payload(
    payload: dict[str, Any], *, normalized_place_id: str
) -> GooglePlaceDetails:
    components = payload.get("addressComponents")
    if not isinstance(components, list):
        components = []
    lat, lng = _lat_lng_from_location(payload.get("location"))
    return GooglePlaceDetails(
        place_id=_field_text(payload.get("id")) or normalized_place_id,
        name=_field_text((payload.get("displayName") or {}).get("text")),
        formatted_address=_field_text(payload.get("formattedAddress")),
        category=_field_text(payload.get("primaryType")),
        country=_country_from_components(components),
        region=_region_from_components(components),
        lat=lat,
        lng=lng,
        timezone=None,
        metadata={
            "types": payload.get("types") if isinstance(payload.get("types"), list) else [],
            "google_maps_uri": _field_text(payload.get("googleMapsUri")),
            "website_uri": _field_text(payload.get("websiteUri")),
            "viewport": payload.get("viewport")
            if isinstance(payload.get("viewport"), dict)
            else None,
            "business_status": _field_text(payload.get("businessStatus")),
        },
    )


def _normalize_google_place_photos(raw_photos: Any, *, limit: int = 8) -> list[GooglePlacePhoto]:
    if not isinstance(raw_photos, list):
        return []

    photos: list[GooglePlacePhoto] = []
    for item in raw_photos[:limit]:
        if not isinstance(item, dict):
            continue
        photo_name = _field_text(item.get("name"))
        if not photo_name:
            continue
        attribution_text, author_name, author_url = _author_attribution_fields(
            item.get("authorAttributions")
        )
        photos.append(
            GooglePlacePhoto(
                name=photo_name,
                width_px=_coerce_int(item.get("widthPx")),
                height_px=_coerce_int(item.get("heightPx")),
                attribution_text=attribution_text,
                author_name=author_name,
                author_url=author_url,
            )
        )

    photos.sort(
        key=lambda item: (
            int(item.width_px or 0) * int(item.height_px or 0),
            bool(item.attribution_text),
        ),
        reverse=True,
    )
    return photos[:limit]


def _serialize_google_place_photos(photos: list[GooglePlacePhoto]) -> list[dict[str, Any]]:
    return [
        {
            "source": "google_places",
            "source_media_ref": photo.name,
            "image_url": _google_place_photo_asset_url(photo.name, max_width_px=1600),
            "thumbnail_url": _google_place_photo_asset_url(photo.name, max_width_px=480),
            "width": photo.width_px,
            "height": photo.height_px,
            "license_code": None,
            "license_url": None,
            "author_name": photo.author_name,
            "author_url": photo.author_url,
            "attribution_text": photo.attribution_text,
            "raw_payload_json": {
                "name": photo.name,
                "widthPx": photo.width_px,
                "heightPx": photo.height_px,
                "authorAttributions": photo.attribution_text,
            },
        }
        for photo in photos
    ]


def _price_label_from_google_value(value: Any) -> str | None:
    normalized = _field_text(value)
    if not normalized:
        return None
    price_map = {
        "PRICE_LEVEL_FREE": "Free",
        "PRICE_LEVEL_INEXPENSIVE": "$",
        "PRICE_LEVEL_MODERATE": "$$",
        "PRICE_LEVEL_EXPENSIVE": "$$$",
        "PRICE_LEVEL_VERY_EXPENSIVE": "$$$$",
    }
    return price_map.get(normalized, normalized.replace("_", " ").title())


def _normalize_google_hours(raw_hours: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_hours, dict):
        return []

    descriptions = raw_hours.get("weekdayDescriptions")
    if not isinstance(descriptions, list):
        return []

    hours: list[dict[str, Any]] = []
    for item in descriptions:
        if not isinstance(item, str):
            continue
        day, _, value = item.partition(":")
        label = day.strip()
        summary = value.strip()
        if not label:
            continue
        if not summary:
            hours.append({"day": label, "times": []})
            continue
        windows = [
            {"open": part.strip(), "close": None} for part in summary.split(",") if part.strip()
        ]
        hours.append({"day": label, "times": windows})
    return hours


def _normalize_google_reviews(raw_reviews: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_reviews, list):
        return []

    reviews: list[dict[str, Any]] = []
    for index, item in enumerate(raw_reviews[:6]):
        if not isinstance(item, dict):
            continue
        author = (
            item.get("authorAttribution") if isinstance(item.get("authorAttribution"), dict) else {}
        )
        text_payload = item.get("text") if isinstance(item.get("text"), dict) else {}
        original_text_payload = (
            item.get("originalText") if isinstance(item.get("originalText"), dict) else {}
        )
        text = _field_text(text_payload.get("text")) or _field_text(
            original_text_payload.get("text")
        )
        reviews.append(
            {
                "review_id": _field_text(item.get("name")) or f"google-review-{index}",
                "title": None,
                "text": text,
                "rating": _coerce_float(item.get("rating")),
                "published_at": _field_text(item.get("publishTime")),
                "reviewer_name": _field_text(author.get("displayName")),
                "reviewer_username": None,
                "review_url": None,
            }
        )
    return reviews


def _google_editorial_summary(payload: dict[str, Any]) -> str | None:
    editorial_summary = payload.get("editorialSummary")
    if isinstance(editorial_summary, dict):
        return _field_text(editorial_summary.get("text") or editorial_summary.get("overview"))
    return _field_text(editorial_summary)


def _google_status_text(payload: dict[str, Any]) -> str | None:
    current_hours = (
        payload.get("currentOpeningHours")
        if isinstance(payload.get("currentOpeningHours"), dict)
        else {}
    )
    open_now = current_hours.get("openNow")
    if isinstance(open_now, bool):
        return "Open now" if open_now else "Closed now"

    business_status = _field_text(payload.get("businessStatus"))
    if business_status == "OPERATIONAL":
        return "Operational"
    if business_status:
        return business_status.replace("_", " ").title()
    return None


def _normalize_google_tags(details: GooglePlaceDetails) -> list[str]:
    raw_types = details.metadata.get("types")
    raw_tags = [details.category, *(raw_types if isinstance(raw_types, list) else [])]
    deduped: list[str] = []
    seen: set[str] = set()
    for item in raw_tags:
        text = _field_text(item)
        if not text:
            continue
        label = text.replace("_", " ").title()
        dedupe_key = label.casefold()
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        deduped.append(label)
    return deduped


def _google_mentions(details: GooglePlaceDetails) -> list[dict[str, str | None]]:
    google_maps_uri = _field_text(details.metadata.get("google_maps_uri"))
    website_uri = _field_text(details.metadata.get("website_uri"))
    mentions = [
        {"label": "Google Maps", "url": google_maps_uri},
        {"label": "Website", "url": website_uri},
    ]
    return [item for item in mentions if item["url"]]


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
            _field_text(payload.get("error_message"))
            or f"Google Maps request failed with status {status}"
        )
    return payload


async def lookup_google_place(place_id: str) -> GooglePlaceDetails | None:
    normalized_place_id = _field_text(place_id)
    if not normalized_place_id:
        return None

    payload = await _google_place_payload(
        normalized_place_id,
        field_mask=(
            "id,displayName,formattedAddress,location,primaryType,types,addressComponents,"
            "googleMapsUri,websiteUri,viewport,businessStatus"
        ),
    )
    details = _google_place_details_from_payload(
        payload,
        normalized_place_id=normalized_place_id,
    )
    try:
        details.timezone = (
            await resolve_time_zone(lat=details.lat, lng=details.lng)
            if details.lat is not None and details.lng is not None
            else None
        )
    except GoogleMapsError:
        details.timezone = None
    return details


async def fetch_google_place_photos(place_id: str, *, limit: int = 8) -> list[dict[str, Any]]:
    normalized_place_id = _field_text(place_id)
    if not normalized_place_id:
        return []

    payload = await _google_place_payload(
        normalized_place_id,
        field_mask="photos.name,photos.widthPx,photos.heightPx,photos.authorAttributions",
    )
    photos = _normalize_google_place_photos(payload.get("photos"), limit=limit)
    return _serialize_google_place_photos(photos)


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


async def fetch_google_place_detail(place_id: str) -> GooglePlaceRichDetail | None:
    normalized_place_id = _field_text(place_id)
    if not normalized_place_id:
        return None

    payload = await _google_place_payload(
        normalized_place_id,
        field_mask=(
            "id,displayName,formattedAddress,location,primaryType,types,addressComponents,"
            "googleMapsUri,websiteUri,viewport,businessStatus,editorialSummary,rating,"
            "userRatingCount,priceLevel,currentOpeningHours,regularOpeningHours,reviews,"
            "photos.name,photos.widthPx,photos.heightPx,photos.authorAttributions"
        ),
    )
    details = _google_place_details_from_payload(
        payload,
        normalized_place_id=normalized_place_id,
    )
    try:
        details.timezone = (
            await resolve_time_zone(lat=details.lat, lng=details.lng)
            if details.lat is not None and details.lng is not None
            else None
        )
    except GoogleMapsError:
        details.timezone = None

    place = _place_candidate_from_details(details)
    photos = _serialize_google_place_photos(
        _normalize_google_place_photos(payload.get("photos"), limit=8)
    )
    mentions = _google_mentions(details)
    booking_links = [
        {"label": item["label"], "url": item["url"]} for item in mentions if item["url"] is not None
    ]
    return GooglePlaceRichDetail(
        place=place,
        summary=_google_editorial_summary(payload),
        rating=_coerce_float(payload.get("rating")),
        review_count=_coerce_int(payload.get("userRatingCount")),
        status_text=_google_status_text(payload),
        price_label=_price_label_from_google_value(payload.get("priceLevel")),
        photos=photos,
        reviews=_normalize_google_reviews(payload.get("reviews")),
        hours=_normalize_google_hours(payload.get("regularOpeningHours")),
        booking_links=booking_links,
        tags=_normalize_google_tags(details),
        mentions=mentions,
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


async def search_google_places(
    q: str,
    limit: int,
    *,
    lat: float | None = None,
    lng: float | None = None,
    radius_m: int | None = None,
    category: str | None = None,
) -> list[GooglePlaceCandidate]:
    query = q.strip() or (category or "").replace("_", " ").strip()
    if len(query) < 2 or not google_maps_enabled():
        return []

    json_body: dict[str, Any] = {
        "textQuery": query,
        "pageSize": max(1, min(limit, 10)),
        "languageCode": _settings().google_maps_language,
        **(
            {"regionCode": _settings().google_maps_region} if _settings().google_maps_region else {}
        ),
    }
    normalized_category = _field_text(category)
    if normalized_category:
        json_body["includedType"] = normalized_category
    if lat is not None and lng is not None and radius_m is not None and radius_m > 0:
        json_body["locationBias"] = {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": float(radius_m),
            }
        }

    payload = await _request_json(
        method="POST",
        url=f"{_PLACES_BASE_URL}/places:searchText",
        timeout=_settings().google_places_timeout_sec,
        field_mask="places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types,places.googleMapsUri,places.websiteUri,places.addressComponents,places.viewport",
        json_body=json_body,
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
                    "viewport": place.get("viewport")
                    if isinstance(place.get("viewport"), dict)
                    else None,
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
            **(
                {"region": _settings().google_maps_region} if _settings().google_maps_region else {}
            ),
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
