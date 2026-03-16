import uuid
from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.redis_helpers import cache_delete_prefix
from app.db.models import UserProfile
from app.db.repositories import AuditRepository, TripRepository
from app.db.session import get_db_session, get_redis
from app.errors import ConflictError, ForbiddenError, NotFoundError, ValidationApiError
from app.models.trips import (
    TripAccessRole,
    TripCollaboratorResponse,
    TripInvitationCreateRequest,
    TripInvitationCreateResponse,
    TripInvitationPreviewResponse,
    TripInvitationResponse,
    TripResponse,
    TripSharingResponse,
)
from app.security.dependencies import AuthContext, get_auth_context
from app.services.trip_collaboration import (
    build_trip_invitation_token,
    hash_trip_invitation_token,
    validate_trip_invitation_token,
)

router = APIRouter(tags=["trips"])


def _invite_path(invitation_id: uuid.UUID) -> str:
    return f"/app/invites/{build_trip_invitation_token(invitation_id)}"


def _trip_response(
    trip,
    *,
    current_user_role: str,
    collaborator_count: int,
) -> TripResponse:
    return TripResponse(
        id=trip.id,
        user_id=trip.user_id,
        title=trip.title,
        destination_text=trip.destination_text,
        start_date=trip.start_date,
        end_date=trip.end_date,
        budget_amount=trip.budget_amount,
        budget_currency=trip.budget_currency,
        trip_type=trip.trip_type,
        route_travel_mode=trip.route_travel_mode,
        current_user_role=current_user_role,
        collaborator_count=collaborator_count,
        version=trip.version,
        created_at=trip.created_at,
        updated_at=trip.updated_at,
    )


def _collaborator_response(
    *,
    collaborator_id: uuid.UUID | None,
    trip_id: uuid.UUID,
    user,
    role: str,
    invited_by_user_id: uuid.UUID | None,
    created_at: datetime,
    updated_at: datetime,
) -> TripCollaboratorResponse:
    return TripCollaboratorResponse(
        id=collaborator_id,
        trip_id=trip_id,
        user_id=user.id,
        role=role,
        email=user.email,
        display_name=user.display_name,
        invited_by_user_id=invited_by_user_id,
        created_at=created_at,
        updated_at=updated_at,
    )


def _invitation_response(invitation) -> TripInvitationResponse:
    return TripInvitationResponse(
        id=invitation.id,
        trip_id=invitation.trip_id,
        created_by_user_id=invitation.created_by_user_id,
        role=invitation.role.value if hasattr(invitation.role, "value") else str(invitation.role),
        invite_path=_invite_path(invitation.id),
        accepted_at=invitation.accepted_at,
        revoked_at=invitation.revoked_at,
        created_at=invitation.created_at,
        updated_at=invitation.updated_at,
    )


def _collaborator_payload(item) -> dict:
    return {
        "id": str(item.id),
        "trip_id": str(item.trip_id),
        "user_id": str(item.user_id),
        "role": item.role.value if hasattr(item.role, "value") else str(item.role),
        "email": item.user.email if item.user is not None else None,
        "display_name": item.user.display_name if item.user is not None else "Traveler",
        "invited_by_user_id": str(item.invited_by_user_id) if item.invited_by_user_id else None,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
    }


def _invitation_payload(item) -> dict:
    return {
        "id": str(item.id),
        "trip_id": str(item.trip_id),
        "created_by_user_id": str(item.created_by_user_id),
        "role": item.role.value if hasattr(item.role, "value") else str(item.role),
        "invite_path": _invite_path(item.id),
        "accepted_at": item.accepted_at.isoformat() if item.accepted_at else None,
        "revoked_at": item.revoked_at.isoformat() if item.revoked_at else None,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
    }


async def _invalidate_trip_collaboration_caches(redis: Redis) -> None:
    await cache_delete_prefix(redis, "trip:get:")
    await cache_delete_prefix(redis, "trip:list:")
    await cache_delete_prefix(redis, "audit:list:")


async def _load_accessible_trip(
    db: AsyncSession,
    *,
    auth: AuthContext,
    trip_id: uuid.UUID,
):
    return await TripRepository.get_trip_access_summary(db, user_id=auth.user_id, trip_id=trip_id)


