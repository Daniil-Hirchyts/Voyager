from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.audit_context import set_audit_context
from app.db.models import UserProfile
from app.db.repositories import UserRepository
from app.db.session import get_db_session, get_redis
from app.errors import ForbiddenError, UnauthorizedError
from app.rate_limit.limiter import limit_user_request
from app.security.jwt_validator import validate_jwt_token
from app.services.user_profiles import build_display_name, infer_name_parts_from_claims

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class AuthContext:
    user_id: UUID
    keycloak_sub: str
    roles: list[str]


async def get_auth_context(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> AuthContext:
    if not creds:
        raise UnauthorizedError("Missing bearer token")

    principal = await validate_jwt_token(creds.credentials)
    claims = principal.claims
    raw_email = claims.get("email")
    email = raw_email.strip() if isinstance(raw_email, str) and raw_email.strip() else None
    raw_display_name = (
        claims.get("name")
        or claims.get("preferred_username")
        or claims.get("sub")
    )
    claim_display_name = (
        raw_display_name.strip()
        if isinstance(raw_display_name, str) and raw_display_name.strip()
        else principal.sub
    )
    first_name, last_name = infer_name_parts_from_claims(claims)
    display_name = build_display_name(
        first_name=first_name,
        last_name=last_name,
        fallback=claim_display_name,
    )

    result = await db.execute(select(UserProfile).where(UserProfile.keycloak_sub == principal.sub))
    user = result.scalar_one_or_none()
    if not user:
        user = UserProfile(
            keycloak_sub=principal.sub,
            email=email,
            first_name=first_name,
            last_name=last_name,
            display_name=display_name,
            preferences_json={},
        )
        db.add(user)
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            result = await db.execute(select(UserProfile).where(UserProfile.keycloak_sub == principal.sub))
            user = result.scalar_one()
            await UserRepository.sync_identity(
                db,
                user,
                email=email,
                first_name=first_name,
                last_name=last_name,
                display_name=display_name,
            )
    else:
        await UserRepository.sync_identity(
            db,
            user,
            email=email,
            first_name=first_name,
            last_name=last_name,
            display_name=display_name,
        )

    await set_audit_context(
        db,
        user_id=user.id,
        correlation_id=getattr(request.state, "trace_id", None),
        request_path=request.url.path,
    )

    settings = get_settings()
    await limit_user_request(
        redis, str(user.id), request.url.path, settings.rate_limit_user_per_min
    )

    return AuthContext(user_id=user.id, keycloak_sub=principal.sub, roles=principal.roles)


async def get_admin_auth_context(
    auth: AuthContext = Depends(get_auth_context),
) -> AuthContext:
    if "admin" not in auth.roles:
        raise ForbiddenError("Admin role is required")
    return auth
