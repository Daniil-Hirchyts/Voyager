from __future__ import annotations

import hashlib
import io
import mimetypes
import re
import uuid
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from PIL import Image, UnidentifiedImageError

from app.config import get_settings


@dataclass
class PreparedTripAssetUpload:
    kind: str
    content_type: str
    size_bytes: int
    sha256: str
    object_key: str
    original_bytes: bytes
    thumbnail_object_key: str | None
    thumbnail_bytes: bytes | None
    thumbnail_content_type: str | None
    image_width: int | None
    image_height: int | None


def _sanitize_filename(value: str | None) -> str:
    candidate = (value or "").strip()
    if not candidate:
        return "upload"
    candidate = candidate.replace("\\", "/").split("/")[-1]
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", candidate).strip(".-")
    return cleaned or "upload"


def normalize_trip_asset_content_type(*, filename: str | None, content_type: str | None) -> str:
    if content_type:
        normalized = content_type.split(";", 1)[0].strip()
        if normalized:
            return normalized
    guessed = mimetypes.guess_type(filename or "")[0]
    return guessed or "application/octet-stream"


def trip_asset_kind_for_content_type(content_type: str) -> str:
    return "photo" if content_type.startswith("image/") else "file"


def build_trip_asset_object_key(
    *, user_id: uuid.UUID, trip_id: uuid.UUID, asset_id: uuid.UUID, original_filename: str
) -> str:
    safe_name = _sanitize_filename(original_filename)
    suffix = Path(safe_name).suffix
    stem = Path(safe_name).stem or "upload"
    return f"users/{user_id}/trips/{trip_id}/assets/{asset_id}/original/{stem}{suffix}"


def build_trip_asset_thumbnail_key(
    *, user_id: uuid.UUID, trip_id: uuid.UUID, asset_id: uuid.UUID, original_filename: str
) -> str:
    safe_name = _sanitize_filename(original_filename)
    stem = Path(safe_name).stem or "upload"
    return f"users/{user_id}/trips/{trip_id}/assets/{asset_id}/preview/{stem}.jpg"


def build_trip_asset_thumbnail(
    content: bytes,
) -> tuple[bytes, str, int, int] | None:
    try:
        with Image.open(io.BytesIO(content)) as image:
            width, height = image.size
            if width <= 0 or height <= 0:
                return None
            thumbnail = image.copy()
            thumbnail.thumbnail((720, 720))
            if thumbnail.mode not in {"RGB", "L"}:
                thumbnail = thumbnail.convert("RGB")
            output = io.BytesIO()
            thumbnail.save(output, format="JPEG", quality=85, optimize=True)
            return output.getvalue(), "image/jpeg", width, height
    except (UnidentifiedImageError, OSError):
        return None


def prepare_trip_asset_upload(
    *,
    user_id: uuid.UUID,
    trip_id: uuid.UUID,
    asset_id: uuid.UUID,
    original_filename: str,
    content_type: str | None,
    content: bytes,
) -> PreparedTripAssetUpload:
    normalized_content_type = normalize_trip_asset_content_type(
        filename=original_filename,
        content_type=content_type,
    )
    thumbnail = build_trip_asset_thumbnail(content)
    kind = trip_asset_kind_for_content_type(normalized_content_type)
    if kind != "photo" and thumbnail is not None:
        kind = "photo"
    thumbnail_key = None
    thumbnail_bytes = None
    thumbnail_content_type = None
    image_width = None
    image_height = None
    if thumbnail is not None:
        thumbnail_bytes, thumbnail_content_type, image_width, image_height = thumbnail
        thumbnail_key = build_trip_asset_thumbnail_key(
            user_id=user_id,
            trip_id=trip_id,
            asset_id=asset_id,
            original_filename=original_filename,
        )
    return PreparedTripAssetUpload(
        kind=kind,
        content_type=normalized_content_type,
        size_bytes=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
        object_key=build_trip_asset_object_key(
            user_id=user_id,
            trip_id=trip_id,
            asset_id=asset_id,
            original_filename=original_filename,
        ),
        original_bytes=content,
        thumbnail_object_key=thumbnail_key,
        thumbnail_bytes=thumbnail_bytes,
        thumbnail_content_type=thumbnail_content_type,
        image_width=image_width,
        image_height=image_height,
    )


def trip_asset_record_payload(asset: Any) -> dict[str, Any]:
    return {
        "id": asset.id,
        "user_id": asset.user_id,
        "trip_id": asset.trip_id,
        "activity_id": asset.activity_id,
        "kind": asset.kind,
        "original_filename": asset.original_filename,
        "content_type": asset.content_type,
        "size_bytes": asset.size_bytes,
        "sha256": asset.sha256,
        "image_width": asset.image_width,
        "image_height": asset.image_height,
        "created_at": asset.created_at,
        "updated_at": asset.updated_at,
    }


