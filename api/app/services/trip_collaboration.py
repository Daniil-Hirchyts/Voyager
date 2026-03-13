import hashlib
import hmac
import uuid
from secrets import compare_digest

from app.config import get_settings


def _signature_for_invitation(invitation_id: uuid.UUID) -> str:
    secret = get_settings().trip_invite_secret.encode("utf-8")
    message = str(invitation_id).encode("utf-8")
    return hmac.new(secret, message, hashlib.sha256).hexdigest()


def build_trip_invitation_token(invitation_id: uuid.UUID) -> str:
    return f"{invitation_id}.{_signature_for_invitation(invitation_id)}"


def hash_trip_invitation_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def validate_trip_invitation_token(token: str) -> uuid.UUID | None:
    raw_invitation_id, separator, raw_signature = token.partition(".")
    if not separator or not raw_signature:
        return None

    try:
        invitation_id = uuid.UUID(raw_invitation_id)
    except ValueError:
        return None

    if not compare_digest(raw_signature, _signature_for_invitation(invitation_id)):
        return None

    return invitation_id
