from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Protocol
from zoneinfo import ZoneInfo

import httpx

from app.config import get_settings


class EventProviderError(Exception):
    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


class EventProviderRetryableError(EventProviderError):
    pass


class EventProviderNonRetryableError(EventProviderError):
    pass


class EventProviderLimitedError(EventProviderError):
    pass


class EventProvider(Protocol):
    name: str
    required_env_vars: tuple[str, ...]

    async def search(self, request: dict[str, Any]) -> list[dict[str, Any]]: ...


@dataclass
class ProviderAvailability:
    configured: list[str]
    unavailable: list[dict[str, Any]]


def _to_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _to_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    cleaned = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(cleaned)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _to_date(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None


def _resolve_local_event_date(
    *,
    local_date_value: Any,
    start_at: datetime | None,
    timezone_name: str | None,
) -> date | None:
    if local_date := _to_date(local_date_value):
        return local_date
    if start_at is not None and timezone_name:
        try:
            return start_at.astimezone(ZoneInfo(str(timezone_name))).date()
        except Exception:
            pass
    if start_at is not None:
        return start_at.date()
    return None


def _http_error_details(response: httpx.Response) -> dict[str, Any]:
    details: dict[str, Any] = {"status_code": response.status_code}
    try:
        payload = response.json()
    except ValueError:
        payload = None

    if isinstance(payload, dict):
        for key in ("errors", "message", "error", "detail"):
            value = payload.get(key)
            if value is not None:
                details[key] = value
                break
    if "message" not in details:
        details["response_text"] = response.text[:500]
    return details


def _city_hint(location_text: str | None) -> str | None:
    if not location_text:
        return None
    return location_text.split(",")[0].strip() or None


def _pick_image_url(images: Any) -> str | None:
    if not isinstance(images, list):
        return None
    candidates = [item for item in images if isinstance(item, dict) and item.get("url")]
    if not candidates:
        return None
    candidates.sort(
        key=lambda item: (
            int(item.get("width") or 0) * int(item.get("height") or 0),
            str(item.get("ratio") or ""),
        ),
        reverse=True,
    )
    return str(candidates[0]["url"])


def _venue_address(venue: dict[str, Any]) -> str | None:
    parts: list[str] = []
    address = venue.get("address")
    if isinstance(address, dict) and address.get("line1"):
        parts.append(str(address["line1"]))
    city = venue.get("city")
    if isinstance(city, dict) and city.get("name"):
        parts.append(str(city["name"]))
    state = venue.get("state")
    if isinstance(state, dict) and state.get("name"):
        parts.append(str(state["name"]))
    country = venue.get("country")
    if isinstance(country, dict) and country.get("name"):
        parts.append(str(country["name"]))
    return ", ".join(parts) if parts else None


class TicketmasterEventProvider:
    name = "ticketmaster"
    required_env_vars = ("VOYAGER_EVENTS_TICKETMASTER_API_KEY",)

    @staticmethod
    def _base_url() -> str:
        raw = get_settings().events_ticketmaster_base_url.strip()
        if raw.startswith("http://") or raw.startswith("https://"):
            return raw.rstrip("/")
        return f"https://{raw.rstrip('/')}"

    async def search(self, request: dict[str, Any]) -> list[dict[str, Any]]:
        settings = get_settings()
        requested_start = date.fromisoformat(str(request["start_date"]))
        requested_end = date.fromisoformat(str(request["end_date"]))
        params: dict[str, Any] = {
            "apikey": settings.events_ticketmaster_api_key,
            "size": int(request.get("size") or 20),
            "sort": "date,asc",
            # Ticketmaster supports local date-time ranges; using them avoids
            # UTC date-boundary drift for events near midnight in venue timezones.
            "localStartDateTime": (
                f"{requested_start.isoformat()}T00:00:00,"
                f"{requested_end.isoformat()}T23:59:59"
            ),
        }
        location_text = request.get("location_text")
        if city := _city_hint(location_text):
            params["city"] = city
        if request.get("keyword"):
            params["keyword"] = request["keyword"]
        if request.get("segment"):
            params["segmentName"] = request["segment"]

        headers = {
            "Accept": "application/json",
            "User-Agent": settings.media_user_agent,
        }
        try:
            async with httpx.AsyncClient(
                base_url=self._base_url(),
                timeout=float(settings.events_ticketmaster_timeout_sec),
                headers=headers,
            ) as client:
                response = await client.get("/events.json", params=params)
        except httpx.TimeoutException as exc:
            raise EventProviderRetryableError(
                "UPSTREAM_PROVIDER_TIMEOUT",
                "Ticketmaster request timed out",
                {"provider": self.name},
            ) from exc
        except httpx.HTTPError as exc:
            raise EventProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Ticketmaster request failed",
                {"provider": self.name, "error": str(exc)},
            ) from exc

        if response.status_code == 429:
            raise EventProviderLimitedError(
                "PROVIDER_LIMITED",
                "Ticketmaster rate limit reached",
                _http_error_details(response),
            )
        if response.status_code >= 500:
            raise EventProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Ticketmaster upstream error",
                _http_error_details(response),
            )
        if response.status_code >= 400:
            raise EventProviderNonRetryableError(
                "UPSTREAM_PROVIDER_BAD_REQUEST",
                "Ticketmaster request rejected",
                _http_error_details(response),
            )

        payload = response.json()
        embedded = payload.get("_embedded") if isinstance(payload, dict) else None
        events = embedded.get("events") if isinstance(embedded, dict) else []
        if not isinstance(events, list):
            return []

        normalized: list[dict[str, Any]] = []
        for event in events:
            if not isinstance(event, dict) or not event.get("id") or not event.get("name"):
                continue
            embedded_event = event.get("_embedded") if isinstance(event.get("_embedded"), dict) else {}
            venues = embedded_event.get("venues") if isinstance(embedded_event.get("venues"), list) else []
            venue = venues[0] if venues and isinstance(venues[0], dict) else {}
            classifications = (
                event.get("classifications")
                if isinstance(event.get("classifications"), list)
                else []
            )
            classification = classifications[0] if classifications and isinstance(classifications[0], dict) else {}
            dates = event.get("dates") if isinstance(event.get("dates"), dict) else {}
            start = dates.get("start") if isinstance(dates.get("start"), dict) else {}
            price_ranges = (
                event.get("priceRanges") if isinstance(event.get("priceRanges"), list) else []
            )
            price_range = price_ranges[0] if price_ranges and isinstance(price_ranges[0], dict) else {}
            venue_location = venue.get("location") if isinstance(venue.get("location"), dict) else {}
            start_at = _to_datetime(start.get("dateTime"))
            timezone_name = dates.get("timezone")
            local_date = _resolve_local_event_date(
                local_date_value=start.get("localDate"),
                start_at=start_at,
                timezone_name=timezone_name,
            )
            if local_date is not None and not (requested_start <= local_date <= requested_end):
                continue

            normalized.append(
                {
                    "provider": self.name,
                    "provider_event_ref": str(event["id"]),
                    "title": str(event["name"])[:255],
                    "summary": event.get("pleaseNote")
                    or event.get("info")
                    or event.get("description"),
                    "start_at": start_at,
                    "local_date": local_date,
                    "end_at": None,
                    "timezone": timezone_name,
                    "venue_name": venue.get("name"),
                    "venue_address": _venue_address(venue),
                    "venue_external_id": venue.get("id"),
                    "venue_lat": (
                        float(venue_location["latitude"])
                        if venue_location.get("latitude") is not None
                        else None
                    ),
                    "venue_lon": (
                        float(venue_location["longitude"])
                        if venue_location.get("longitude") is not None
                        else None
                    ),
                    "segment": (
                        classification.get("segment", {}).get("name")
                        if isinstance(classification.get("segment"), dict)
                        else None
                    ),
                    "genre": (
                        classification.get("genre", {}).get("name")
                        if isinstance(classification.get("genre"), dict)
                        else None
                    ),
                    "min_price": _to_decimal(price_range.get("min")),
                    "max_price": _to_decimal(price_range.get("max")),
                    "currency": price_range.get("currency"),
                    "image_url": _pick_image_url(event.get("images")),
                    "deep_link": event.get("url"),
                    "sales_status": (
                        dates.get("status", {}).get("code")
                        if isinstance(dates.get("status"), dict)
                        else None
                    ),
                    "raw_payload_json": event,
                    "expires_at": datetime.now(UTC) + timedelta(hours=12),
                }
            )
        return normalized