def build_trip_asset_s3_client(*, endpoint_url: str):
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=settings.object_storage_access_key,
        aws_secret_access_key=settings.object_storage_secret_key,
        region_name=settings.object_storage_region,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


@lru_cache(maxsize=2)
def get_trip_asset_internal_client():
    return build_trip_asset_s3_client(endpoint_url=get_settings().object_storage_endpoint)


@lru_cache(maxsize=2)
def get_trip_asset_public_client():
    return build_trip_asset_s3_client(endpoint_url=get_settings().object_storage_public_endpoint)


@lru_cache(maxsize=8)
def ensure_trip_asset_bucket_ready(
    endpoint_url: str,
    bucket: str,
    access_key: str,
    secret_key: str,
    region_name: str,
) -> str:
    client = build_trip_asset_s3_client(endpoint_url=endpoint_url)
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code") or "")
        if code not in {"404", "NoSuchBucket", "NotFound"}:
            raise
        try:
            client.create_bucket(Bucket=bucket)
        except ClientError as create_exc:
            create_code = str(create_exc.response.get("Error", {}).get("Code") or "")
            if create_code not in {"BucketAlreadyOwnedByYou", "BucketAlreadyExists", "409"}:
                raise
    return bucket


def _bucket_name() -> str:
    return get_settings().object_storage_bucket


def ensure_trip_asset_bucket() -> None:
    settings = get_settings()
    ensure_trip_asset_bucket_ready(
        settings.object_storage_endpoint,
        settings.object_storage_bucket,
        settings.object_storage_access_key,
        settings.object_storage_secret_key,
        settings.object_storage_region,
    )


def upload_prepared_trip_asset(prepared: PreparedTripAssetUpload) -> None:
    ensure_trip_asset_bucket()
    client = get_trip_asset_internal_client()
    bucket = _bucket_name()
    client.put_object(
        Bucket=bucket,
        Key=prepared.object_key,
        Body=prepared.original_bytes,
        ContentType=prepared.content_type,
    )
    if (
        prepared.thumbnail_object_key
        and prepared.thumbnail_bytes
        and prepared.thumbnail_content_type
    ):
        client.put_object(
            Bucket=bucket,
            Key=prepared.thumbnail_object_key,
            Body=prepared.thumbnail_bytes,
            ContentType=prepared.thumbnail_content_type,
        )


def copy_trip_asset_objects(
    *,
    source_object_key: str,
    source_thumbnail_object_key: str | None,
    destination_object_key: str,
    destination_thumbnail_object_key: str | None,
) -> None:
    ensure_trip_asset_bucket()
    client = get_trip_asset_internal_client()
    bucket = _bucket_name()
    client.copy_object(
        Bucket=bucket,
        CopySource={"Bucket": bucket, "Key": source_object_key},
        Key=destination_object_key,
        MetadataDirective="COPY",
    )
    if source_thumbnail_object_key and destination_thumbnail_object_key:
        client.copy_object(
            Bucket=bucket,
            CopySource={"Bucket": bucket, "Key": source_thumbnail_object_key},
            Key=destination_thumbnail_object_key,
            MetadataDirective="COPY",
        )


def delete_trip_asset_objects(*, object_key: str, thumbnail_object_key: str | None) -> None:
    ensure_trip_asset_bucket()
    client = get_trip_asset_internal_client()
    bucket = _bucket_name()
    keys = [{"Key": object_key}]
    if thumbnail_object_key:
        keys.append({"Key": thumbnail_object_key})
    client.delete_objects(Bucket=bucket, Delete={"Objects": keys, "Quiet": True})


def _content_disposition(value: str, *, attachment: bool) -> str:
    safe_name = _sanitize_filename(value)
    mode = "attachment" if attachment else "inline"
    return f'{mode}; filename="{safe_name}"'


def build_trip_asset_access_urls(
    *,
    object_key: str,
    thumbnail_object_key: str | None,
    original_filename: str,
) -> tuple[str | None, str]:
    client = get_trip_asset_public_client()
    bucket = _bucket_name()
    ttl = get_settings().object_storage_url_ttl_sec
    preview_url = client.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": bucket,
            "Key": thumbnail_object_key or object_key,
            "ResponseContentDisposition": _content_disposition(
                original_filename,
                attachment=False,
            ),
        },
        ExpiresIn=ttl,
    )
    download_url = client.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": bucket,
            "Key": object_key,
            "ResponseContentDisposition": _content_disposition(
                original_filename,
                attachment=True,
            ),
        },
        ExpiresIn=ttl,
    )
    return preview_url, download_url
