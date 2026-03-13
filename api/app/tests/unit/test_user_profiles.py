from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.errors import ValidationApiError
from app.services import user_profiles


def test_infer_name_parts_from_claims_prefers_given_and_family_name():
    first_name, last_name = user_profiles.infer_name_parts_from_claims(
        {"given_name": "Captain", "family_name": "Atlas", "name": "Ignored Value"}
    )

    assert first_name == "Captain"
    assert last_name == "Atlas"


def test_infer_name_parts_from_claims_falls_back_to_name():
    first_name, last_name = user_profiles.infer_name_parts_from_claims({"name": "Voyager User Two"})

    assert first_name == "Voyager"
    assert last_name == "User Two"


def test_build_user_profile_response_includes_avatar_urls(monkeypatch):
    presigned: list[tuple[str, dict, int]] = []

    class _FakeClient:
        def generate_presigned_url(self, operation_name: str, **kwargs):
            presigned.append((operation_name, kwargs["Params"], kwargs["ExpiresIn"]))
            return f"https://signed.example/{kwargs['Params']['Key']}"

    monkeypatch.setattr(user_profiles, "get_trip_asset_public_client", lambda: _FakeClient())

    profile = SimpleNamespace(
        id=uuid4(),
        keycloak_sub="user-123",
        email="captain@example.com",
        first_name="Captain",
        last_name="Atlas",
        display_name="Captain Atlas",
        avatar_object_key="users/user-123/profile/avatar/original/avatar.png",
        avatar_thumbnail_object_key="users/user-123/profile/avatar/preview/avatar.jpg",
        avatar_content_type="image/png",
        preferences_json={},
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )

    response = user_profiles.build_user_profile_response(profile)

    assert response.display_name == "Captain Atlas"
    assert response.avatar_url == "https://signed.example/users/user-123/profile/avatar/original/avatar.png"
    assert (
        response.avatar_thumbnail_url
        == "https://signed.example/users/user-123/profile/avatar/preview/avatar.jpg"
    )
    assert presigned == [
        (
            "get_object",
            {
                "Bucket": "voyager-media",
                "Key": "users/user-123/profile/avatar/original/avatar.png",
                "ResponseContentDisposition": 'inline; filename="avatar.png"',
            },
            900,
        ),
        (
            "get_object",
            {
                "Bucket": "voyager-media",
                "Key": "users/user-123/profile/avatar/preview/avatar.jpg",
                "ResponseContentDisposition": 'inline; filename="avatar.png"',
            },
            900,
        ),
    ]


def test_prepare_profile_avatar_upload_rejects_non_images():
    with pytest.raises(ValidationApiError) as exc_info:
        user_profiles.prepare_profile_avatar_upload(
            user_id=uuid4(),
            avatar_id=uuid4(),
            original_filename="avatar.txt",
            content_type="text/plain",
            content=b"not an image",
        )

    assert exc_info.value.code == "VALIDATION_ERROR"
    assert exc_info.value.message == "Uploaded avatar must be a valid image"
