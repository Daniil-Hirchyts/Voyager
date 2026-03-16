from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from app.config import get_settings
from app.models.activity_discovery import ActivityEntityType


class ActivityProviderError(Exception):
    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


class ActivityProviderRetryableError(ActivityProviderError):
    pass


class ActivityProviderNonRetryableError(ActivityProviderError):
    pass


class ActivityProviderLimitedError(ActivityProviderError):
    pass


@dataclass
class ActivityProviderAvailability:
    configured: bool
    missing_env_vars: list[str]


def resolve_activity_provider_availability() -> ActivityProviderAvailability:
    settings = get_settings()
    missing: list[str] = []
    if not settings.activities_tripadvisor_api_key:
        missing.append("TRIPADVISOR_SCRAPER_API_KEY")
    return ActivityProviderAvailability(configured=not missing, missing_env_vars=missing)


def _coerce_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_int(value: Any) -> int | None:
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _coerce_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _normalize_price_label(
    *,
    price_label: Any = None,
    min_price: Any = None,
    max_price: Any = None,
    currency: str | None = None,
) -> str | None:
    if isinstance(price_label, str) and price_label.strip():
        return price_label.strip()
    min_decimal = _coerce_decimal(min_price)
    max_decimal = _coerce_decimal(max_price)
    if min_decimal is None and max_decimal is None:
        return None
    if min_decimal is not None and max_decimal is not None and min_decimal != max_decimal:
        return f"{min_decimal} - {max_decimal} {currency or ''}".strip()
    value = min_decimal or max_decimal
    if value is None:
        return None
    return f"{value} {currency or ''}".strip()


