from __future__ import annotations

import asyncio
import hashlib
import re
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Protocol

import httpx

from app.config import get_settings
from app.models.offers import OfferKind


class OfferProviderError(Exception):
    def __init__(self, code: str, message: str, details: dict | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


class OfferProviderLimitedError(OfferProviderError):
    pass


class OfferProviderRetryableError(OfferProviderError):
    pass


class OfferProviderNonRetryableError(OfferProviderError):
    pass


class OfferProvider(Protocol):
    name: str
    required_env_vars: tuple[str, ...]

    async def search(self, request: dict[str, Any]) -> list[dict[str, Any]]: ...

    async def price_check(self, candidate: dict[str, Any]) -> dict[str, Any]: ...

    async def refresh(
        self,
        existing_snapshot: dict[str, Any],
        constraints: dict[str, Any],
    ) -> dict[str, Any]: ...


def _hash_int(seed: str, modulo: int) -> int:
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return int(digest[:10], 16) % modulo


def _money(seed: str, *, base: int, spread: int) -> Decimal:
    value = base + _hash_int(seed, spread)
    return Decimal(value).quantize(Decimal("0.01"))


def _to_utc_datetime(value: str | datetime | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)

    cleaned = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(cleaned)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _to_date(value: str | date | None) -> date | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _to_decimal(value: Any, *, default: Decimal = Decimal("0.00")) -> Decimal:
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError):
        return default


def _string_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    if isinstance(value, dict):
        for key in ("text", "name", "description", "category"):
            nested = value.get(key)
            if isinstance(nested, str) and nested.strip():
                return nested.strip()
            if isinstance(nested, dict):
                nested_text = _string_value(nested)
                if nested_text:
                    return nested_text
    text = str(value).strip()
    return text or None


def _truncate_text(value: Any, max_length: int) -> str | None:
    text = _string_value(value)
    if text is None:
        return None
    return text[:max_length]


def _to_int(value: Any) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _to_float(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


_ISO_DURATION_RE = re.compile(
    r"^P(?:(?P<days>\d+)D)?(?:T(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?)?$"
)


def _iso_duration_to_minutes(value: Any) -> int | None:
    if not isinstance(value, str):
        return None
    match = _ISO_DURATION_RE.match(value.strip().upper())
    if not match:
        return None
    days = int(match.group("days") or 0)
    hours = int(match.group("hours") or 0)
    minutes = int(match.group("minutes") or 0)
    return (days * 24 * 60) + (hours * 60) + minutes


def _join_non_empty(parts: list[str | None], *, sep: str = " · ") -> str | None:
    filtered = [part for part in parts if part]
    if not filtered:
        return None
    return sep.join(filtered)


def _http_error_details(response: httpx.Response) -> dict[str, Any]:
    details: dict[str, Any] = {"status_code": response.status_code}
    try:
        payload = response.json()
    except ValueError:
        payload = None

    if isinstance(payload, dict):
        errors = payload.get("errors")
        if isinstance(errors, list) and errors:
            first = errors[0]
            if isinstance(first, dict):
                details.update(
                    {
                        "provider_code": first.get("code"),
                        "title": first.get("title"),
                        "detail": first.get("detail") or first.get("message"),
                    }
                )
                return details
        for key in ("error", "message", "detail"):
            if key in payload:
                details[key] = payload[key]
                break
    details["response_text"] = response.text[:500]
    return details
class MockTransportProvider:
    name = "mock_transport"
    required_env_vars: tuple[str, ...] = ()

    async def search(self, request: dict[str, Any]) -> list[dict[str, Any]]:
        constraints = request.get("constraints") or {}
        if constraints.get("force_provider_limited") == self.name:
            raise OfferProviderLimitedError(
                "PROVIDER_LIMITED",
                "Mock transport provider throttled",
                {"provider": self.name},
            )
        if constraints.get("force_provider_failure") == self.name:
            raise OfferProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Mock transport provider temporary failure",
                {"provider": self.name},
            )

        modes_filter = {
            str(mode).lower()
            for mode in (request.get("transport_modes") or [])
            if isinstance(mode, str)
        }

        now = datetime.now(UTC)
        origin = request.get("origin_text") or "Origin"
        destination = request.get("destination_text") or "Destination"
        depart = str(request.get("depart_date") or now.date())
        currency = request.get("currency") or "EUR"

        mode_slots = ["flight"]
        offers: list[dict[str, Any]] = []
        for idx, mode in enumerate(mode_slots):
            if modes_filter and mode not in modes_filter:
                continue
            seed = f"{self.name}:{origin}:{destination}:{depart}:{mode}:{idx}"
            depart_at = datetime.combine(now.date(), datetime.min.time(), tzinfo=UTC) + timedelta(
                hours=7 + idx * 4
            )
            arrive_at = depart_at + timedelta(hours=2 + idx)
            offers.append(
                {
                    "provider": self.name,
                    "provider_offer_ref": f"mock-t-{_hash_int(seed, 10_000_000):07d}",
                    "title": f"Mock {mode} option {idx + 1}",
                    "transport_mode": mode,
                    "origin_text": origin,
                    "destination_text": destination,
                    "depart_at": depart_at,
                    "arrive_at": arrive_at,
                    "price_amount": _money(seed, base=89, spread=240),
                    "currency": currency,
                    "deep_link": f"https://example.mock/transport/{_hash_int(seed, 1_000_000)}",
                    "expires_at": now + timedelta(hours=2 + idx),
                    "raw_payload_json": {
                        "provider": self.name,
                        "seed": seed,
                        "mode": "deterministic",
                        "search_request": request,
                    },
                }
            )

        return offers

    async def price_check(self, candidate: dict[str, Any]) -> dict[str, Any]:
        return candidate

    async def refresh(
        self,
        existing_snapshot: dict[str, Any],
        constraints: dict[str, Any],
    ) -> dict[str, Any]:
        if constraints.get("force_expire"):
            return {
                "status": "expired",
                "reason": "forced_by_constraints",
            }

        ref = str(existing_snapshot.get("provider_offer_ref") or existing_snapshot.get("id"))
        seed = f"refresh:{self.name}:{ref}:{datetime.now(UTC).date()}"
        refreshed = dict(existing_snapshot)
        refreshed["price_amount"] = _money(seed, base=95, spread=210)
        refreshed["expires_at"] = datetime.now(UTC) + timedelta(hours=3)
        refreshed["raw_payload_json"] = {
            "provider": self.name,
            "refresh_seed": seed,
            "source_offer": ref,
        }
        return {
            "status": "refreshed",
            "offer": refreshed,
        }


