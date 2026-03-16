import asyncio
import uuid

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.repositories import UserRepository
from app.db.session import get_db_session
from app.errors import ServiceUnavailableError, ValidationApiError
from app.models.users import UserProfilePatchRequest, UserProfileResponse
from app.security.dependencies import AuthContext, get_auth_context
from app.services.keycloak_admin import sync_keycloak_user_names
from app.services.trip_assets import delete_trip_asset_objects
from app.services.user_profiles import (
    build_display_name,
    build_user_profile_response,
    prepare_profile_avatar_upload,
    upload_prepared_profile_avatar,
)

router = APIRouter(prefix="/users", tags=["users"])

_UNSET = object()


def _storage_unavailable(exc: Exception) -> ServiceUnavailableError:
    return ServiceUnavailableError(
        code="OBJECT_STORAGE_UNAVAILABLE",
        message="RustFS object storage is unavailable",
        details={"provider": "rustfs", "error": exc.__class__.__name__},
    )


def _normalize_name(value: str | None, field_name: str) -> str:
    if value is None:
        raise ValidationApiError(f"{field_name} is required")
    normalized = value.strip()
    if not normalized:
        raise ValidationApiError(f"{field_name} must not be empty")
    return normalized


@router.get("/profile", response_model=UserProfileResponse)
async def get_profile(
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
) -> UserProfileResponse:
    user = await UserRepository.get_by_sub(db, auth.keycloak_sub)
    assert user is not None
    return build_user_profile_response(user)


@router.patch("/profile", response_model=UserProfileResponse)
async def patch_profile(
    payload: UserProfilePatchRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
) -> UserProfileResponse:
    user = await UserRepository.get_by_sub(db, auth.keycloak_sub)
    assert user is not None

    first_name = _UNSET
    last_name = _UNSET
    display_name = _UNSET
    preferences = _UNSET

    if "first_name" in payload.model_fields_set:
        first_name = _normalize_name(payload.first_name, "first_name")
    if "last_name" in payload.model_fields_set:
        last_name = _normalize_name(payload.last_name, "last_name")
    if "preferences" in payload.model_fields_set:
        if payload.preferences is None:
            raise ValidationApiError("preferences must not be null")
        preferences = payload.preferences

    name_requested = (
        "first_name" in payload.model_fields_set or "last_name" in payload.model_fields_set
    )
    next_first_name = user.first_name if first_name is _UNSET else first_name
    next_last_name = user.last_name if last_name is _UNSET else last_name
    if name_requested and (not next_first_name or not next_last_name):
        raise ValidationApiError(
            "Both first_name and last_name are required when updating the account name"
        )

    if next_first_name and next_last_name:
        display_name = build_display_name(
            first_name=next_first_name,
            last_name=next_last_name,
            fallback=user.display_name,
        )

    names_changed = name_requested and (
        next_first_name != user.first_name or next_last_name != user.last_name
    )

    patch_kwargs: dict[str, object] = {}
    if first_name is not _UNSET:
        patch_kwargs["first_name"] = first_name
    if last_name is not _UNSET:
        patch_kwargs["last_name"] = last_name
    if display_name is not _UNSET:
        patch_kwargs["display_name"] = display_name
    if preferences is not _UNSET:
        patch_kwargs["preferences"] = preferences

    user = await UserRepository.patch_profile(db, user, **patch_kwargs)

    if names_changed and next_first_name and next_last_name:
        await sync_keycloak_user_names(
            user_id=auth.keycloak_sub,
            first_name=next_first_name,
            last_name=next_last_name,
        )

    return build_user_profile_response(user)


@router.post("/profile/avatar", response_model=UserProfileResponse)
async def upload_profile_avatar(
    file: UploadFile = File(...),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
) -> UserProfileResponse:
    filename = (file.filename or "").strip()
    if not filename:
        raise ValidationApiError("Uploaded file must have a filename")

    user = await UserRepository.get_by_sub(db, auth.keycloak_sub)
    assert user is not None

    settings = get_settings()
    content = await file.read(settings.object_storage_max_upload_bytes + 1)
    await file.close()
    if not content:
        raise ValidationApiError("Uploaded file is empty")
    if len(content) > settings.object_storage_max_upload_bytes:
        raise ValidationApiError(
            "Uploaded file exceeds the maximum allowed size",
            {"max_bytes": settings.object_storage_max_upload_bytes},
        )

    previous_object_key = user.avatar_object_key
    previous_thumbnail_key = user.avatar_thumbnail_object_key
    prepared = prepare_profile_avatar_upload(
        user_id=user.id,
        avatar_id=uuid.uuid4(),
        original_filename=filename,
        content_type=file.content_type,
        content=content,
    )

    try:
        await asyncio.to_thread(upload_prepared_profile_avatar, prepared)
        user = await UserRepository.update_avatar(
            db,
            user,
            object_key=prepared.object_key,
            thumbnail_object_key=prepared.thumbnail_object_key,
            content_type=prepared.content_type,
            size_bytes=prepared.size_bytes,
            sha256=prepared.sha256,
        )
    except (BotoCoreError, ClientError, OSError) as exc:
        raise _storage_unavailable(exc) from exc
    except Exception:
        try:
            await asyncio.to_thread(
                delete_trip_asset_objects,
                object_key=prepared.object_key,
                thumbnail_object_key=prepared.thumbnail_object_key,
            )
        except Exception:
            pass
        raise

    if previous_object_key:
        try:
            await asyncio.to_thread(
                delete_trip_asset_objects,
                object_key=previous_object_key,
                thumbnail_object_key=previous_thumbnail_key,
            )
        except Exception:
            pass

    return build_user_profile_response(user)


@router.delete("/profile/avatar", response_model=UserProfileResponse)
async def delete_profile_avatar(
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
) -> UserProfileResponse:
    user = await UserRepository.get_by_sub(db, auth.keycloak_sub)
    assert user is not None

    previous_object_key = user.avatar_object_key
    previous_thumbnail_key = user.avatar_thumbnail_object_key
    user = await UserRepository.clear_avatar(db, user)

    if previous_object_key:
        try:
            await asyncio.to_thread(
                delete_trip_asset_objects,
                object_key=previous_object_key,
                thumbnail_object_key=previous_thumbnail_key,
            )
        except (BotoCoreError, ClientError, OSError) as exc:
            raise _storage_unavailable(exc) from exc

    return build_user_profile_response(user)
