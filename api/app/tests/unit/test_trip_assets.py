from io import BytesIO
from uuid import uuid4

import pytest
from botocore.exceptions import ClientError
from PIL import Image

from app.config import get_settings
from app.services import trip_assets


def _clear_trip_asset_caches() -> None:
    for attr_name in (
        "get_trip_asset_internal_client",
        "get_trip_asset_public_client",
        "ensure_trip_asset_bucket_ready",
    ):
        attr = getattr(trip_assets, attr_name, None)
        cache_clear = getattr(attr, "cache_clear", None)
        if callable(cache_clear):
            cache_clear()


@pytest.fixture(autouse=True)
def _base_settings_env(monkeypatch):
    monkeypatch.setenv(
        "VOYAGER_DB_DSN", "postgresql+asyncpg://voyager:voyager@localhost:5432/voyager"
    )
    monkeypatch.setenv("VOYAGER_REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setenv("VOYAGER_KEYCLOAK_ISSUER", "http://localhost:8080/realms/travel")
    monkeypatch.setenv("VOYAGER_KEYCLOAK_AUDIENCE", "voyager-api")
    monkeypatch.setenv(
        "VOYAGER_KEYCLOAK_JWKS_URL",
        "http://localhost:8080/realms/travel/protocol/openid-connect/certs",
    )
    monkeypatch.setenv("VOYAGER_KEYCLOAK_CLIENT_ID", "voyager-api")
    monkeypatch.setenv("VOYAGER_OBJECT_STORAGE_ENDPOINT", "http://localhost:9000")
    monkeypatch.setenv("VOYAGER_OBJECT_STORAGE_PUBLIC_ENDPOINT", "http://localhost:9000")
    monkeypatch.setenv("VOYAGER_OBJECT_STORAGE_ACCESS_KEY", "rustfsadmin")
    monkeypatch.setenv("VOYAGER_OBJECT_STORAGE_SECRET_KEY", "rustfsadmin")
    monkeypatch.setenv("VOYAGER_OBJECT_STORAGE_BUCKET", "voyager-media")
    monkeypatch.setenv("VOYAGER_OBJECT_STORAGE_REGION", "us-east-1")
    monkeypatch.setenv("VOYAGER_OBJECT_STORAGE_URL_TTL_SEC", "900")
    get_settings.cache_clear()
    _clear_trip_asset_caches()
    yield
    get_settings.cache_clear()
    _clear_trip_asset_caches()


def _png_bytes(*, width: int = 1600, height: int = 1200) -> bytes:
    image = Image.new("RGB", (width, height), color=(24, 90, 148))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _client_error(code: str, operation_name: str) -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": code}}, operation_name)


def test_prepare_trip_asset_upload_generates_photo_thumbnail():
    prepared = trip_assets.prepare_trip_asset_upload(
        user_id=uuid4(),
        trip_id=uuid4(),
        asset_id=uuid4(),
        original_filename="museum-pass.png",
        content_type="image/png",
        content=_png_bytes(),
    )

    assert prepared.kind == "photo"
    assert prepared.content_type == "image/png"
    assert prepared.thumbnail_object_key is not None
    assert prepared.thumbnail_bytes is not None
    assert prepared.thumbnail_content_type == "image/jpeg"
    assert prepared.image_width == 1600
    assert prepared.image_height == 1200
    assert prepared.object_key.endswith("/museum-pass.png")
    assert prepared.thumbnail_object_key.endswith("/museum-pass.jpg")

    with Image.open(BytesIO(prepared.thumbnail_bytes)) as thumbnail:
        assert thumbnail.format == "JPEG"
        assert max(thumbnail.size) <= 720


def test_prepare_trip_asset_upload_keeps_non_images_without_thumbnail():
    prepared = trip_assets.prepare_trip_asset_upload(
        user_id=uuid4(),
        trip_id=uuid4(),
        asset_id=uuid4(),
        original_filename="boarding-pass.pdf",
        content_type="application/pdf",
        content=b"%PDF-1.7\nboarding pass\n",
    )

    assert prepared.kind == "file"
    assert prepared.content_type == "application/pdf"
    assert prepared.thumbnail_object_key is None
    assert prepared.thumbnail_bytes is None
    assert prepared.image_width is None
    assert prepared.image_height is None
    assert prepared.object_key.endswith("/boarding-pass.pdf")


def test_build_trip_asset_s3_client_uses_path_style_signing():
    client = trip_assets.build_trip_asset_s3_client(endpoint_url="http://localhost:9000")

    assert client.meta.endpoint_url == "http://localhost:9000"
    assert client.meta.config.signature_version == "s3v4"
    assert client.meta.config.s3.get("addressing_style") == "path"


def test_ensure_trip_asset_bucket_ready_creates_missing_bucket(monkeypatch):
    calls: list[tuple[str, str]] = []

    class _FakeClient:
        def head_bucket(self, **kwargs):
            bucket = kwargs["Bucket"]
            calls.append(("head_bucket", bucket))
            raise _client_error("404", "HeadBucket")

        def create_bucket(self, **kwargs):
            calls.append(("create_bucket", kwargs["Bucket"]))

    monkeypatch.setattr(
        trip_assets,
        "build_trip_asset_s3_client",
        lambda *, endpoint_url: _FakeClient(),
    )
    trip_assets.ensure_trip_asset_bucket_ready.cache_clear()

    bucket = trip_assets.ensure_trip_asset_bucket_ready(
        "http://localhost:9000",
        "voyager-media",
        "rustfsadmin",
        "rustfsadmin",
        "us-east-1",
    )

    assert bucket == "voyager-media"
    assert calls == [
        ("head_bucket", "voyager-media"),
        ("create_bucket", "voyager-media"),
    ]


def test_ensure_trip_asset_bucket_ready_ignores_bucket_race(monkeypatch):
    class _FakeClient:
        def head_bucket(self, **kwargs):
            raise _client_error("NoSuchBucket", "HeadBucket")

        def create_bucket(self, **kwargs):
            raise _client_error("BucketAlreadyOwnedByYou", "CreateBucket")

    monkeypatch.setattr(
        trip_assets,
        "build_trip_asset_s3_client",
        lambda *, endpoint_url: _FakeClient(),
    )
    trip_assets.ensure_trip_asset_bucket_ready.cache_clear()

    bucket = trip_assets.ensure_trip_asset_bucket_ready(
        "http://localhost:9000",
        "voyager-media",
        "rustfsadmin",
        "rustfsadmin",
        "us-east-1",
    )

    assert bucket == "voyager-media"


def test_copy_delete_and_access_url_helpers_use_expected_s3_operations(monkeypatch):
    copied: list[dict] = []
    deleted: list[dict] = []
    presigned: list[tuple[str, dict, int]] = []

    class _FakeClient:
        def copy_object(self, **kwargs):
            copied.append(kwargs)

        def delete_objects(self, **kwargs):
            deleted.append(kwargs)

        def generate_presigned_url(self, operation_name: str, **kwargs):
            params = kwargs["Params"]
            expires_in = kwargs["ExpiresIn"]
            presigned.append((operation_name, params, expires_in))
            return f"https://signed.example/{params['Key']}"

    fake_client = _FakeClient()
    monkeypatch.setattr(trip_assets, "ensure_trip_asset_bucket", lambda: None)
    monkeypatch.setattr(trip_assets, "get_trip_asset_internal_client", lambda: fake_client)
    monkeypatch.setattr(trip_assets, "get_trip_asset_public_client", lambda: fake_client)
    monkeypatch.setattr(trip_assets, "_bucket_name", lambda: "voyager-media")

    trip_assets.copy_trip_asset_objects(
        source_object_key="source/original.pdf",
        source_thumbnail_object_key="source/preview.jpg",
        destination_object_key="dest/original.pdf",
        destination_thumbnail_object_key="dest/preview.jpg",
    )
    trip_assets.delete_trip_asset_objects(
        object_key="dest/original.pdf",
        thumbnail_object_key="dest/preview.jpg",
    )
    preview_url, download_url = trip_assets.build_trip_asset_access_urls(
        object_key="dest/original.pdf",
        thumbnail_object_key="dest/preview.jpg",
        original_filename="museum pass.pdf",
    )

    assert copied == [
        {
            "Bucket": "voyager-media",
            "CopySource": {"Bucket": "voyager-media", "Key": "source/original.pdf"},
            "Key": "dest/original.pdf",
            "MetadataDirective": "COPY",
        },
        {
            "Bucket": "voyager-media",
            "CopySource": {"Bucket": "voyager-media", "Key": "source/preview.jpg"},
            "Key": "dest/preview.jpg",
            "MetadataDirective": "COPY",
        },
    ]
    assert deleted == [
        {
            "Bucket": "voyager-media",
            "Delete": {
                "Objects": [
                    {"Key": "dest/original.pdf"},
                    {"Key": "dest/preview.jpg"},
                ],
                "Quiet": True,
            },
        }
    ]
    assert preview_url == "https://signed.example/dest/preview.jpg"
    assert download_url == "https://signed.example/dest/original.pdf"
    assert presigned == [
        (
            "get_object",
            {
                "Bucket": "voyager-media",
                "Key": "dest/preview.jpg",
                "ResponseContentDisposition": 'inline; filename="museum-pass.pdf"',
            },
            900,
        ),
        (
            "get_object",
            {
                "Bucket": "voyager-media",
                "Key": "dest/original.pdf",
                "ResponseContentDisposition": 'attachment; filename="museum-pass.pdf"',
            },
            900,
        ),
    ]