def _as_datetime(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    cleaned = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(cleaned)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _string_list(*values: Any) -> list[str]:
    items: list[str] = []
    for value in values:
        if isinstance(value, str) and value.strip():
            candidate = value.strip()
            if candidate not in items:
                items.append(candidate)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    name = item.get("name") or item.get("text")
                    if isinstance(name, str) and name.strip() and name not in items:
                        items.append(name.strip())
                elif isinstance(item, str) and item.strip() and item.strip() not in items:
                    items.append(item.strip())
    return items


def _extract_address(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, dict):
        for key in ("address", "location_name_detailed"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
    return None


def _extract_coordinates(payload: dict[str, Any]) -> tuple[float | None, float | None]:
    coordinates = payload.get("coordinates")
    if isinstance(coordinates, dict):
        return _coerce_float(coordinates.get("latitude")), _coerce_float(
            coordinates.get("longitude")
        )
    if isinstance(payload.get("latitude"), (int, float, str)) or isinstance(
        payload.get("longitude"), (int, float, str)
    ):
        return _coerce_float(payload.get("latitude")), _coerce_float(payload.get("longitude"))
    return None, None


def _dict_or_empty(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _photo_from_payload(item: dict[str, Any]) -> dict[str, Any] | None:
    image_url = (
        item.get("image_link")
        or item.get("image_url")
        or item.get("featured_image")
        or item.get("url")
    )
    if not isinstance(image_url, str) or not image_url:
        return None
    return {
        "image_url": image_url,
        "thumbnail_url": item.get("thumbnail") or item.get("thumbnail_url"),
        "width": _coerce_int(item.get("width")),
        "height": _coerce_int(item.get("height")),
        "caption": item.get("caption")
        if isinstance(item.get("caption"), str)
        else item.get("title"),
    }


def _extract_photos(payload: dict[str, Any]) -> list[dict[str, Any]]:
    photos: list[dict[str, Any]] = []
    for key in ("images", "photos"):
        value = payload.get(key)
        if not isinstance(value, list):
            continue
        for item in value:
            if not isinstance(item, dict):
                continue
            photo = _photo_from_payload(item)
            if photo:
                photos.append(photo)
    featured = payload.get("featured_image")
    if (
        isinstance(featured, str)
        and featured
        and not any(p["image_url"] == featured for p in photos)
    ):
        photos.insert(
            0,
            {
                "image_url": featured,
                "thumbnail_url": featured,
                "width": None,
                "height": None,
                "caption": None,
            },
        )
    return photos[:24]


def _extract_hours(payload: dict[str, Any]) -> list[dict[str, Any]]:
    hours = payload.get("hours")
    if not isinstance(hours, list):
        return []
    rows: list[dict[str, Any]] = []
    for item in hours:
        if not isinstance(item, dict):
            continue
        day = item.get("day")
        if not isinstance(day, str) or not day:
            continue
        times_payload = item.get("times") if isinstance(item.get("times"), list) else []
        times = []
        for row in times_payload:
            if not isinstance(row, dict):
                continue
            times.append({"open": row.get("open"), "close": row.get("close")})
        rows.append({"day": day, "times": times})
    return rows


def _extract_booking_links(payload: dict[str, Any]) -> list[dict[str, str]]:
    links: list[dict[str, str]] = []

    reservation_providers = payload.get("reservation_providers")
    if isinstance(reservation_providers, list):
        for item in reservation_providers:
            if not isinstance(item, dict):
                continue
            link = item.get("link")
            label = item.get("provider_name")
            if isinstance(link, str) and link and isinstance(label, str) and label:
                links.append({"label": label, "url": link})

    deal_links = payload.get("deal_links")
    if isinstance(deal_links, list):
        for item in deal_links:
            if not isinstance(item, dict):
                continue
            link = item.get("link")
            label = item.get("type")
            if isinstance(link, str) and link and isinstance(label, str) and label:
                links.append({"label": label, "url": link})

    commerce = payload.get("commerce")
    if isinstance(commerce, dict):
        for key, value in commerce.items():
            if isinstance(value, str) and value:
                links.append({"label": key.replace("_", " ").title(), "url": value})

    website = payload.get("website")
    if isinstance(website, str) and website:
        links.append({"label": "Website", "url": website})

    seen: set[str] = set()
    deduped: list[dict[str, str]] = []
    for item in links:
        if item["url"] in seen:
            continue
        seen.add(item["url"])
        deduped.append(item)
    return deduped[:12]


def _normalize_reviews(payload: dict[str, Any]) -> list[dict[str, Any]]:
    results = payload.get("results")
    if not isinstance(results, list):
        return []
    reviews: list[dict[str, Any]] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        reviewer = (
            item.get("reviewer") if isinstance(item.get("reviewer"), dict) else item.get("user")
        )
        reviews.append(
            {
                "review_id": str(item.get("review_id") or item.get("id") or ""),
                "title": item.get("title"),
                "text": item.get("text") or item.get("snippet_text"),
                "rating": _coerce_float(item.get("rating")),
                "published_at": item.get("published_at_date")
                or item.get("published_date")
                or item.get("created_at_date"),
                "reviewer_name": reviewer.get("name") if isinstance(reviewer, dict) else None,
                "reviewer_username": reviewer.get("username")
                if isinstance(reviewer, dict)
                else None,
                "review_url": item.get("review_link") or item.get("url"),
            }
        )
    return [item for item in reviews if item["review_id"]]


def _base_item(
    *,
    item_id: str,
    entity_type: ActivityEntityType,
    provider_ref: str,
    title: str,
    summary: str | None,
    rating: Any,
    review_count: Any,
    price_label: str | None,
    image_url: str | None,
    detail_url: str | None,
    address_text: str | None,
    lat: float | None,
    lon: float | None,
    tags: list[str],
    status_text: str | None,
) -> dict[str, Any]:
    return {
        "id": item_id,
        "entity_type": entity_type,
        "provider": "tripadvisor",
        "provider_ref": provider_ref,
        "title": title[:255],
        "summary": summary,
        "rating": _coerce_float(rating),
        "review_count": _coerce_int(review_count),
        "price_label": str(price_label).strip() if price_label not in (None, "") else None,
        "image_url": image_url,
        "detail_url": detail_url,
        "address_text": address_text,
        "lat": lat,
        "lon": lon,
        "tags": tags,
        "status_text": str(status_text).strip() if status_text not in (None, "") else None,
        "is_attachable": entity_type
        in {ActivityEntityType.ATTRACTION, ActivityEntityType.RESTAURANT},
    }


def normalize_provider_item(
    *,
    entity_type: ActivityEntityType,
    payload: dict[str, Any],
    item_id: str | None = None,
) -> dict[str, Any]:
    lat, lon = _extract_coordinates(payload)
    award = _dict_or_empty(payload.get("award"))
    ranking = _dict_or_empty(payload.get("ranking"))
    experiences = _dict_or_empty(payload.get("experiences"))
    cruise_company = _dict_or_empty(payload.get("cruise_company"))
    if entity_type == ActivityEntityType.ATTRACTION:
        provider_ref = str(
            payload.get("tripadvisor_entity_id") or payload.get("link") or payload.get("name")
        )
        return _base_item(
            item_id=item_id or f"attraction:{provider_ref}",
            entity_type=entity_type,
            provider_ref=provider_ref,
            title=str(payload.get("name") or "Attraction"),
            summary=payload.get("description"),
            rating=payload.get("rating"),
            review_count=payload.get("reviews") or payload.get("review_count"),
            price_label=_normalize_price_label(price_label=payload.get("pricing_text")),
            image_url=payload.get("featured_image"),
            detail_url=payload.get("link"),
            address_text=payload.get("neighborhood")
            or _extract_address(payload.get("address"))
            or payload.get("location_string"),
            lat=lat,
            lon=lon,
            tags=_string_list(payload.get("categories"), award.get("award_name")),
            status_text=payload.get("pricing_text")
            or award.get("award_name")
            or experiences.get("experiences_count"),
        )

    if entity_type == ActivityEntityType.RESTAURANT:
        provider_ref = str(
            payload.get("tripadvisor_entity_id") or payload.get("link") or payload.get("name")
        )
        address = payload.get("address")
        return _base_item(
            item_id=item_id or f"restaurant:{provider_ref}",
            entity_type=entity_type,
            provider_ref=provider_ref,
            title=str(payload.get("name") or "Restaurant"),
            summary=None,
            rating=payload.get("rating"),
            review_count=payload.get("reviews") or payload.get("review_count"),
            price_label=_normalize_price_label(price_label=payload.get("price_range")),
            image_url=payload.get("featured_image"),
            detail_url=payload.get("link"),
            address_text=_extract_address(address),
            lat=lat,
            lon=lon,
            tags=_string_list(
                payload.get("cuisines"),
                payload.get("establishment_types"),
                award.get("award_name"),
            ),
            status_text=payload.get("status_text") or award.get("award_name"),
        )

    if entity_type == ActivityEntityType.HOTEL:
        provider_ref = str(
            payload.get("tripadvisor_entity_id") or payload.get("link") or payload.get("name")
        )
        detailed_address = payload.get("detailed_address")
        price_range = (
            payload.get("price_range") if isinstance(payload.get("price_range"), dict) else {}
        )
        return _base_item(
            item_id=item_id or f"hotel:{provider_ref}",
            entity_type=entity_type,
            provider_ref=provider_ref,
            title=str(payload.get("name") or "Hotel"),
            summary=payload.get("description"),
            rating=payload.get("rating"),
            review_count=payload.get("reviews") or payload.get("review_count"),
            price_label=_normalize_price_label(
                min_price=price_range.get("min"),
                max_price=price_range.get("max"),
                currency=payload.get("currency"),
            ),
            image_url=payload.get("featured_image"),
            detail_url=payload.get("link"),
            address_text=_extract_address(detailed_address) or payload.get("address"),
            lat=lat,
            lon=lon,
            tags=_string_list(
                payload.get("hotel_styles"), payload.get("labels"), award.get("award_name")
            ),
            status_text=ranking.get("text") or award.get("award_name"),
        )

    ship = payload.get("ship") if isinstance(payload.get("ship"), dict) else {}
    destination = payload.get("destination") if isinstance(payload.get("destination"), dict) else {}
    departure_port = (
        payload.get("departure_port") if isinstance(payload.get("departure_port"), dict) else {}
    )
    provider_ref = str(
        ship.get("tripadvisor_entity_id")
        or payload.get("cruise_id")
        or ship.get("ship_id")
        or payload.get("cruise_title")
    )
    sailings = (
        payload.get("sailings", {}).get("results")
        if isinstance(payload.get("sailings"), dict)
        else []
    )
    first_sailing = sailings[0] if isinstance(sailings, list) and sailings else {}
    return _base_item(
        item_id=item_id or f"cruise:{provider_ref}",
        entity_type=entity_type,
        provider_ref=provider_ref,
        title=str(payload.get("cruise_title") or ship.get("ship_name") or "Cruise"),
        summary=(
            f"{payload.get('duration_nights') or '?'} night sailing with "
            f"{cruise_company.get('cruise_company_name') or 'TripAdvisor cruises'}"
        ),
        rating=ship.get("rating"),
        review_count=ship.get("reviews"),
        price_label=None,
        image_url=destination.get("destination_image_link") or ship.get("icon_link"),
        detail_url=ship.get("tripadvisor_entity_link") or ship.get("company_cruises_link"),
        address_text=departure_port.get("port_name"),
        lat=None,
        lon=None,
        tags=_string_list(
            destination.get("destination_name"),
            cruise_company.get("cruise_company_name"),
            ship.get("amenities"),
        ),
        status_text=first_sailing.get("departure_date"),
    )


class TripAdvisorActivityProvider:
    def __init__(self) -> None:
        self.settings = get_settings()

    @property
    def base_url(self) -> str:
        return self.settings.activities_tripadvisor_base_url.rstrip("/")

    async def _request(self, path: str, *, params: dict[str, Any] | None = None) -> dict[str, Any]:
        headers = {
            "API-Key": str(self.settings.activities_tripadvisor_api_key or ""),
            "Accept": "application/json",
            "User-Agent": self.settings.media_user_agent,
        }
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                timeout=float(self.settings.activities_tripadvisor_timeout_sec),
                headers=headers,
            ) as client:
                response = await client.get(path, params=params)
        except httpx.TimeoutException as exc:
            raise ActivityProviderRetryableError(
                "UPSTREAM_PROVIDER_TIMEOUT",
                "TripAdvisor request timed out",
                {"provider": "tripadvisor", "path": path},
            ) from exc
        except httpx.HTTPError as exc:
            raise ActivityProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "TripAdvisor request failed",
                {"provider": "tripadvisor", "path": path, "error": str(exc)},
            ) from exc

        if response.status_code == 429:
            raise ActivityProviderLimitedError(
                "PROVIDER_LIMITED",
                "TripAdvisor rate limit reached",
                {"provider": "tripadvisor", "path": path, "status_code": response.status_code},
            )
        if response.status_code >= 500:
            raise ActivityProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "TripAdvisor upstream error",
                {"provider": "tripadvisor", "path": path, "status_code": response.status_code},
            )
        if response.status_code >= 400:
            raise ActivityProviderNonRetryableError(
                "UPSTREAM_PROVIDER_BAD_REQUEST",
                "TripAdvisor request rejected",
                {
                    "provider": "tripadvisor",
                    "path": path,
                    "status_code": response.status_code,
                    "response_text": response.text[:500],
                },
            )

        payload = response.json()
        return payload if isinstance(payload, dict) else {"results": payload}

    async def discover(
        self,
        *,
        entity_type: ActivityEntityType,
        query: str,
        page: int,
        locale: str,
        currency: str | None,
        trip_dates: tuple[str | None, str | None] | None = None,
        min_rating: int | None = None,
        good_for: str | None = None,
        establishment_type: str | None = None,
        meal_type: str | None = None,
        departure_date: str | None = None,
        cruise_length: str | None = None,
    ) -> tuple[int, list[dict[str, Any]], dict[str, Any]]:
        def _params(values: dict[str, Any]) -> dict[str, Any]:
            return {key: value for key, value in values.items() if value not in (None, "")}

        if entity_type == ActivityEntityType.ATTRACTION:
            payload = await self._request(
                "/attractions/list",
                params=_params(
                    {
                        "query": query,
                        "page": page,
                        "good_for": good_for,
                        "min_rating": min_rating,
                        "currency": currency,
                        "locale": locale,
                    }
                ),
            )
        elif entity_type == ActivityEntityType.RESTAURANT:
            payload = await self._request(
                "/restaurants/list",
                params=_params(
                    {
                        "query": query,
                        "page": page,
                        "min_rating": min_rating,
                        "establishment_types": establishment_type,
                        "meal_types": meal_type,
                        "currency": currency,
                        "locale": locale,
                    }
                ),
            )
        elif entity_type == ActivityEntityType.HOTEL:
            check_in, check_out = trip_dates or (None, None)
            payload = await self._request(
                "/hotels/list",
                params=_params(
                    {
                        "query": query,
                        "page": page,
                        "check_in_date": check_in,
                        "check_out_date": check_out,
                        "currency": currency,
                        "locale": locale,
                        "min_rating": min_rating,
                    }
                ),
            )
        else:
            if not query.strip():
                return 0, [], {"count": 0, "results": []}
            payload = await self._request(
                "/cruises/list",
                params=_params(
                    {
                        "destination_name": query,
                        "page": page,
                        "departure_date": departure_date,
                        "cruise_length": cruise_length,
                        "currency": currency,
                        "locale": locale,
                    }
                ),
            )

        results = payload.get("results") if isinstance(payload.get("results"), list) else []
        normalized = [
            normalize_provider_item(entity_type=entity_type, payload=item)
            | {"provider_payload": item}
            for item in results
            if isinstance(item, dict)
        ]
        total = _coerce_int(payload.get("count")) or len(normalized)
        return total, normalized, payload

    async def detail(
        self,
        *,
        entity_type: ActivityEntityType,
        query: str,
        locale: str,
    ) -> dict[str, Any]:
        path = {
            ActivityEntityType.ATTRACTION: "/attractions/detail",
            ActivityEntityType.RESTAURANT: "/restaurants/detail",
            ActivityEntityType.HOTEL: "/hotels/detail",
            ActivityEntityType.CRUISE: "/cruises/detail",
        }[entity_type]
        return await self._request(path, params={"query": query, "locale": locale})

    async def reviews(
        self,
        *,
        query: str,
        locale: str,
    ) -> dict[str, Any]:
        return await self._request(
            "/reviews",
            params={"query": query, "locale": locale, "sort_by": "most_recent", "page": 1},
        )

    async def detail_bundle(
        self,
        *,
        entity_type: ActivityEntityType,
        query: str,
        locale: str,
    ) -> dict[str, Any]:
        detail_payload = await self.detail(entity_type=entity_type, query=query, locale=locale)
        reviews_payload = await self.reviews(query=query, locale=locale)
        return {
            "detail_payload": detail_payload,
            "reviews_payload": reviews_payload,
            "photos": _extract_photos(detail_payload),
            "hours": _extract_hours(detail_payload),
            "booking_links": _extract_booking_links(detail_payload),
            "reviews": _normalize_reviews(reviews_payload),
        }
