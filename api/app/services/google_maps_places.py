from __future__ import annotations

import asyncio
import time
from typing import Any

from app.models.places import DestinationAutocompleteItem, GooglePlaceCandidate
from app.services.google_maps_common import (
    _ADDRESS_VALIDATION_BASE_URL,
    _GEOCODING_BASE_URL,
    _PLACES_BASE_URL,
    _TIME_ZONE_BASE_URL,
    AddressValidationResult,
    GeocodeResult,
    GoogleMapsError,
    GoogleMapsRequestError,
    GooglePlaceDetails,
    GooglePlacePhoto,
    GooglePlaceRichDetail,
    _author_attribution_fields,
    _coerce_float,
    _coerce_int,
    _country_from_components,
    _field_text,
    _google_place_photo_asset_url,
    _lat_lng_from_location,
    _region_from_components,
    _request_json,
    _settings,
    google_maps_enabled,
)

_DESTINATION_TYPES = {
    "country",
    "locality",
    "administrative_area_level_1",
    "administrative_area_level_2",
    "postal_town",
    "sublocality",
    "neighborhood",
}

_LOOKUP_PLACE_FIELD_MASK = (
    "id,displayName,formattedAddress,location,primaryType,types,addressComponents,"
    "googleMapsUri,websiteUri,viewport,businessStatus"
)
_DETAIL_PLACE_FIELD_MASK = (
    "id,displayName,formattedAddress,location,primaryType,types,addressComponents,"
    "googleMapsUri,websiteUri,viewport,businessStatus,editorialSummary,rating,"
    "userRatingCount,priceLevel,currentOpeningHours,regularOpeningHours,reviews,"
    "photos.name,photos.widthPx,photos.heightPx,photos.authorAttributions"
)
_PHOTO_FIELD_MASK = "photos.name,photos.widthPx,photos.heightPx,photos.authorAttributions"
_DESTINATION_AUTOCOMPLETE_FIELD_MASK = (
    "suggestions.placePrediction.placeId,suggestions.placePrediction.text,"
    "suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types"
)
_PLACE_SEARCH_FIELD_MASK = (
    "places.id,places.displayName,places.formattedAddress,places.location,"
    "places.primaryType,places.types,places.googleMapsUri,places.websiteUri,"
    "places.addressComponents,places.viewport"
)


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


async def _populate_place_timezone(details: GooglePlaceDetails) -> GooglePlaceDetails:
    try:
        details.timezone = (
            await resolve_time_zone(lat=details.lat, lng=details.lng)
            if details.lat is not None and details.lng is not None
            else None
        )
    except GoogleMapsError:
        details.timezone = None
    return details


async def lookup_google_place(place_id: str) -> GooglePlaceDetails | None:
    normalized_place_id = _field_text(place_id)
    if not normalized_place_id:
        return None

    payload = await _google_place_payload(normalized_place_id, field_mask=_LOOKUP_PLACE_FIELD_MASK)
    details = _google_place_details_from_payload(
        payload,
        normalized_place_id=normalized_place_id,
    )
    return await _populate_place_timezone(details)


async def fetch_google_place_photos(place_id: str, *, limit: int = 8) -> list[dict[str, Any]]:
    normalized_place_id = _field_text(place_id)
    if not normalized_place_id:
        return []

    payload = await _google_place_payload(normalized_place_id, field_mask=_PHOTO_FIELD_MASK)
    photos = _normalize_google_place_photos(payload.get("photos"), limit=limit)
    return _serialize_google_place_photos(photos)


async def fetch_google_place_detail(place_id: str) -> GooglePlaceRichDetail | None:
    normalized_place_id = _field_text(place_id)
    if not normalized_place_id:
        return None

    payload = await _google_place_payload(normalized_place_id, field_mask=_DETAIL_PLACE_FIELD_MASK)
    details = _google_place_details_from_payload(
        payload,
        normalized_place_id=normalized_place_id,
    )
    details = await _populate_place_timezone(details)

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
        field_mask=_DESTINATION_AUTOCOMPLETE_FIELD_MASK,
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
        field_mask=_PLACE_SEARCH_FIELD_MASK,
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