_PROVIDERS: dict[str, EventProvider] = {
    "ticketmaster": TicketmasterEventProvider(),
}


def resolve_provider_order(requested: list[str] | None) -> list[str]:
    if requested:
        return [item for item in requested if item]
    return ["ticketmaster"]


def resolve_provider_availability(requested: list[str] | None) -> ProviderAvailability:
    settings = get_settings()
    configured: list[str] = []
    unavailable: list[dict[str, Any]] = []
    for name in resolve_provider_order(requested):
        provider = _PROVIDERS.get(name)
        if provider is None:
            unavailable.append(
                {
                    "provider": name,
                    "code": "PROVIDER_NOT_SUPPORTED",
                    "message": "Unsupported event provider",
                    "details": {"provider": name},
                }
            )
            continue
        available_values = {
            "VOYAGER_EVENTS_TICKETMASTER_API_KEY": settings.events_ticketmaster_api_key,
        }
        missing = [env_name for env_name in provider.required_env_vars if not available_values.get(env_name)]
        if missing:
            unavailable.append(
                {
                    "provider": name,
                    "code": "INTEGRATION_NOT_CONFIGURED",
                    "message": "Provider credentials are missing",
                    "details": {"missing_env_vars": missing},
                }
            )
            continue
        configured.append(name)
    return ProviderAvailability(configured=configured, unavailable=unavailable)


def get_provider(name: str) -> EventProvider:
    provider = _PROVIDERS.get(name)
    if provider is None:
        raise EventProviderNonRetryableError(
            "PROVIDER_NOT_SUPPORTED",
            "Unsupported event provider",
            {"provider": name},
        )
    return provider
