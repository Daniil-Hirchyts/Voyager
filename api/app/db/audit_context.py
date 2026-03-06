import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def set_audit_context(
    db: AsyncSession,
    *,
    user_id: uuid.UUID | None,
    correlation_id: str | None,
    request_path: str | None,
) -> None:
    await db.execute(
        text(
            """
            SELECT
              set_config('voyager.audit_user_id', :user_id, true),
              set_config('voyager.audit_correlation_id', :correlation_id, true),
              set_config('voyager.audit_request_path', :request_path, true)
            """
        ),
        {
            "user_id": str(user_id) if user_id else "",
            "correlation_id": correlation_id or "",
            "request_path": request_path or "",
        },
    )

