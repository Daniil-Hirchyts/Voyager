from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.repositories import UserRepository
from app.db.session import get_db_session
from app.models.users import UserProfilePatchRequest, UserProfileResponse
from app.security.dependencies import AuthContext, get_auth_context

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/profile", response_model=UserProfileResponse)
async def get_profile(
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
) -> UserProfileResponse:
    user = await UserRepository.get_by_sub(db, auth.keycloak_sub)
    assert user is not None
    return UserProfileResponse(
        id=user.id,
        keycloak_sub=user.keycloak_sub,
        preferences=user.preferences_json,
        created_at=user.created_at,
    )


@router.patch("/profile", response_model=UserProfileResponse)
async def patch_profile(
    payload: UserProfilePatchRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
) -> UserProfileResponse:
    user = await UserRepository.get_by_sub(db, auth.keycloak_sub)
    assert user is not None
    user = await UserRepository.update_preferences(db, user, payload.preferences)
    return UserProfileResponse(
        id=user.id,
        keycloak_sub=user.keycloak_sub,
        preferences=user.preferences_json,
        created_at=user.created_at,
    )
