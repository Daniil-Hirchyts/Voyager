from __future__ import annotations

import html
import re
import uuid
from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import Job
from app.db.repositories import PlacePhotoRepository, PlaceRepository
from app.services.itinerary_generation import NonRetryableJobError, RetryableJobError

WIKIMEDIA_BASE_URL = "https://commons.wikimedia.org"
OPENVERSE_BASE_URL = "https://api.openverse.org"
ALLOWED_LICENSE_CODES = {
    "cc0",
    "pdm",
    "public domain",
    "cc by",
    "cc-by",
    "cc by-sa",
    "cc-by-sa",
}


@dataclass
class PlacePhotoRefreshResult:
    summary: dict[str, Any]
    photo_ids: list[str]
    provider_used: str
    errors: list[dict[str, Any]]


def _as_uuid(value: Any, *, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise NonRetryableJobError("JOB_PAYLOAD_INVALID", f"{field} must be a valid UUID") from exc


def _clean_text(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    cleaned = re.sub(r"<[^>]+>", "", value)
    return html.unescape(cleaned).strip() or None


def _normalize_license_code(value: Any) -> str | None:
    cleaned = _clean_text(value)
    if not cleaned:
        return None
    normalized = cleaned.strip().lower()
    normalized = normalized.replace("_", "-")
    normalized = normalized.replace("creative commons attribution", "cc by")
    normalized = normalized.replace("creative commons attribution-share alike", "cc by-sa")
    normalized = normalized.replace("cc by-sa", "cc-by-sa")
    normalized = normalized.replace("cc by", "cc-by")
    if normalized in ALLOWED_LICENSE_CODES:
        return normalized
    return None


def _search_term(place) -> str:
    parts = [place.name]
    if place.category:
        parts.append(place.category)
    if place.address_text:
        parts.append(place.address_text.split(",")[0])
    return " ".join(part for part in parts if part).strip()


async def _fetch_wikimedia_candidates(place) -> list[dict[str, Any]]:
    settings = get_settings()
    params = {
        "action": "query",
        "generator": "search",
        "gsrsearch": _search_term(place),
        "gsrnamespace": 6,
        "gsrlimit": 8,
        "prop": "imageinfo",
        "iiprop": "url|size|extmetadata",
        "iiurlwidth": 800,
        "format": "json",
        "origin": "*",
    }
    headers = {"User-Agent": settings.media_user_agent}
    try:
        async with httpx.AsyncClient(
            base_url=WIKIMEDIA_BASE_URL,
            timeout=15.0,
            headers=headers,
        ) as client:
            response = await client.get("/w/api.php", params=params)
    except httpx.TimeoutException as exc:
        raise RetryableJobError("UPSTREAM_PROVIDER_TIMEOUT", "Wikimedia request timed out") from exc
    except httpx.HTTPError as exc:
        raise RetryableJobError("UPSTREAM_PROVIDER_ERROR", "Wikimedia request failed") from exc

    if response.status_code >= 500:
        raise RetryableJobError("UPSTREAM_PROVIDER_ERROR", "Wikimedia upstream error")
    if response.status_code >= 400:
        raise NonRetryableJobError("UPSTREAM_PROVIDER_BAD_REQUEST", "Wikimedia request rejected")

    payload = response.json()
    query = payload.get("query") if isinstance(payload, dict) else None
    pages = query.get("pages") if isinstance(query, dict) else None
    if not isinstance(pages, dict):
        return []

    results: list[dict[str, Any]] = []
    for page in pages.values():
        if not isinstance(page, dict):
            continue
        imageinfo = page.get("imageinfo")
        if not isinstance(imageinfo, list) or not imageinfo or not isinstance(imageinfo[0], dict):
            continue
        info = imageinfo[0]
        metadata = info.get("extmetadata") if isinstance(info.get("extmetadata"), dict) else {}
        license_code = _normalize_license_code(
            metadata.get("LicenseShortName", {}).get("value")
            if isinstance(metadata.get("LicenseShortName"), dict)
            else metadata.get("LicenseShortName")
        )
        if license_code is None:
            continue
        results.append(
            {
                "source": "wikimedia_commons",
                "source_media_ref": str(page.get("pageid") or page.get("title") or ""),
                "image_url": info.get("url"),
                "thumbnail_url": info.get("thumburl"),
                "width": info.get("width"),
                "height": info.get("height"),
                "license_code": license_code,
                "license_url": _clean_text(
                    metadata.get("LicenseUrl", {}).get("value")
                    if isinstance(metadata.get("LicenseUrl"), dict)
                    else metadata.get("LicenseUrl")
                ),
                "author_name": _clean_text(
                    metadata.get("Artist", {}).get("value")
                    if isinstance(metadata.get("Artist"), dict)
                    else metadata.get("Artist")
                ),
                "author_url": None,
                "attribution_text": _clean_text(
                    metadata.get("Attribution", {}).get("value")
                    if isinstance(metadata.get("Attribution"), dict)
                    else metadata.get("Attribution")
                )
                or _clean_text(page.get("title")),
                "raw_payload_json": page,
            }
        )

    results.sort(
        key=lambda item: (
            int(item.get("width") or 0) * int(item.get("height") or 0),
            bool(item.get("thumbnail_url")),
        ),
        reverse=True,
    )
    return [item for item in results if item.get("image_url")]


async def _fetch_openverse_candidates(place) -> list[dict[str, Any]]:
    settings = get_settings()
    params = {
        "q": _search_term(place),
        "page_size": 8,
        "license": "cc0,by,by-sa,pdm",
    }
    headers = {"User-Agent": settings.media_user_agent}
    try:
        async with httpx.AsyncClient(
            base_url=OPENVERSE_BASE_URL,
            timeout=15.0,
            headers=headers,
        ) as client:
            response = await client.get("/v1/images/", params=params)
    except httpx.TimeoutException as exc:
        raise RetryableJobError("UPSTREAM_PROVIDER_TIMEOUT", "Openverse request timed out") from exc
    except httpx.HTTPError as exc:
        raise RetryableJobError("UPSTREAM_PROVIDER_ERROR", "Openverse request failed") from exc

    if response.status_code >= 500:
        raise RetryableJobError("UPSTREAM_PROVIDER_ERROR", "Openverse upstream error")
    if response.status_code >= 400:
        raise NonRetryableJobError("UPSTREAM_PROVIDER_BAD_REQUEST", "Openverse request rejected")

    payload = response.json()
    results_raw = payload.get("results") if isinstance(payload, dict) else None
    if not isinstance(results_raw, list):
        return []

    results: list[dict[str, Any]] = []
    for item in results_raw:
        if not isinstance(item, dict):
            continue
        license_code = _normalize_license_code(item.get("license"))
        if license_code is None or not item.get("url"):
            continue
        results.append(
            {
                "source": "openverse",
                "source_media_ref": str(item.get("id") or item.get("foreign_landing_url") or ""),
                "image_url": item.get("url"),
                "thumbnail_url": item.get("thumbnail"),
                "width": item.get("width"),
                "height": item.get("height"),
                "license_code": license_code,
                "license_url": item.get("license_url"),
                "author_name": item.get("creator"),
                "author_url": item.get("creator_url"),
                "attribution_text": item.get("attribution") or item.get("title"),
                "raw_payload_json": item,
            }
        )

    results.sort(
        key=lambda item: (
            int(item.get("width") or 0) * int(item.get("height") or 0),
            bool(item.get("thumbnail_url")),
        ),
        reverse=True,
    )
    return results


async def _fetch_place_photos(place) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]]]:
    errors: list[dict[str, Any]] = []
    for provider_name, fetcher in (
        ("wikimedia_commons", _fetch_wikimedia_candidates),
        ("openverse", _fetch_openverse_candidates),
    ):
        try:
            results = await fetcher(place)
        except RetryableJobError as exc:
            errors.append(
                {"provider": provider_name, "code": exc.code, "message": exc.message, "details": exc.details}
            )
            continue
        except NonRetryableJobError as exc:
            errors.append(
                {"provider": provider_name, "code": exc.code, "message": exc.message, "details": exc.details}
            )
            continue
        if results:
            return provider_name, results, errors
    return "", [], errors


async def execute_place_photo_refresh_job(
    db: AsyncSession,
    job: Job,
) -> PlacePhotoRefreshResult:
    payload = job.payload_json if isinstance(job.payload_json, dict) else {}
    place_id = _as_uuid(payload.get("place_id"), field="place_id")
    place = await PlaceRepository.get_place(db, place_id)
    provider_name, photos, errors = await _fetch_place_photos(place)
    if not photos:
        raise NonRetryableJobError(
            "NO_PLACE_PHOTOS_FOUND",
            "No licensed place photos found",
            {"place_id": str(place_id), "errors": errors},
        )

    created = await PlacePhotoRepository.replace_photos(db, place_id=place_id, items=photos)
    return PlacePhotoRefreshResult(
        summary={"created": len(created), "provider_used": provider_name, "errors": len(errors)},
        photo_ids=[str(item.id) for item in created],
        provider_used=provider_name,
        errors=errors,
    )