class MockLodgingProvider:
    name = "mock_lodging"
    required_env_vars: tuple[str, ...] = ()

    async def search(self, request: dict[str, Any]) -> list[dict[str, Any]]:
        constraints = request.get("constraints") or {}
        if constraints.get("force_provider_limited") == self.name:
            raise OfferProviderLimitedError(
                "PROVIDER_LIMITED",
                "Mock lodging provider throttled",
                {"provider": self.name},
            )
        if constraints.get("force_provider_failure") == self.name:
            raise OfferProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Mock lodging provider temporary failure",
                {"provider": self.name},
            )

        types_filter = {
            str(value).lower()
            for value in (request.get("lodging_types") or [])
            if isinstance(value, str)
        }

        now = datetime.now(UTC)
        checkin = request.get("checkin_date")
        checkout = request.get("checkout_date")
        if isinstance(checkin, str):
            checkin = date.fromisoformat(checkin)
        if isinstance(checkout, str):
            checkout = date.fromisoformat(checkout)
        location = request.get("location_text") or "Destination"
        currency = request.get("currency") or "EUR"

        type_slots = ["hotel", "hotel", "hotel"]
        offers: list[dict[str, Any]] = []
        for idx, lodging_type in enumerate(type_slots):
            if types_filter and lodging_type not in types_filter:
                continue
            seed = f"{self.name}:{location}:{checkin}:{checkout}:{lodging_type}:{idx}"
            nights = max(int((checkout - checkin).days), 1)
            offers.append(
                {
                    "provider": self.name,
                    "provider_offer_ref": f"mock-l-{_hash_int(seed, 10_000_000):07d}",
                    "title": f"Mock {lodging_type} option {idx + 1}",
                    "lodging_type": lodging_type,
                    "location_text": location,
                    "room_type": "double",
                    "checkin_date": checkin,
                    "checkout_date": checkout,
                    "nights": nights,
                    "price_amount": _money(seed, base=120 * nights, spread=500),
                    "currency": currency,
                    "deep_link": f"https://example.mock/lodging/{_hash_int(seed, 1_000_000)}",
                    "expires_at": now + timedelta(hours=4 + idx),
                    "raw_payload_json": {
                        "provider": self.name,
                        "seed": seed,
                        "mode": "deterministic",
                        "search_request": request,
                    },
                }
            )

        return offers

    async def price_check(self, candidate: dict[str, Any]) -> dict[str, Any]:
        return candidate

    async def refresh(
        self,
        existing_snapshot: dict[str, Any],
        constraints: dict[str, Any],
    ) -> dict[str, Any]:
        if constraints.get("force_expire"):
            return {
                "status": "expired",
                "reason": "forced_by_constraints",
            }

        ref = str(existing_snapshot.get("provider_offer_ref") or existing_snapshot.get("id"))
        seed = f"refresh:{self.name}:{ref}:{datetime.now(UTC).date()}"
        refreshed = dict(existing_snapshot)
        refreshed["price_amount"] = _money(seed, base=140, spread=460)
        refreshed["expires_at"] = datetime.now(UTC) + timedelta(hours=5)
        refreshed["raw_payload_json"] = {
            "provider": self.name,
            "refresh_seed": seed,
            "source_offer": ref,
        }
        return {
            "status": "refreshed",
            "offer": refreshed,
        }


class _AmadeusOAuthClient:
    required_env_vars = (
        "VOYAGER_FLIGHTS_AMADEUS_CLIENT_ID",
        "VOYAGER_FLIGHTS_AMADEUS_CLIENT_SECRET",
    )

    def __init__(self, *, provider_name: str) -> None:
        self._provider_name = provider_name
        self._access_token: str | None = None
        self._access_token_expires_at: datetime = datetime.fromtimestamp(0, tz=UTC)
        self._token_lock = asyncio.Lock()

    @staticmethod
    def _base_url() -> str:
        settings = get_settings()
        raw = settings.flights_amadeus_base_url.strip()
        if raw.startswith("http://") or raw.startswith("https://"):
            return raw.rstrip("/")
        return f"https://{raw.rstrip('/')}"

    @staticmethod
    def _timeout_seconds() -> float:
        return float(get_settings().flights_amadeus_timeout_sec)

    async def _fetch_access_token(self) -> str:
        now = datetime.now(UTC)
        if self._access_token and self._access_token_expires_at > now + timedelta(seconds=30):
            return self._access_token

        async with self._token_lock:
            now = datetime.now(UTC)
            if self._access_token and self._access_token_expires_at > now + timedelta(seconds=30):
                return self._access_token

            settings = get_settings()
            form = {
                "grant_type": "client_credentials",
                "client_id": settings.flights_amadeus_client_id,
                "client_secret": settings.flights_amadeus_client_secret,
            }
            try:
                async with httpx.AsyncClient(
                    base_url=self._base_url(),
                    timeout=self._timeout_seconds(),
                ) as client:
                    response = await client.post(
                        "/v1/security/oauth2/token",
                        data=form,
                        headers={"Content-Type": "application/x-www-form-urlencoded"},
                    )
            except httpx.TimeoutException as exc:
                raise OfferProviderRetryableError(
                    "UPSTREAM_PROVIDER_TIMEOUT",
                    "Amadeus token request timed out",
                    {"provider": self._provider_name},
                ) from exc
            except httpx.HTTPError as exc:
                raise OfferProviderRetryableError(
                    "UPSTREAM_PROVIDER_ERROR",
                    "Amadeus token request failed",
                    {"provider": self._provider_name, "error": str(exc)},
                ) from exc

            if response.status_code == 429:
                raise OfferProviderLimitedError(
                    "PROVIDER_LIMITED",
                    "Amadeus token endpoint rate-limited",
                    _http_error_details(response),
                )
            if response.status_code >= 500:
                raise OfferProviderRetryableError(
                    "UPSTREAM_PROVIDER_ERROR",
                    "Amadeus token endpoint unavailable",
                    _http_error_details(response),
                )
            if response.status_code >= 400:
                raise OfferProviderNonRetryableError(
                    "UPSTREAM_PROVIDER_AUTH_ERROR",
                    "Amadeus credentials rejected",
                    _http_error_details(response),
                )

            payload = response.json()
            token = payload.get("access_token")
            expires_in = int(payload.get("expires_in") or 1800)
            if not isinstance(token, str) or not token:
                raise OfferProviderRetryableError(
                    "UPSTREAM_PROVIDER_ERROR",
                    "Amadeus token response missing access_token",
                    {"provider": self._provider_name},
                )

            self._access_token = token
            self._access_token_expires_at = datetime.now(UTC) + timedelta(
                seconds=max(expires_in - 30, 60)
            )
            return token

    async def _authorized_request(
        self,
        *,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        retry_on_unauthorized: bool = True,
    ) -> httpx.Response:
        token = await self._fetch_access_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        if json_body is not None:
            headers["Content-Type"] = "application/json"

        try:
            async with httpx.AsyncClient(
                base_url=self._base_url(),
                timeout=self._timeout_seconds(),
            ) as client:
                response = await client.request(
                    method=method,
                    url=path,
                    params=params,
                    json=json_body,
                    headers=headers,
                )
        except httpx.TimeoutException as exc:
            raise OfferProviderRetryableError(
                "UPSTREAM_PROVIDER_TIMEOUT",
                "Amadeus request timed out",
                {"provider": self._provider_name, "path": path},
            ) from exc
        except httpx.HTTPError as exc:
            raise OfferProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus request failed",
                {"provider": self._provider_name, "path": path, "error": str(exc)},
            ) from exc

        if response.status_code == 401 and retry_on_unauthorized:
            self._access_token = None
            self._access_token_expires_at = datetime.fromtimestamp(0, tz=UTC)
            return await self._authorized_request(
                method=method,
                path=path,
                params=params,
                json_body=json_body,
                retry_on_unauthorized=False,
            )

        return response


