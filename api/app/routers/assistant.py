import json
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session, get_redis
from app.models.assistant import (
    AssistantMessageResponse,
    AssistantMessageStreamRequest,
    AssistantMirrorJobRequest,
    AssistantThreadResponse,
)
from app.security.dependencies import AuthContext, get_auth_context
from app.services.planner_assistant import (
    get_thread_response,
    mirror_job_to_thread,
    stream_assistant_messages,
)

router = APIRouter(prefix="/trips/{trip_id}/assistant", tags=["assistant"])


@router.get("/thread", response_model=AssistantThreadResponse)
async def get_assistant_thread(
    trip_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
) -> AssistantThreadResponse:
    return await get_thread_response(db, user_id=auth.user_id, trip_id=trip_id)


@router.post("/mirror-job", response_model=list[AssistantMessageResponse])
async def mirror_assistant_job(
    trip_id: uuid.UUID,
    payload: AssistantMirrorJobRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
) -> list[AssistantMessageResponse]:
    return await mirror_job_to_thread(
        db,
        user_id=auth.user_id,
        trip_id=trip_id,
        job_id=payload.job_id,
        request_text=payload.request_text,
        action=payload.action,
    )


@router.post("/messages/stream")
async def stream_trip_assistant_messages(
    trip_id: uuid.UUID,
    payload: AssistantMessageStreamRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> StreamingResponse:
    async def generate() -> AsyncIterator[str]:
        async for event in stream_assistant_messages(
            db,
            redis=redis,
            user_id=auth.user_id,
            trip_id=trip_id,
            client_message_id=payload.client_message_id,
            text=payload.text,
            confirmation=payload.confirmation.model_dump(mode="json")
            if payload.confirmation is not None
            else None,
            command=payload.command.model_dump(mode="json") if payload.command is not None else None,
        ):
            yield f"data: {json.dumps(event, default=str)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
