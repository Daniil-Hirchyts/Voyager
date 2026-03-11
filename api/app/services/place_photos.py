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
from app.services.google_maps import (
    GoogleMapsError,
    fetch_google_place_photos,
    google_maps_enabled,
)
from app.services.itinerary_generation import NonRetryableJobError, RetryableJobError

WIKIMEDIA_BASE_URL = "https://commons.wikimedia.org"
WIKIDATA_BASE_URL = "https://www.wikidata.org"
WIKIPEDIA_BASE_URL = "https://en.wikipedia.org"
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
    normalized = re.sub(r"\s+", " ", cleaned.strip().lower())
    normalized = normalized.replace("_", "-")

    if re.fullmatch(
        r"(cc[\s-]?0(?:\s*1\.0)?|creative commons zero(?:\s*1\.0)?|cc0 public domain dedication)",
        normalized,
    ):
        return "cc0"

    if re.fullmatch(r"(pdm|public domain(?: mark)?(?:\s*1\.0)?|public domain)", normalized):
        return "pdm"

    if re.fullmatch(
        r"(creative commons attribution-share alike(?:\s+\d+(?:\.\d+)*)?|cc[\s-]?by[\s-]?sa(?:\s+\d+(?:\.\d+)*)?|by[\s-]?sa(?:\s+\d+(?:\.\d+)*)?)",
        normalized,
    ):
        return "cc-by-sa"

    if re.fullmatch(
        r"(creative commons attribution(?:\s+\d+(?:\.\d+)*)?|cc[\s-]?by(?:\s+\d+(?:\.\d+)*)?|by(?:\s+\d+(?:\.\d+)*)?)",
        normalized,
    ):
        return "cc-by"

    if normalized in ALLOWED_LICENSE_CODES:
        return normalized
    return None


def _search_term(place) -> str:
    return _search_terms(place)[0]


def _search_terms(place) -> list[str]:
    metadata = (
        place.metadata_json if isinstance(getattr(place, "metadata_json", None), dict) else {}
    )
    name = _clean_text(getattr(place, "name", None))
    category = _clean_text(getattr(place, "category", None))
    address_text = _clean_text(getattr(place, "address_text", None))
    region = _clean_text(metadata.get("region"))
    country = _clean_text(metadata.get("country"))
    address_parts = [part.strip() for part in (address_text or "").split(",") if part.strip()]
    locality = next(
        (part for part in address_parts if not name or part.casefold() != name.casefold()),
        None,
    )

    raw_terms = [
        " ".join(part for part in (name, country) if part),
        " ".join(part for part in (name, region) if part),
        " ".join(part for part in (name, locality) if part),
        address_text,
        " ".join(part for part in (name, category, country) if part),
        " ".join(part for part in (name, category) if part),
        name,
    ]

    deduped: list[str] = []
    seen: set[str] = set()
    for term in raw_terms:
        cleaned = _clean_text(term)
        if not cleaned:
            continue
        dedupe_key = cleaned.casefold()
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        deduped.append(cleaned)

    return deduped or ["travel destination photo"]


def _google_place_id(place) -> str | None:
    metadata = (
        place.metadata_json if isinstance(getattr(place, "metadata_json", None), dict) else {}
    )
    if place.source in {"google_places", "destination"}:
        external_id = _clean_text(getattr(place, "external_id", None))
        if external_id:
            return external_id

    for key in ("google_place_id",):
        value = _clean_text(metadata.get(key))
        if value:
            return value
    return None


def _normalize_file_title(value: str | None) -> str | None:
    cleaned = _clean_text(value)
    if not cleaned:
        return None
    title = cleaned.replace("_", " ")
    if not title.lower().startswith("file:"):
        title = f"File:{title}"
    return title