class AmadeusTransportProvider(_AmadeusOAuthClient):
    name = "amadeus_transport"

    _iata_code_re = re.compile(r"^[A-Za-z]{3}$")

    def __init__(self) -> None:
        super().__init__(provider_name=self.name)

    async def _resolve_iata_code(self, value: Any, *, field: str) -> tuple[str, dict[str, float] | None]:
        if not isinstance(value, str) or not value.strip():
            raise OfferProviderNonRetryableError(
                "VALIDATION_ERROR",
                f"{field} is required for amadeus_transport",
            )
        raw_value = value.strip()
        is_iata = bool(self._iata_code_re.match(raw_value.upper()))
        
        if len(raw_value) < 3:
            raise OfferProviderNonRetryableError(
                "VALIDATION_ERROR",
                f"{field} must be at least 3 characters when not using an IATA code",
            )

        response = await self._authorized_request(
            method="GET",
            path="/v1/reference-data/locations",
            params={"keyword": raw_value[:20], "subType": "CITY,AIRPORT", "page[limit]": 5},
        )

        if response.status_code == 429:
            raise OfferProviderLimitedError(
                "PROVIDER_LIMITED",
                "Amadeus location lookup rate-limited",
                _http_error_details(response),
            )
        if response.status_code >= 500:
            raise OfferProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus location lookup unavailable",
                _http_error_details(response),
            )
        if response.status_code >= 400:
            raise OfferProviderNonRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus location lookup rejected the request",
                _http_error_details(response),
            )

        payload = response.json()
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, list):
            raise OfferProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus location lookup response missing data list",
                {"provider": self.name},
            )

        lowered = raw_value.casefold()
        preferred_code: str | None = None
        preferred_geo: dict[str, float] | None = None
        fallback_code: str | None = None
        fallback_geo: dict[str, float] | None = None
        
        for item in data:
            if not isinstance(item, dict):
                continue
            iata_code = item.get("iataCode")
            if not isinstance(iata_code, str) or not self._iata_code_re.match(iata_code):
                continue
                
            geo = item.get("geoCode")
            if isinstance(geo, dict) and "latitude" in geo and "longitude" in geo:
                geo_dict = {"latitude": float(geo["latitude"]), "longitude": float(geo["longitude"])}
            else:
                geo_dict = None
                
            if fallback_code is None:
                fallback_code = iata_code.upper()
                fallback_geo = geo_dict
                
            name = item.get("name")
            if is_iata and iata_code.upper() == raw_value.upper():
                preferred_code = iata_code.upper()
                preferred_geo = geo_dict
                break
            elif isinstance(name, str) and name.casefold() == lowered:
                preferred_code = iata_code.upper()
                preferred_geo = geo_dict
                break

        resolved = preferred_code or fallback_code
        resolved_geo = preferred_geo or fallback_geo
        
        if resolved is None:
            if is_iata:
                return raw_value.upper(), None
            raise OfferProviderNonRetryableError(
                "VALIDATION_ERROR",
                f"{field} could not be resolved to an Amadeus location code",
                {"field": field, "value": value},
            )
        return resolved, resolved_geo

    @staticmethod
    def _date_string(value: Any, *, field: str) -> str:
        if isinstance(value, date):
            return value.isoformat()
        if isinstance(value, str):
            try:
                return date.fromisoformat(value).isoformat()
            except ValueError as exc:
                raise OfferProviderNonRetryableError(
                    "VALIDATION_ERROR", f"{field} must be ISO date (YYYY-MM-DD)"
                ) from exc
        raise OfferProviderNonRetryableError(
            "VALIDATION_ERROR", f"{field} must be ISO date (YYYY-MM-DD)"
        )

    @staticmethod
    def _offer_expiry(offer: dict[str, Any]) -> datetime:
        last_ticketing_datetime = offer.get("lastTicketingDateTime")
        parsed_datetime = _to_utc_datetime(last_ticketing_datetime)
        if parsed_datetime is not None:
            return parsed_datetime

        last_ticketing_date = offer.get("lastTicketingDate")
        if isinstance(last_ticketing_date, str):
            try:
                parsed_date = date.fromisoformat(last_ticketing_date)
                return datetime.combine(parsed_date, datetime.max.time(), tzinfo=UTC)
            except ValueError:
                pass

        return datetime.now(UTC) + timedelta(hours=6)

    def _normalize_offer(
        self,
        *,
        offer: dict[str, Any],
        dictionaries: dict[str, Any],
        origin_iata: str,
        destination_iata: str,
        origin_geo: dict[str, float] | None = None,
        destination_geo: dict[str, float] | None = None,
    ) -> dict[str, Any]:
        itineraries = offer.get("itineraries") if isinstance(offer.get("itineraries"), list) else []
        carriers_map = dictionaries.get("carriers", {}) if isinstance(dictionaries.get("carriers"), dict) else {}
        traveler_pricings = (
            offer.get("travelerPricings") if isinstance(offer.get("travelerPricings"), list) else []
        )
        fare_by_segment: dict[str, dict[str, Any]] = {}
        for traveler in traveler_pricings:
            if not isinstance(traveler, dict):
                continue
            fare_details = (
                traveler.get("fareDetailsBySegment")
                if isinstance(traveler.get("fareDetailsBySegment"), list)
                else []
            )
            for detail in fare_details:
                if not isinstance(detail, dict):
                    continue
                segment_id = detail.get("segmentId")
                if isinstance(segment_id, str) and segment_id not in fare_by_segment:
                    fare_by_segment[segment_id] = detail

        first_segment: dict[str, Any] = {}
        last_segment: dict[str, Any] = {}
        if itineraries:
            first = itineraries[0]
            last = itineraries[-1]
            first_segments = first.get("segments") if isinstance(first, dict) else None
            last_segments = last.get("segments") if isinstance(last, dict) else None
            if isinstance(first_segments, list) and first_segments:
                first_segment = first_segments[0]
            if isinstance(last_segments, list) and last_segments:
                last_segment = last_segments[-1]

        departure = first_segment.get("departure") if isinstance(first_segment, dict) else None
        arrival = last_segment.get("arrival") if isinstance(last_segment, dict) else None
        depart_at = _to_utc_datetime(departure.get("at") if isinstance(departure, dict) else None)
        arrive_at = _to_utc_datetime(arrival.get("at") if isinstance(arrival, dict) else None)

        price = offer.get("price") if isinstance(offer.get("price"), dict) else {}
        currency = str(price.get("currency") or "EUR").upper()
        price_amount = _to_decimal(price.get("grandTotal") or price.get("total"))

        carrier_code = first_segment.get("carrierCode") if isinstance(first_segment, dict) else None
        airline_name = carrier_code
        if carrier_code in carriers_map:
            airline_name = carriers_map[carrier_code]

        flight_number = first_segment.get("number") if isinstance(first_segment, dict) else None

        parsed_segments: list[dict[str, Any]] = []
        layovers: list[dict[str, Any]] = []
        emissions_total = Decimal("0.00")
        has_emissions = False
        total_duration_min = 0
        stops = 0
        baggage_summaries: list[str] = []
        cabins: list[str] = []

        for itinerary_index, itinerary in enumerate(itineraries):
            if not isinstance(itinerary, dict):
                continue
            itinerary_duration_min = _iso_duration_to_minutes(itinerary.get("duration"))
            if itinerary_duration_min is not None:
                total_duration_min += itinerary_duration_min

            itinerary_segments = (
                itinerary.get("segments") if isinstance(itinerary.get("segments"), list) else []
            )
            stops += max(len(itinerary_segments) - 1, 0)

            for seg_index, segment in enumerate(itinerary_segments):
                if not isinstance(segment, dict):
                    continue
                segment_id = _string_value(segment.get("id"))
                fare_detail = fare_by_segment.get(segment_id or "", {})
                departure_data = (
                    segment.get("departure") if isinstance(segment.get("departure"), dict) else {}
                )
                arrival_data = (
                    segment.get("arrival") if isinstance(segment.get("arrival"), dict) else {}
                )
                seg_carrier = segment.get("carrierCode")
                op_carrier = (
                    segment.get("operating", {}).get("carrierCode", seg_carrier)
                    if isinstance(segment.get("operating"), dict)
                    else seg_carrier
                )
                cabin = _string_value(fare_detail.get("cabin"))
                if cabin:
                    cabins.append(cabin)

                included_bags = (
                    fare_detail.get("includedCheckedBags")
                    if isinstance(fare_detail.get("includedCheckedBags"), dict)
                    else {}
                )
                baggage_parts: list[str] = []
                quantity = _to_int(included_bags.get("quantity"))
                weight = _to_int(included_bags.get("weight"))
                weight_unit = _string_value(included_bags.get("weightUnit"))
                if quantity is not None:
                    baggage_parts.append(
                        f"{quantity} checked bag{'s' if quantity != 1 else ''}"
                    )
                elif weight is not None:
                    baggage_parts.append(
                        f"{weight}{weight_unit or 'KG'} checked baggage"
                    )
                baggage_summary = _join_non_empty(baggage_parts)
                if baggage_summary:
                    baggage_summaries.append(baggage_summary)

                co2_entries = (
                    segment.get("co2Emissions") if isinstance(segment.get("co2Emissions"), list) else []
                )
                for entry in co2_entries:
                    if not isinstance(entry, dict):
                        continue
                    emission = _to_decimal(entry.get("weight"))
                    if emission is not None:
                        emissions_total += emission
                        has_emissions = True

                parsed_segments.append(
                    {
                        "itineraryIndex": itinerary_index,
                        "sequence": seg_index + 1,
                        "departure": departure_data,
                        "arrival": arrival_data,
                        "carrierCode": seg_carrier,
                        "operatingCarrierCode": op_carrier,
                        "flightNumber": segment.get("number"),
                        "duration": segment.get("duration"),
                        "durationMin": _iso_duration_to_minutes(segment.get("duration")),
                        "airlineName": carriers_map.get(seg_carrier, seg_carrier),
                        "operatingAirlineName": carriers_map.get(op_carrier, op_carrier),
                        "cabin": cabin,
                        "fareBasis": _string_value(fare_detail.get("fareBasis")),
                        "brandedFare": _string_value(fare_detail.get("brandedFare")),
                        "baggageSummary": baggage_summary,
                    }
                )

                if seg_index < len(itinerary_segments) - 1:
                    next_segment = itinerary_segments[seg_index + 1]
                    if isinstance(next_segment, dict):
                        next_departure = (
                            next_segment.get("departure")
                            if isinstance(next_segment.get("departure"), dict)
                            else {}
                        )
                        current_arrive_at = _to_utc_datetime(arrival_data.get("at"))
                        next_depart_at = _to_utc_datetime(next_departure.get("at"))
                        layovers.append(
                            {
                                "itineraryIndex": itinerary_index,
                                "airportCode": arrival_data.get("iataCode"),
                                "durationMin": (
                                    int((next_depart_at - current_arrive_at).total_seconds() // 60)
                                    if current_arrive_at and next_depart_at and next_depart_at > current_arrive_at
                                    else None
                                ),
                            }
                        )

        total_duration = total_duration_min or None
        additional_services = (
            price.get("additionalServices") if isinstance(price.get("additionalServices"), dict) else {}
        )
        additional_baggage_value = additional_services.get("chargeableCheckedBags")
        additional_baggage_price = None
        additional_baggage_currency = None
        if isinstance(additional_baggage_value, dict):
            additional_baggage_price = _to_decimal(
                additional_baggage_value.get("amount") or additional_baggage_value.get("price")
            )
            additional_baggage_currency = _string_value(
                additional_baggage_value.get("currencyCode") or additional_baggage_value.get("currency")
            )
        else:
            additional_baggage_price = _to_decimal(additional_baggage_value, default=Decimal("0.00"))
            if additional_baggage_price != Decimal("0.00"):
                additional_baggage_currency = currency
            else:
                additional_baggage_price = None

        baggage_summary = _join_non_empty(sorted(set(baggage_summaries)))
        cabin_summary = _join_non_empty([_string_value(_string_value(item).title()) for item in cabins], sep=", ")
        validating_airline_codes = [
            item
            for item in (offer.get("validatingAirlineCodes") if isinstance(offer.get("validatingAirlineCodes"), list) else [])
            if isinstance(item, str)
        ]
        bookable_seats = _to_int(offer.get("numberOfBookableSeats"))

        title = f"{airline_name or carrier_code or 'Amadeus'} Flight"
        if flight_number:
            title += f" {flight_number}"
        if stops > 0:
            title += f" ({stops} stop{'s' if stops > 1 else ''})"
        else:
            title += " (Nonstop)"

        links = offer.get("links") if isinstance(offer.get("links"), dict) else {}
        deep_link = links.get("flightOffers") if isinstance(links.get("flightOffers"), str) else None
        
        if not deep_link and depart_at:
            depart_date_str = depart_at.strftime('%Y-%m-%d')
            deep_link = f"https://www.google.com/travel/flights?q=Flights%20to%20{destination_iata}%20from%20{origin_iata}%20on%20{depart_date_str}"

        return {
            "provider": self.name,
            "provider_offer_ref": str(offer.get("id") or _hash_int(title, 10_000_000)),
            "title": title,
            "transport_mode": "flight",
            "origin_text": origin_iata,
            "destination_text": destination_iata,
            "depart_at": depart_at,
            "arrive_at": arrive_at,
            "price_amount": price_amount,
            "currency": currency,
            "deep_link": deep_link,
            "expires_at": self._offer_expiry(offer),
            "raw_payload_json": {
                "provider": self.name,
                "offer": offer,
                "dictionaries": {
                    "carriers": (
                        dictionaries.get("carriers")
                        if isinstance(dictionaries.get("carriers"), dict)
                        else {}
                    )
                },
                "origin_geo": origin_geo,
                "destination_geo": destination_geo,
                "segments": parsed_segments,
                "layovers": layovers,
                "stops_count": stops,
                "total_duration_min": total_duration,
                "cabin": cabin_summary,
                "baggage_summary": baggage_summary,
                "validating_airline_codes": validating_airline_codes,
                "bookable_seats": bookable_seats,
                "additional_baggage_price": additional_baggage_price,
                "additional_baggage_currency": additional_baggage_currency,
                "emissions_kg": emissions_total if has_emissions else None,
                "emissions_description": "Estimated CO2 emissions" if has_emissions else None,
            },
        }

    async def search(self, request: dict[str, Any]) -> list[dict[str, Any]]:
        constraints = request.get("constraints") or {}
        if constraints.get("force_provider_limited") == self.name:
            raise OfferProviderLimitedError(
                "PROVIDER_LIMITED",
                "Amadeus provider throttled by constraints",
                {"provider": self.name},
            )
        if constraints.get("force_provider_failure") == self.name:
            raise OfferProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus provider transient failure injected",
                {"provider": self.name},
            )

        modes_filter = {
            str(mode).lower()
            for mode in (request.get("transport_modes") or [])
            if isinstance(mode, str)
        }
        if modes_filter and "flight" not in modes_filter:
            return []

        origin, origin_geo = await self._resolve_iata_code(request.get("origin_text"), field="origin_text")
        destination, destination_geo = await self._resolve_iata_code(request.get("destination_text"), field="destination_text")
        departure_date = self._date_string(request.get("depart_date"), field="depart_date")
        return_date_raw = request.get("return_date")
        return_date = None
        if return_date_raw is not None:
            return_date = self._date_string(return_date_raw, field="return_date")

        adults_raw = request.get("adults", 1)
        try:
            adults = int(adults_raw)
        except (TypeError, ValueError) as exc:
            raise OfferProviderNonRetryableError(
                "VALIDATION_ERROR", "adults must be an integer"
            ) from exc
        if adults < 1 or adults > 9:
            raise OfferProviderNonRetryableError(
                "VALIDATION_ERROR", "adults must be in range [1, 9]"
            )

        params: dict[str, Any] = {
            "originLocationCode": origin,
            "destinationLocationCode": destination,
            "departureDate": departure_date,
            "adults": adults,
            "max": 10,
        }
        if return_date:
            params["returnDate"] = return_date

        currency = request.get("currency")
        if isinstance(currency, str) and len(currency.strip()) == 3:
            params["currencyCode"] = currency.strip().upper()

        response = await self._authorized_request(
            method="GET",
            path="/v2/shopping/flight-offers",
            params=params,
        )

        if response.status_code == 429:
            raise OfferProviderLimitedError(
                "PROVIDER_LIMITED",
                "Amadeus flight search rate-limited",
                _http_error_details(response),
            )
        if response.status_code >= 500:
            raise OfferProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus flight search unavailable",
                _http_error_details(response),
            )
        if response.status_code >= 400:
            raise OfferProviderNonRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus flight search rejected the request",
                _http_error_details(response),
            )

        payload = response.json()
        if not isinstance(payload, dict):
            raise OfferProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus response is not a JSON object",
                {"provider": self.name},
            )

        data = payload.get("data")
        if not isinstance(data, list):
            raise OfferProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus response missing data list",
                {"provider": self.name},
            )

        dictionaries = payload.get("dictionaries") if isinstance(payload.get("dictionaries"), dict) else {}
        return [
            self._normalize_offer(
                offer=item,
                dictionaries=dictionaries,
                origin_iata=origin,
                destination_iata=destination,
                origin_geo=origin_geo,
                destination_geo=destination_geo,
            )
            for item in data
            if isinstance(item, dict)
        ]

    async def price_check(self, candidate: dict[str, Any]) -> dict[str, Any]:
        return candidate

    async def refresh(
        self,
        existing_snapshot: dict[str, Any],
        constraints: dict[str, Any],
    ) -> dict[str, Any]:
        if constraints.get("force_expire"):
            return {"status": "expired", "reason": "forced_by_constraints"}

        raw_payload = existing_snapshot.get("raw_payload_json")
        original_offer: dict[str, Any] | None = None
        if isinstance(raw_payload, dict) and isinstance(raw_payload.get("offer"), dict):
            original_offer = raw_payload["offer"]

        if not original_offer:
            existing_expiry = _to_utc_datetime(existing_snapshot.get("expires_at"))
            if existing_expiry and existing_expiry <= datetime.now(UTC):
                return {"status": "expired", "reason": "snapshot_expired"}
            raise OfferProviderNonRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Cannot refresh offer without stored provider offer payload",
            )

        pricing_body = {
            "data": {
                "type": "flight-offers-pricing",
                "flightOffers": [original_offer],
            }
        }
        response = await self._authorized_request(
            method="POST",
            path="/v1/shopping/flight-offers/pricing",
            json_body=pricing_body,
        )

        if response.status_code == 429:
            raise OfferProviderLimitedError(
                "PROVIDER_LIMITED",
                "Amadeus pricing endpoint rate-limited",
                _http_error_details(response),
            )
        if response.status_code in {400, 404, 410, 422}:
            return {
                "status": "expired",
                "reason": "offer_no_longer_pricable",
                "details": _http_error_details(response),
            }
        if response.status_code >= 500:
            raise OfferProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus pricing endpoint unavailable",
                _http_error_details(response),
            )
        if response.status_code >= 400:
            raise OfferProviderNonRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus pricing request rejected",
                _http_error_details(response),
            )

        payload = response.json()
        if not isinstance(payload, dict):
            raise OfferProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus pricing response is not a JSON object",
                {"provider": self.name},
            )

        data = payload.get("data")
        if not isinstance(data, dict):
            return {"status": "expired", "reason": "missing_pricing_data"}

        flight_offers = data.get("flightOffers")
        if not isinstance(flight_offers, list) or not flight_offers:
            return {"status": "expired", "reason": "no_priced_offer_returned"}

        refreshed_offer = flight_offers[0]
        dictionaries = payload.get("dictionaries") if isinstance(payload.get("dictionaries"), dict) else {}
        origin_iata, origin_geo = await self._resolve_iata_code(existing_snapshot.get("origin_text"), field="origin_text")
        destination_iata, destination_geo = await self._resolve_iata_code(existing_snapshot.get("destination_text"), field="destination_text")
        normalized = self._normalize_offer(
            offer=refreshed_offer,
            dictionaries=dictionaries,
            origin_iata=origin_iata,
            destination_iata=destination_iata,
            origin_geo=origin_geo,
            destination_geo=destination_geo,
        )

        return {"status": "refreshed", "offer": normalized}


