import logging

import httpx

from app.config import get_settings
from app.models.places import DestinationAutocompleteItem

logger = logging.getLogger(__name__)

_PHOTON_ALLOWED_TYPES = {"city", "country"}


def _clean(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize(value: str | None) -> str:
    return " ".join((value or "").strip().lower().split())


def _unique_parts(*parts: str | None) -> list[str]:
    seen: set[str] = set()
    items: list[str] = []
    for part in parts:
        cleaned = _clean(part)
        if not cleaned:
            continue
        key = _normalize(cleaned)
        if key in seen:
            continue
        seen.add(key)
        items.append(cleaned)
    return items


def _build_label(properties: dict) -> str | None:
    name = _clean(properties.get("name"))
    country = _clean(properties.get("country"))
    place_type = _clean(properties.get("type"))

    if not name:
        return None

    if place_type == "country":
        return name

    parts = _unique_parts(name, country)
    if not parts:
        return None
    return ", ".join(parts)


def _score_candidate(name: str | None, label: str, query: str) -> int:
    normalized_name = _normalize(name)
    normalized_label = _normalize(label)
    normalized_query = _normalize(query)
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
    if any(part.strip() == normalized_query for part in normalized_label.split(",")):
        return 4
    if any(part.strip().startswith(normalized_query) for part in normalized_label.split(",")):
        return 5
    if normalized_query in normalized_name:
        return 6
    if normalized_label.startswith(normalized_query):
        return 7
    if normalized_query in normalized_label:
        return 8
    return 99


def _feature_to_item(feature: dict, query: str) -> tuple[int, DestinationAutocompleteItem] | None:
    properties = feature.get("properties") if isinstance(feature, dict) else None
    geometry = feature.get("geometry") if isinstance(feature, dict) else None
    if not isinstance(properties, dict):
        return None

    place_type = _clean(properties.get("type"))
    if place_type not in _PHOTON_ALLOWED_TYPES:
        return None

    label = _build_label(properties)
    if not label:
        return None

    score = _score_candidate(_clean(properties.get("name")), label, query)
    if score == 99:
        return None

    coordinates = geometry.get("coordinates") if isinstance(geometry, dict) else None
    lon = None
    lat = None
    if isinstance(coordinates, list) and len(coordinates) >= 2:
        lon = float(coordinates[0]) if coordinates[0] is not None else None
        lat = float(coordinates[1]) if coordinates[1] is not None else None

    osm_type = _clean(properties.get("osm_type")) or "unknown"
    osm_id = _clean(properties.get("osm_id")) or label

    return (
        score,
        DestinationAutocompleteItem(
            id=f"photon:{osm_type}:{osm_id}",
            label=label,
            name=_clean(properties.get("name")),
            country=_clean(properties.get("country")),
            region=_clean(properties.get("state")),
            lat=lat,
            lon=lon,
        ),
    )


async def search_destination_suggestions(q: str, limit: int) -> list[DestinationAutocompleteItem]:
    query = q.strip()
    if len(query) < 2:
        return []

    settings = get_settings()
    params = [
        ("q", query),
        ("lang", settings.places_autocomplete_lang),
        ("limit", str(max(limit, 1))),
        ("layer", "city"),
        ("layer", "country"),
        ("dedupe", "1"),
    ]

    try:
        async with httpx.AsyncClient(
            timeout=settings.places_autocomplete_timeout_sec,
            headers={"User-Agent": settings.media_user_agent},
            follow_redirects=True,
        ) as client:
            response = await client.get(settings.places_autocomplete_base_url, params=params)
            response.raise_for_status()
    except httpx.TimeoutException as exc:
        logger.warning("places autocomplete timed out: %s", exc)
        return []
    except httpx.HTTPError as exc:
        logger.warning("places autocomplete request failed: %s", exc)
        return []

    payload = response.json()
    features = payload.get("features") if isinstance(payload, dict) else None
    if not isinstance(features, list):
        return []

    ranked_items: list[tuple[int, DestinationAutocompleteItem]] = []
    seen_labels: set[str] = set()

    for feature in features:
        normalized = _feature_to_item(feature, query)
        if not normalized:
            continue

        score, item = normalized
        label_key = _normalize(item.label)
        if label_key in seen_labels:
            continue
        seen_labels.add(label_key)
        ranked_items.append((score, item))

    ranked_items.sort(key=lambda entry: (entry[0], len(entry[1].label), entry[1].label))
    return [item for _, item in ranked_items[:limit]]