async def _commons_image_candidates_from_titles(titles: list[str]) -> list[dict[str, Any]]:
    settings = get_settings()
    params = {
        "action": "query",
        "titles": "|".join(titles[:8]),
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


async def _resolve_wikidata_image_titles(place) -> list[str]:
    settings = get_settings()
    headers = {"User-Agent": settings.media_user_agent}
    entity_ids: list[str] = []
    try:
        async with httpx.AsyncClient(
            base_url=WIKIDATA_BASE_URL,
            timeout=15.0,
            headers=headers,
        ) as client:
            for term in _search_terms(place):
                search_response = await client.get(
                    "/w/api.php",
                    params={
                        "action": "wbsearchentities",
                        "search": term,
                        "language": "en",
                        "limit": 5,
                        "format": "json",
                        "origin": "*",
                    },
                )

                if search_response.status_code >= 500:
                    raise RetryableJobError("UPSTREAM_PROVIDER_ERROR", "Wikidata upstream error")
                if search_response.status_code >= 400:
                    raise NonRetryableJobError(
                        "UPSTREAM_PROVIDER_BAD_REQUEST", "Wikidata request rejected"
                    )

                search_payload = search_response.json()
                search_results = (
                    search_payload.get("search") if isinstance(search_payload, dict) else None
                )
                if not isinstance(search_results, list) or not search_results:
                    continue

                entity_ids = [
                    str(item.get("id"))
                    for item in search_results
                    if isinstance(item, dict) and item.get("id")
                ]
                if entity_ids:
                    break
    except httpx.TimeoutException as exc:
        raise RetryableJobError("UPSTREAM_PROVIDER_TIMEOUT", "Wikidata request timed out") from exc
    except httpx.HTTPError as exc:
        raise RetryableJobError("UPSTREAM_PROVIDER_ERROR", "Wikidata request failed") from exc

    if not entity_ids:
        return []

    entity_params = {
        "action": "wbgetentities",
        "ids": "|".join(entity_ids),
        "props": "claims",
        "format": "json",
        "origin": "*",
    }
    try:
        async with httpx.AsyncClient(
            base_url=WIKIDATA_BASE_URL,
            timeout=15.0,
            headers=headers,
        ) as client:
            entity_response = await client.get("/w/api.php", params=entity_params)
    except httpx.TimeoutException as exc:
        raise RetryableJobError(
            "UPSTREAM_PROVIDER_TIMEOUT", "Wikidata entity request timed out"
        ) from exc
    except httpx.HTTPError as exc:
        raise RetryableJobError(
            "UPSTREAM_PROVIDER_ERROR", "Wikidata entity request failed"
        ) from exc

    if entity_response.status_code >= 500:
        raise RetryableJobError("UPSTREAM_PROVIDER_ERROR", "Wikidata entity upstream error")
    if entity_response.status_code >= 400:
        raise NonRetryableJobError(
            "UPSTREAM_PROVIDER_BAD_REQUEST", "Wikidata entity request rejected"
        )

    payload = entity_response.json()
    entities = payload.get("entities") if isinstance(payload, dict) else None
    if not isinstance(entities, dict):
        return []

    for entity_id in entity_ids:
        entity = entities.get(entity_id)
        if not isinstance(entity, dict):
            continue
        claims = entity.get("claims")
        if not isinstance(claims, dict):
            continue
        image_claims = claims.get("P18")
        if not isinstance(image_claims, list):
            continue
        titles: list[str] = []
        for claim in image_claims:
            if not isinstance(claim, dict):
                continue
            mainsnak = claim.get("mainsnak")
            if not isinstance(mainsnak, dict):
                continue
            datavalue = mainsnak.get("datavalue")
            if not isinstance(datavalue, dict):
                continue
            title = _normalize_file_title(datavalue.get("value"))
            if title:
                titles.append(title)
        if titles:
            return titles

    return []


async def _fetch_wikidata_candidates(place) -> list[dict[str, Any]]:
    titles = await _resolve_wikidata_image_titles(place)
    if not titles:
        return []

    results = await _commons_image_candidates_from_titles(titles)
    for item in results:
        item["source"] = "wikidata_commons"
    return results


async def _fetch_wikimedia_candidates(place) -> list[dict[str, Any]]:
    settings = get_settings()
    headers = {"User-Agent": settings.media_user_agent}
    try:
        async with httpx.AsyncClient(
            base_url=WIKIMEDIA_BASE_URL,
            timeout=15.0,
            headers=headers,
        ) as client:
            for term in _search_terms(place):
                response = await client.get(
                    "/w/api.php",
                    params={
                        "action": "query",
                        "generator": "search",
                        "gsrsearch": term,
                        "gsrnamespace": 6,
                        "gsrlimit": 8,
                        "prop": "imageinfo",
                        "iiprop": "url|size|extmetadata",
                        "iiurlwidth": 800,
                        "format": "json",
                        "origin": "*",
                    },
                )

                if response.status_code >= 500:
                    raise RetryableJobError("UPSTREAM_PROVIDER_ERROR", "Wikimedia upstream error")
                if response.status_code >= 400:
                    raise NonRetryableJobError(
                        "UPSTREAM_PROVIDER_BAD_REQUEST", "Wikimedia request rejected"
                    )

                payload = response.json()
                query = payload.get("query") if isinstance(payload, dict) else None
                pages = query.get("pages") if isinstance(query, dict) else None
                if not isinstance(pages, dict):
                    continue

                page_titles = [
                    _normalize_file_title(page.get("title"))
                    for page in pages.values()
                    if isinstance(page, dict)
                ]
                normalized_titles = [title for title in page_titles if title]
                if not normalized_titles:
                    continue

                results = await _commons_image_candidates_from_titles(normalized_titles)
                if results:
                    return results
    except httpx.TimeoutException as exc:
        raise RetryableJobError("UPSTREAM_PROVIDER_TIMEOUT", "Wikimedia request timed out") from exc
    except httpx.HTTPError as exc:
        raise RetryableJobError("UPSTREAM_PROVIDER_ERROR", "Wikimedia request failed") from exc

    return []


async def _fetch_openverse_candidates(place) -> list[dict[str, Any]]:
    settings = get_settings()
    headers = {"User-Agent": settings.media_user_agent}
    try:
        async with httpx.AsyncClient(
            base_url=OPENVERSE_BASE_URL,
            timeout=15.0,
            headers=headers,
        ) as client:
            for term in _search_terms(place):
                response = await client.get(
                    "/v1/images/",
                    params={
                        "q": term,
                        "page_size": 8,
                        "license": "cc0,by,by-sa,pdm",
                    },
                )

                if response.status_code >= 500:
                    raise RetryableJobError("UPSTREAM_PROVIDER_ERROR", "Openverse upstream error")
                if response.status_code >= 400:
                    raise NonRetryableJobError(
                        "UPSTREAM_PROVIDER_BAD_REQUEST", "Openverse request rejected"
                    )

                payload = response.json()
                results_raw = payload.get("results") if isinstance(payload, dict) else None
                if not isinstance(results_raw, list):
                    continue

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
                            "source_media_ref": str(
                                item.get("id") or item.get("foreign_landing_url") or ""
                            ),
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
                if results:
                    return results
    except httpx.TimeoutException as exc:
        raise RetryableJobError("UPSTREAM_PROVIDER_TIMEOUT", "Openverse request timed out") from exc
    except httpx.HTTPError as exc:
        raise RetryableJobError("UPSTREAM_PROVIDER_ERROR", "Openverse request failed") from exc

    return []


async def _wikipedia_page_images_from_titles(titles: list[str]) -> list[str]:
    normalized_titles = [title for title in (_clean_text(item) for item in titles) if title]
    if not normalized_titles:
        return []

    settings = get_settings()
    headers = {"User-Agent": settings.media_user_agent}
    params = {
        "action": "query",
        "titles": "|".join(normalized_titles[:8]),
        "prop": "pageimages",
        "piprop": "name|original",
        "format": "json",
        "origin": "*",
    }
    try:
        async with httpx.AsyncClient(
            base_url=WIKIPEDIA_BASE_URL,
            timeout=15.0,
            headers=headers,
        ) as client:
            response = await client.get("/w/api.php", params=params)
    except httpx.TimeoutException as exc:
        raise RetryableJobError("UPSTREAM_PROVIDER_TIMEOUT", "Wikipedia request timed out") from exc
    except httpx.HTTPError as exc:
        raise RetryableJobError("UPSTREAM_PROVIDER_ERROR", "Wikipedia request failed") from exc

    if response.status_code >= 500:
        raise RetryableJobError("UPSTREAM_PROVIDER_ERROR", "Wikipedia upstream error")
    if response.status_code >= 400:
        raise NonRetryableJobError("UPSTREAM_PROVIDER_BAD_REQUEST", "Wikipedia request rejected")

    payload = response.json()
    query = payload.get("query") if isinstance(payload, dict) else None
    pages = query.get("pages") if isinstance(query, dict) else None
    if not isinstance(pages, dict):
        return []

    seen: set[str] = set()
    image_titles: list[str] = []
    for page in pages.values():
        if not isinstance(page, dict):
            continue
        image_title = _normalize_file_title(page.get("pageimage"))
        if not image_title:
            continue
        dedupe_key = image_title.casefold()
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        image_titles.append(image_title)
    return image_titles


async def _search_wikipedia_page_titles(place) -> list[str]:
    settings = get_settings()
    headers = {"User-Agent": settings.media_user_agent}
    try:
        async with httpx.AsyncClient(
            base_url=WIKIPEDIA_BASE_URL,
            timeout=15.0,
            headers=headers,
        ) as client:
            for term in _search_terms(place):
                response = await client.get(
                    "/w/api.php",
                    params={
                        "action": "query",
                        "list": "search",
                        "srsearch": term,
                        "srlimit": 5,
                        "format": "json",
                        "origin": "*",
                    },
                )

                if response.status_code >= 500:
                    raise RetryableJobError("UPSTREAM_PROVIDER_ERROR", "Wikipedia upstream error")
                if response.status_code >= 400:
                    raise NonRetryableJobError(
                        "UPSTREAM_PROVIDER_BAD_REQUEST", "Wikipedia request rejected"
                    )

                payload = response.json()
                search_results = (
                    payload.get("query", {}).get("search") if isinstance(payload, dict) else None
                )
                if not isinstance(search_results, list):
                    continue

                titles = [
                    str(item.get("title"))
                    for item in search_results
                    if isinstance(item, dict) and item.get("title")
                ]
                if titles:
                    return titles
    except httpx.TimeoutException as exc:
        raise RetryableJobError("UPSTREAM_PROVIDER_TIMEOUT", "Wikipedia request timed out") from exc
    except httpx.HTTPError as exc:
        raise RetryableJobError("UPSTREAM_PROVIDER_ERROR", "Wikipedia request failed") from exc

    return []


async def _resolve_wikipedia_image_titles(place) -> list[str]:
    direct_titles = await _wikipedia_page_images_from_titles(
        [getattr(place, "name", None), _clean_text(getattr(place, "address_text", None))]
    )
    if direct_titles:
        return direct_titles

    search_titles = await _search_wikipedia_page_titles(place)
    if not search_titles:
        return []

    return await _wikipedia_page_images_from_titles(search_titles)


async def _fetch_wikipedia_candidates(place) -> list[dict[str, Any]]:
    titles = await _resolve_wikipedia_image_titles(place)
    if not titles:
        return []

    results = await _commons_image_candidates_from_titles(titles)
    for item in results:
        item["source"] = "wikipedia_commons"
    return results


async def _fetch_google_place_candidates(place) -> list[dict[str, Any]]:
    place_id = _google_place_id(place)
    if not place_id or not google_maps_enabled():
        return []

    try:
        return await fetch_google_place_photos(place_id, limit=8)
    except GoogleMapsError as exc:
        raise RetryableJobError(
            "UPSTREAM_PROVIDER_ERROR",
            "Google Place Photos request failed",
            {"error": str(exc), "place_id": place_id},
        ) from exc


async def _fetch_place_photos(place) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]]]:
    errors: list[dict[str, Any]] = []
    for provider_name, fetcher in (
        ("google_places", _fetch_google_place_candidates),
        ("wikipedia_commons", _fetch_wikipedia_candidates),
        ("wikidata_commons", _fetch_wikidata_candidates),
        ("wikimedia_commons", _fetch_wikimedia_candidates),
        ("openverse", _fetch_openverse_candidates),
    ):
        try:
            results = await fetcher(place)
        except RetryableJobError as exc:
            errors.append(
                {
                    "provider": provider_name,
                    "code": exc.code,
                    "message": exc.message,
                    "details": exc.details,
                }
            )
            continue
        except NonRetryableJobError as exc:
            errors.append(
                {
                    "provider": provider_name,
                    "code": exc.code,
                    "message": exc.message,
                    "details": exc.details,
                }
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