class AmadeusLodgingProvider(_AmadeusOAuthClient):
    name = "amadeus_lodging"

    _iata_code_re = re.compile(r"^[A-Za-z]{3}$")

    def __init__(self) -> None:
        super().__init__(provider_name=self.name)

    async def _city_code(self, value: Any) -> str:
        if not isinstance(value, str) or not value.strip():
            raise OfferProviderNonRetryableError(
                "VALIDATION_ERROR", "location_text is required for amadeus_lodging"
            )
        raw_value = value.strip()
        normalized = raw_value.upper()
        if self._iata_code_re.match(normalized):
            return normalized

        if len(raw_value) < 3:
            raise OfferProviderNonRetryableError(
                "VALIDATION_ERROR",
                "location_text must be at least 3 characters when not using an IATA city code",
            )

        response = await self._authorized_request(
            method="GET",
            path="/v1/reference-data/locations/cities",
            params={"keyword": raw_value[:10], "max": 5},
        )

        if response.status_code == 429:
            raise OfferProviderLimitedError(
                "PROVIDER_LIMITED",
                "Amadeus city lookup rate-limited",
                _http_error_details(response),
            )
        if response.status_code >= 500:
            raise OfferProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus city lookup unavailable",
                _http_error_details(response),
            )
        if response.status_code >= 400:
            raise OfferProviderNonRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus city lookup rejected the request",
                _http_error_details(response),
            )

        payload = response.json()
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, list):
            raise OfferProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus city lookup response missing data list",
                {"provider": self.name},
            )

        lowered = raw_value.casefold()
        preferred_code: str | None = None
        fallback_code: str | None = None
        for item in data:
            if not isinstance(item, dict):
                continue
            iata_code = item.get("iataCode")
            if not isinstance(iata_code, str) or not self._iata_code_re.match(iata_code):
                continue
            if fallback_code is None:
                fallback_code = iata_code.upper()
            name = item.get("name")
            if isinstance(name, str) and name.casefold() == lowered:
                preferred_code = iata_code.upper()
                break

        resolved = preferred_code or fallback_code
        if resolved is None:
            raise OfferProviderNonRetryableError(
                "VALIDATION_ERROR",
                "location_text could not be resolved to an Amadeus city code",
                {"field": "location_text", "value": value},
            )
        return resolved

    async def _hotels_for_city(self, city_code: str) -> list[dict[str, Any]]:
        response = await self._authorized_request(
            method="GET",
            path="/v1/reference-data/locations/hotels/by-city",
            params={
                "cityCode": city_code,
                "radius": 20,
                "radiusUnit": "KM",
                "hotelSource": "ALL",
            },
        )

        if response.status_code == 429:
            raise OfferProviderLimitedError(
                "PROVIDER_LIMITED",
                "Amadeus hotel list rate-limited",
                _http_error_details(response),
            )
        if response.status_code >= 500:
            raise OfferProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus hotel list unavailable",
                _http_error_details(response),
            )
        if response.status_code >= 400:
            raise OfferProviderNonRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus hotel list rejected the request",
                _http_error_details(response),
            )

        payload = response.json()
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, list):
            raise OfferProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus hotel list response missing data list",
                {"provider": self.name},
            )

        hotels: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in data:
            if not isinstance(item, dict):
                continue
            hotel_id = item.get("hotelId")
            if not isinstance(hotel_id, str):
                hotel = item.get("hotel") if isinstance(item.get("hotel"), dict) else {}
                hotel_id = hotel.get("hotelId")
            if not isinstance(hotel_id, str) or not hotel_id.strip():
                continue
            hotel_id = hotel_id.strip()
            if hotel_id in seen:
                continue
            seen.add(hotel_id)
            hotel = item.get("hotel") if isinstance(item.get("hotel"), dict) else {}
            normalized_hotel = dict(hotel)
            normalized_hotel.setdefault("hotelId", hotel_id)
            for field in ("name", "address", "geoCode", "chainCode", "rating", "amenities", "distance"):
                if field in item and field not in normalized_hotel:
                    normalized_hotel[field] = item[field]
            hotels.append(normalized_hotel)
            if len(hotels) >= 10:
                break

        return hotels

    async def _ratings_for_hotels(self, hotel_ids: list[str]) -> dict[str, dict[str, Any]]:
        if not hotel_ids:
            return {}

        response = await self._authorized_request(
            method="GET",
            path="/v2/e-reputation/hotel-sentiments",
            params={"hotelIds": ",".join(hotel_ids[:20])},
        )

        if response.status_code >= 400:
            raise OfferProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus hotel ratings unavailable",
                _http_error_details(response),
            )

        payload = response.json()
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, list):
            return {}

        ratings: dict[str, dict[str, Any]] = {}
        for item in data:
            if not isinstance(item, dict):
                continue
            hotel_id = _string_value(item.get("hotelId") or item.get("hotel_id"))
            if not hotel_id:
                continue
            ratings[hotel_id] = item
        return ratings

    @staticmethod
    def _normalize_offer(
        request: dict[str, Any],
        *,
        hotel: dict[str, Any],
        offer: dict[str, Any],
        rating: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        price = offer.get("price") if isinstance(offer.get("price"), dict) else {}
        room = offer.get("room") if isinstance(offer.get("room"), dict) else {}
        type_estimated = room.get("typeEstimated") if isinstance(room.get("typeEstimated"), dict) else {}
        room_description = (
            offer.get("roomDescription")
            if isinstance(offer.get("roomDescription"), dict)
            else {}
        )
        checkin = _to_date(offer.get("checkInDate") or request.get("checkin_date"))
        checkout = _to_date(offer.get("checkOutDate") or request.get("checkout_date"))
        nights = int((checkout - checkin).days) if checkin and checkout else None

        hotel_name = hotel.get("name") if isinstance(hotel.get("name"), str) else "Amadeus Hotel"
        hotel_id = _string_value(hotel.get("hotelId"))
        geo_code = hotel.get("geoCode") if isinstance(hotel.get("geoCode"), dict) else {}
        address = hotel.get("address") if isinstance(hotel.get("address"), dict) else {}
        address_lines = address.get("lines") if isinstance(address.get("lines"), list) else []
        address_text = ", ".join(
            [line.strip() for line in address_lines if isinstance(line, str) and line.strip()]
        )
        if not address_text:
            address_text = _string_value(address.get("label"))
        room_label = (
            type_estimated.get("category")
            or room.get("description")
            or room_description.get("name")
            or room_description.get("text")
        )
        deep_link = None
        if isinstance(offer.get("self"), str) and str(offer.get("self")).startswith("http"):
            deep_link = offer.get("self")
        if deep_link is None:
            query = "+".join(part for part in [hotel_name, request.get("location_text")] if isinstance(part, str))
            deep_link = f"https://www.google.com/travel/hotels?q={query}" if query else None

        room_description_text = _string_value(room_description.get("text") or room_description.get("name"))
        title = _truncate_text(hotel_name, 255) or "Amadeus Hotel"
        price_variations = price.get("variations") if isinstance(price.get("variations"), dict) else {}
        average = price_variations.get("average") if isinstance(price_variations.get("average"), dict) else {}
        taxes = price.get("taxes") if isinstance(price.get("taxes"), list) else []
        tax_total = sum(
            (
                _to_decimal(item.get("amount"))
                for item in taxes
                if isinstance(item, dict) and _to_decimal(item.get("amount")) is not None
            ),
            Decimal("0.00"),
        )
        amenities = [
            _string_value(item)
            for item in (hotel.get("amenities") if isinstance(hotel.get("amenities"), list) else [])
        ]
        place_payload = {
            "source": "amadeus_hotel",
            "external_id": hotel_id,
            "name": hotel_name,
            "category": "hotel",
            "address_text": address_text,
            "lat": _to_float(geo_code.get("latitude")),
            "lon": _to_float(geo_code.get("longitude")),
            "metadata": {
                "chain_code": _string_value(hotel.get("chainCode")),
                "rating": _to_int(hotel.get("rating") or hotel.get("hotelRating")),
                "amenities": [item for item in amenities if item],
                "city_code": _string_value(hotel.get("cityCode")),
                "distance": hotel.get("distance"),
            },
        }
        return {
            "provider": "amadeus_lodging",
            "provider_offer_ref": str(offer.get("id") or _hash_int(str(offer), 10_000_000)),
            "title": title,
            "lodging_type": "hotel",
            "location_text": _truncate_text(request.get("location_text") or hotel_name, 255),
            "room_type": _truncate_text(room_label, 128),
            "checkin_date": checkin,
            "checkout_date": checkout,
            "nights": nights,
            "place_payload": place_payload,
            "price_amount": _to_decimal(price.get("total") or price.get("base") or offer.get("price")),
            "currency": str(price.get("currency") or request.get("currency") or "EUR").upper(),
            "deep_link": deep_link,
            "expires_at": datetime.now(UTC) + timedelta(hours=6),
            "raw_payload_json": {
                "provider": "amadeus_lodging",
                "hotel": hotel,
                "offer": offer,
                "rating": rating or {},
                "address_text": address_text,
                "nightly_rate": average.get("total") or average.get("base") or price.get("base"),
                "taxes_amount": str(tax_total) if taxes else None,
                "room_description": room_description_text,
            },
        }

    async def search(self, request: dict[str, Any]) -> list[dict[str, Any]]:
        constraints = request.get("constraints") or {}
        if constraints.get("force_provider_limited") == self.name:
            raise OfferProviderLimitedError(
                "PROVIDER_LIMITED",
                "Amadeus lodging provider throttled by constraints",
                {"provider": self.name},
            )
        if constraints.get("force_provider_failure") == self.name:
            raise OfferProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus lodging provider transient failure injected",
                {"provider": self.name},
            )

        types_filter = {
            str(value).lower()
            for value in (request.get("lodging_types") or [])
            if isinstance(value, str)
        }
        if types_filter and "hotel" not in types_filter:
            return []

        city_code = await self._city_code(request.get("location_text"))
        checkin = _to_date(request.get("checkin_date"))
        checkout = _to_date(request.get("checkout_date"))
        if not checkin or not checkout or checkout <= checkin:
            raise OfferProviderNonRetryableError(
                "VALIDATION_ERROR", "checkin_date/checkout_date must define a valid range"
            )
        hotels = await self._hotels_for_city(city_code)
        if not hotels:
            return []
        hotel_lookup = {
            _string_value(item.get("hotelId")): item
            for item in hotels
            if isinstance(item, dict) and _string_value(item.get("hotelId"))
        }
        hotel_ids = list(hotel_lookup.keys())

        params: dict[str, Any] = {
            "hotelIds": ",".join(hotel_ids),
            "checkInDate": checkin.isoformat(),
            "checkOutDate": checkout.isoformat(),
            "adults": int(request.get("guests") or 2),
            "roomQuantity": 1,
            "bestRateOnly": True,
            "currency": str(request.get("currency") or "EUR").upper(),
        }

        response = await self._authorized_request(
            method="GET",
            path="/v3/shopping/hotel-offers",
            params=params,
        )

        if response.status_code == 429:
            raise OfferProviderLimitedError(
                "PROVIDER_LIMITED",
                "Amadeus hotel search rate-limited",
                _http_error_details(response),
            )
        if response.status_code >= 500:
            raise OfferProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus hotel search unavailable",
                _http_error_details(response),
            )
        if response.status_code >= 400:
            raise OfferProviderNonRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus hotel search rejected the request",
                _http_error_details(response),
            )

        payload = response.json()
        if not isinstance(payload, dict):
            raise OfferProviderRetryableError(
                "UPSTREAM_PROVIDER_ERROR",
                "Amadeus hotel response is not a JSON object",
                {"provider": self.name},
            )

        rows = payload.get("data") if isinstance(payload.get("data"), list) else []
        ratings_by_hotel: dict[str, dict[str, Any]] = {}
        try:
            ratings_by_hotel = await self._ratings_for_hotels(hotel_ids)
        except OfferProviderError:
            ratings_by_hotel = {}

        candidates: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            row_hotel = row.get("hotel") if isinstance(row.get("hotel"), dict) else row
            hotel_id = _string_value(row_hotel.get("hotelId")) if isinstance(row_hotel, dict) else None
            hotel = dict(hotel_lookup.get(hotel_id, {}))
            if isinstance(row_hotel, dict):
                hotel.update(row_hotel)
            offers = row.get("offers") if isinstance(row.get("offers"), list) else []
            for offer in offers:
                if not isinstance(offer, dict):
                    continue
                candidates.append(
                    self._normalize_offer(
                        request,
                        hotel=hotel,
                        offer=offer,
                        rating=ratings_by_hotel.get(hotel_id or ""),
                    )
                )

        return candidates

    async def price_check(self, candidate: dict[str, Any]) -> dict[str, Any]:
        return candidate

    async def refresh(
        self,
        existing_snapshot: dict[str, Any],
        constraints: dict[str, Any],
    ) -> dict[str, Any]:
        if constraints.get("force_expire"):
            return {"status": "expired", "reason": "forced_by_constraints"}

        existing_expiry = _to_utc_datetime(existing_snapshot.get("expires_at"))
        if existing_expiry and existing_expiry <= datetime.now(UTC):
            return {"status": "expired", "reason": "snapshot_expired"}

        lookup_request = {
            "location_text": existing_snapshot.get("location_text"),
            "checkin_date": existing_snapshot.get("checkin_date"),
            "checkout_date": existing_snapshot.get("checkout_date"),
            "currency": existing_snapshot.get("currency") or "EUR",
            "guests": 2,
            "lodging_types": ["hotel"],
            "constraints": {},
        }
        offers = await self.search(lookup_request)
        if not offers:
            return {"status": "expired", "reason": "offer_no_longer_available"}

        existing_ref = str(existing_snapshot.get("provider_offer_ref") or "")
        selected = next(
            (item for item in offers if str(item.get("provider_offer_ref") or "") == existing_ref),
            offers[0],
        )
        return {"status": "refreshed", "offer": selected}


