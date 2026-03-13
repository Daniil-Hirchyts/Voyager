from __future__ import annotations

import hashlib
import mimetypes
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.db.models import UserProfile
from app.errors import ValidationApiError
from app.models.users import UserProfileResponse
from app.services.trip_assets import (
    build_trip_asset_thumbnail,
    ensure_trip_asset_bucket,
    get_trip_asset_internal_client,
    get_trip_asset_public_client,
    normalize_trip_asset_content_type,
)


@dataclass
class PreparedProfileAvatarUpload:
    content_type: str
    size_bytes: int
    sha256: str
    object_key: str
    original_bytes: bytes
    thumbnail_object_key: str
    thumbnail_bytes: bytes
    thumbnail_content_type: str


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    cleaned = str(value).strip()
    return cleaned or None


def infer_name_parts_from_claims(claims: dict[str, Any] | None) -> tuple[str | None, str | None]:
    data = claims or {}
    given_name = _clean_text(data.get("given_name"))
    family_name = _clean_text(data.get("family_name"))
    if given_name or family_name:
        return given_name, family_name

    full_name = _clean_text(data.get("name"))
    if not full_name:
        return None, None

    parts = full_name.split()
    if len(parts) == 1:
        return parts[0], None
    return parts[0], " ".join(parts[1:])


def build_display_name(
    *,
    first_name: str | None,
    last_name: str | None,
    fallback: str | None = None,
) -> str:
    parts = [part for part in (first_name, last_name) if part]
    if parts:
        return " ".join(parts)
    if fallback and fallback.strip():
        return fallback.strip()
    return "Traveler"


def _sanitize_filename(value: str | None) -> str:
    candidate = (value or "").strip()
    if not candidate:
        return "avatar"
    candidate = candidate.replace("\\", "/").split("/")[-1]
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", candidate).strip(".-")
    return cleaned or "avatar"


def build_profile_avatar_object_key(
    *,
    user_id: uuid.UUID,
    avatar_id: uuid.UUID,
    original_filename: str,
) -> str:
    safe_name = _sanitize_filename(original_filename)
    suffix = Path(safe_name).suffix
    stem = Path(safe_name).stem or "avatar"
    return f"users/{user_id}/profile/avatar/{avatar_id}/original/{stem}{suffix}"


def build_profile_avatar_thumbnail_key(
    *,
    user_id: uuid.UUID,
    avatar_id: uuid.UUID,
    original_filename: str,
) -> str:
    safe_name = _sanitize_filename(original_filename)
    stem = Path(safe_name).stem or "avatar"
    return f"users/{user_id}/profile/avatar/{avatar_id}/preview/{stem}.jpg"


def prepare_profile_avatar_upload(
    *,
    user_id: uuid.UUID,
    avatar_id: uuid.UUID,
    original_filename: str,
    content_type: str | None,
    content: bytes,
) -> PreparedProfileAvatarUpload:
    normalized_content_type = normalize_trip_asset_content_type(
        filename=original_filename,
        content_type=content_type,
    )
    thumbnail = build_trip_asset_thumbnail(content)
    if not normalized_content_type.startswith("image/") or thumbnail is None:
        raise ValidationApiError("Uploaded avatar must be a valid image")

    thumbnail_bytes, thumbnail_content_type, _image_width, _image_height = thumbnail
    return PreparedProfileAvatarUpload(
        content_type=normalized_content_type,
        size_bytes=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
        object_key=build_profile_avatar_object_key(
            user_id=user_id,
            avatar_id=avatar_id,
            original_filename=original_filename,
        ),
        original_bytes=content,
        thumbnail_object_key=build_profile_avatar_thumbnail_key(
            user_id=user_id,
            avatar_id=avatar_id,
            original_filename=original_filename,
        ),
        thumbnail_bytes=thumbnail_bytes,
        thumbnail_content_type=thumbnail_content_type,
    )


def upload_prepared_profile_avatar(prepared: PreparedProfileAvatarUpload) -> None:
    ensure_trip_asset_bucket()
    client = get_trip_asset_internal_client()
    bucket = get_settings().object_storage_bucket
    client.put_object(
        Bucket=bucket,
        Key=prepared.object_key,
        Body=prepared.original_bytes,
        ContentType=prepared.content_type,
    )
    client.put_object(
        Bucket=bucket,
        Key=prepared.thumbnail_object_key,
        Body=prepared.thumbnail_bytes,
        ContentType=prepared.thumbnail_content_type,
    )


def _content_disposition(value: str) -> str:
    safe_name = _sanitize_filename(value)
    return f'inline; filename="{safe_name}"'


def _avatar_filename(content_type: str | None) -> str:
    extension = mimetypes.guess_extension(content_type or "") or ".bin"
    return f"avatar{extension}"


def build_profile_avatar_urls(
    *,
    object_key: str,
    thumbnail_object_key: str | None,
    content_type: str | None,
) -> tuple[str, str]:
    client = get_trip_asset_public_client()
    bucket = get_settings().object_storage_bucket
    ttl = get_settings().object_storage_url_ttl_sec
    filename = _avatar_filename(content_type)
    avatar_url = client.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": bucket,
            "Key": object_key,
            "ResponseContentDisposition": _content_disposition(filename),
        },
        ExpiresIn=ttl,
    )
    avatar_thumbnail_url = client.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": bucket,
            "Key": thumbnail_object_key or object_key,
            "ResponseContentDisposition": _content_disposition(filename),
        },
        ExpiresIn=ttl,
    )
    return avatar_url, avatar_thumbnail_url


def build_user_profile_response(user: UserProfile) -> UserProfileResponse:
    avatar_url = None
    avatar_thumbnail_url = None
    if user.avatar_object_key:
        avatar_url, avatar_thumbnail_url = build_profile_avatar_urls(
            object_key=user.avatar_object_key,
            thumbnail_object_key=user.avatar_thumbnail_object_key,
            content_type=user.avatar_content_type,
        )

    return UserProfileResponse(
        id=user.id,
        keycloak_sub=user.keycloak_sub,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        display_name=build_display_name(
            first_name=user.first_name,
            last_name=user.last_name,
            fallback=user.display_name,
        ),
        avatar_url=avatar_url,
        avatar_thumbnail_url=avatar_thumbnail_url,
        preferences=user.preferences_json or {},
        created_at=user.created_at,
        updated_at=user.updated_at,
    )