async def _load_owner_only_trip(
    db: AsyncSession,
    *,
    auth: AuthContext,
    trip_id: uuid.UUID,
):
    summary = await _load_accessible_trip(db, auth=auth, trip_id=trip_id)
    if summary.current_user_role.value != TripAccessRole.OWNER.value:
        raise ForbiddenError("Only trip owners can manage sharing")
    return summary


@router.get("/trips/{trip_id}/sharing", response_model=TripSharingResponse)
async def get_trip_sharing(
    trip_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
) -> TripSharingResponse:
    summary = await _load_accessible_trip(db, auth=auth, trip_id=trip_id)
    owner = await db.get(UserProfile, summary.trip.user_id)
    if owner is None:
        raise NotFoundError("Trip owner not found")

    collaborators = await TripRepository.list_trip_collaborators(db, trip_id=trip_id)
    pending_invitations = []
    if summary.current_user_role.value == TripAccessRole.OWNER.value:
        pending_invitations = await TripRepository.list_pending_trip_invitations(
            db, trip_id=trip_id
        )

    return TripSharingResponse(
        trip_id=trip_id,
        current_user_role=summary.current_user_role.value,
        collaborators=[
            _collaborator_response(
                collaborator_id=None,
                trip_id=trip_id,
                user=owner,
                role=TripAccessRole.OWNER.value,
                invited_by_user_id=None,
                created_at=summary.trip.created_at,
                updated_at=summary.trip.updated_at,
            ),
            *[
                _collaborator_response(
                    collaborator_id=item.id,
                    trip_id=item.trip_id,
                    user=item.user,
                    role=item.role.value if hasattr(item.role, "value") else str(item.role),
                    invited_by_user_id=item.invited_by_user_id,
                    created_at=item.created_at,
                    updated_at=item.updated_at,
                )
                for item in collaborators
                if item.user is not None
            ],
        ],
        pending_invitations=[_invitation_response(item) for item in pending_invitations],
    )