TRANSPORT_PROVIDERS: dict[str, OfferProvider] = {
    "mock_transport": MockTransportProvider(),
    "amadeus_transport": AmadeusTransportProvider(),
}

LODGING_PROVIDERS: dict[str, OfferProvider] = {
    "mock_lodging": MockLodgingProvider(),
    "amadeus_lodging": AmadeusLodgingProvider(),
}


class ProviderAvailability:
    def __init__(self, configured: list[str], unavailable: list[dict[str, Any]]) -> None:
        self.configured = configured
        self.unavailable = unavailable


def _provider_map(kind: OfferKind) -> dict[str, OfferProvider]:
    if kind == OfferKind.TRANSPORT:
        return TRANSPORT_PROVIDERS
    return LODGING_PROVIDERS


def _default_order(kind: OfferKind) -> list[str]:
    settings = get_settings()
    if kind == OfferKind.TRANSPORT:
        return settings.transport_provider_order()
    return settings.lodging_provider_order()


def resolve_provider_order(kind: OfferKind, requested: list[str] | None) -> list[str]:
    provider_map = _provider_map(kind)
    source = requested if requested is not None else _default_order(kind)
    order: list[str] = []
    seen: set[str] = set()
    for name in source:
        normalized = name.strip()
        if not normalized or normalized in seen:
            continue
        if normalized not in provider_map:
            raise OfferProviderNonRetryableError(
                "VALIDATION_ERROR",
                f"Unknown provider: {normalized}",
                {"provider": normalized},
            )
        order.append(normalized)
        seen.add(normalized)
    if not order:
        raise OfferProviderNonRetryableError(
            "VALIDATION_ERROR",
            "No providers were resolved for the request",
        )
    return order


