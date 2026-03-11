from __future__ import annotations

import mimetypes
import os
import tempfile
import uuid
from pathlib import Path
from urllib.parse import urlparse

import httpx

from app.config import get_settings
from app.db.models import PlacePhoto


def build_place_photo_asset_url(photo_id: uuid.UUID, variant: str) -> str:
    return f"/places/photos/{photo_id}/asset?variant={variant}"


def _guess_extension(source_url: str, content_type: str | None = None) -> str:
    parsed = urlparse(source_url)
    suffix = Path(parsed.path).suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}:
        return suffix

    if content_type:
        guessed = mimetypes.guess_extension(content_type.split(";")[0].strip())
        if guessed:
            return guessed

    return ".jpg"


def _source_url_for_variant(photo: PlacePhoto, variant: str) -> str:
    if variant == "thumb" and photo.thumbnail_url:
        return photo.thumbnail_url
    return photo.image_url


def _cache_path_for_variant(photo: PlacePhoto, variant: str, extension: str) -> Path:
    settings = get_settings()
    cache_root = Path(settings.media_cache_dir) / "place-photos" / str(photo.id)
    return cache_root / f"{variant}{extension}"


async def ensure_place_photo_asset(photo: PlacePhoto, *, variant: str) -> Path:
    source_url = _source_url_for_variant(photo, variant)
    initial_extension = _guess_extension(source_url)
    target_path = _cache_path_for_variant(photo, variant, initial_extension)
    if target_path.exists():
        return target_path

    target_path.parent.mkdir(parents=True, exist_ok=True)
    headers = {"User-Agent": get_settings().media_user_agent}
    if photo.source == "google_places" and get_settings().google_maps_api_key:
        headers["X-Goog-Api-Key"] = get_settings().google_maps_api_key

    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, headers=headers) as client:
        response = await client.get(source_url)
        response.raise_for_status()

    extension = _guess_extension(source_url, response.headers.get("content-type"))
    final_path = _cache_path_for_variant(photo, variant, extension)
    if final_path.exists():
        return final_path

    with tempfile.NamedTemporaryFile(dir=final_path.parent, delete=False) as tmp_file:
        tmp_file.write(response.content)
        tmp_name = tmp_file.name

    os.replace(tmp_name, final_path)
    return final_path