@router.post(
    "/trips/{trip_id}/invites", response_model=TripInvitationCreateResponse, status_code=201
)
async def create_trip_invitation(
    trip_id: uuid.UUID,
    payload: TripInvitationCreateRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> TripInvitationCreateResponse:
    await _load_owner_only_trip(db, auth=auth, trip_id=trip_id)
    if payload.role != TripAccessRole.EDITOR:
        raise ValidationApiError("Only editor invitations are supported")

    invitation_id = uuid.uuid4()
    token = build_trip_invitation_token(invitation_id)
    invitation = await TripRepository.create_trip_invitation(
        db,
        invitation_id=invitation_id,
        trip_id=trip_id,
        created_by_user_id=auth.user_id,
        role=payload.role.value,
        token_hash=hash_trip_invitation_token(token),
    )
    await AuditRepository.create_entry(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        entity_type="trip_invitation",
        entity_id=invitation.id,
        action="CREATE",
        before=None,
        after=_invitation_payload(invitation),
    )
    await _invalidate_trip_collaboration_caches(redis)
    return TripInvitationCreateResponse(invitation=_invitation_response(invitation))


@router.delete("/trips/{trip_id}/invites/{invitation_id}", status_code=204)
async def revoke_trip_invitation(
    trip_id: uuid.UUID,
    invitation_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> Response:
    await _load_owner_only_trip(db, auth=auth, trip_id=trip_id)
    invitation = await TripRepository.get_trip_invitation_by_id(db, invitation_id=invitation_id)
    if invitation is None or invitation.trip_id != trip_id:
        raise NotFoundError("Trip invitation not found")
    if invitation.accepted_at is not None:
        raise ConflictError(
            code="TRIP_INVITATION_ALREADY_USED",
            message="Trip invitation has already been accepted",
        )
    if invitation.revoked_at is None:
        before = _invitation_payload(invitation)
        invitation = await TripRepository.revoke_trip_invitation(db, invitation_id=invitation_id)
        await AuditRepository.create_entry(
            db,
            user_id=auth.user_id,
            trip_id=trip_id,
            entity_type="trip_invitation",
            entity_id=invitation.id,
            action="REVOKE",
            before=before,
            after=_invitation_payload(invitation),
        )
        await _invalidate_trip_collaboration_caches(redis)
    return Response(status_code=204)


@router.delete("/trips/{trip_id}/collaborators/{collaborator_user_id}", status_code=204)
async def remove_trip_collaborator(
    trip_id: uuid.UUID,
    collaborator_user_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> Response:
    summary = await _load_owner_only_trip(db, auth=auth, trip_id=trip_id)
    if collaborator_user_id == summary.trip.user_id:
        raise ValidationApiError("Trip owners cannot remove themselves as collaborators")

    collaborator = await TripRepository.get_trip_collaborator(
        db,
        trip_id=trip_id,
        collaborator_user_id=collaborator_user_id,
    )
    if collaborator is None:
        raise NotFoundError("Trip collaborator not found")
    before = _collaborator_payload(collaborator)
    await TripRepository.remove_trip_collaborator(
        db,
        trip_id=trip_id,
        collaborator_user_id=collaborator_user_id,
    )
    await AuditRepository.create_entry(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        entity_type="trip_collaborator",
        entity_id=collaborator.id,
        action="DELETE",
        before=before,
        after=None,
    )
    await _invalidate_trip_collaboration_caches(redis)
    return Response(status_code=204)


def _resolve_invitation_or_raise(*, token: str, invitation):
    if invitation is None:
        raise NotFoundError("Trip invitation not found")
    if invitation.token_hash != hash_trip_invitation_token(token):
        raise NotFoundError("Trip invitation not found")
    if invitation.revoked_at is not None:
        raise ConflictError(
            code="TRIP_INVITATION_REVOKED",
            message="Trip invitation has been revoked",
        )
    if invitation.accepted_at is not None:
        raise ConflictError(
            code="TRIP_INVITATION_ALREADY_USED",
            message="Trip invitation has already been accepted",
        )
    return invitation


@router.get("/trip-invitations/{token}", response_model=TripInvitationPreviewResponse)
async def get_trip_invitation_preview(
    token: str,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
) -> TripInvitationPreviewResponse:
    invitation_id = validate_trip_invitation_token(token)
    if invitation_id is None:
        raise NotFoundError("Trip invitation not found")
    invitation = _resolve_invitation_or_raise(
        token=token,
        invitation=await TripRepository.get_trip_invitation_by_id(db, invitation_id=invitation_id),
    )
    inviter = invitation.created_by
    inviter_display_name = inviter.display_name if inviter is not None else "Traveler"
    inviter_email = inviter.email if inviter is not None else None
    return TripInvitationPreviewResponse(
        invitation_id=invitation.id,
        trip_id=invitation.trip_id,
        trip_title=invitation.trip.title,
        destination_text=invitation.trip.destination_text,
        inviter_display_name=inviter_display_name,
        inviter_email=inviter_email,
        role=invitation.role.value if hasattr(invitation.role, "value") else str(invitation.role),
        created_at=invitation.created_at,
    )


@router.post("/trip-invitations/{token}/accept", response_model=TripResponse)
async def accept_trip_invitation(
    token: str,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> TripResponse:
    invitation_id = validate_trip_invitation_token(token)
    if invitation_id is None:
        raise NotFoundError("Trip invitation not found")
    invitation = _resolve_invitation_or_raise(
        token=token,
        invitation=await TripRepository.get_trip_invitation_by_id(db, invitation_id=invitation_id),
    )
    before = _invitation_payload(invitation)
    accepted_invitation, collaborator = await TripRepository.accept_trip_invitation(
        db,
        invitation=invitation,
        accepted_by_user_id=auth.user_id,
    )
    await AuditRepository.create_entry(
        db,
        user_id=auth.user_id,
        trip_id=accepted_invitation.trip_id,
        entity_type="trip_invitation",
        entity_id=accepted_invitation.id,
        action="ACCEPT",
        before=before,
        after=_invitation_payload(accepted_invitation),
    )
    await AuditRepository.create_entry(
        db,
        user_id=auth.user_id,
        trip_id=accepted_invitation.trip_id,
        entity_type="trip_collaborator",
        entity_id=collaborator.id,
        action="CREATE",
        before=None,
        after=_collaborator_payload(collaborator),
    )
    await _invalidate_trip_collaboration_caches(redis)
    summary = await TripRepository.get_trip_access_summary(
        db,
        user_id=auth.user_id,
        trip_id=accepted_invitation.trip_id,
    )
    return _trip_response(
        summary.trip,
        current_user_role=summary.current_user_role.value,
        collaborator_count=summary.collaborator_count,
    )