def _missing_required_env(provider: OfferProvider) -> list[str]:
    settings = get_settings()
    missing: list[str] = []
    for var_name in provider.required_env_vars:
        value = getattr(settings, _env_alias_to_setting(var_name), None)
        if value in (None, ""):
            missing.append(var_name)
    return missing


def _env_alias_to_setting(env_var: str) -> str:
    mapping = {
        "VOYAGER_FLIGHTS_AMADEUS_CLIENT_ID": "flights_amadeus_client_id",
        "VOYAGER_FLIGHTS_AMADEUS_CLIENT_SECRET": "flights_amadeus_client_secret",
    }
    return mapping[env_var]


def resolve_provider_availability(kind: OfferKind, order: list[str]) -> ProviderAvailability:
    provider_map = _provider_map(kind)
    configured: list[str] = []
    unavailable: list[dict[str, Any]] = []

    for provider_name in order:
        provider = provider_map[provider_name]
        missing_vars = _missing_required_env(provider)
        if missing_vars:
            unavailable.append(
                {
                    "provider": provider_name,
                    "code": "INTEGRATION_NOT_CONFIGURED",
                    "missing_env_vars": missing_vars,
                }
            )
            continue
        configured.append(provider_name)

    return ProviderAvailability(configured=configured, unavailable=unavailable)


def get_provider(kind: OfferKind, provider_name: str) -> OfferProvider:
    return _provider_map(kind)[provider_name]
