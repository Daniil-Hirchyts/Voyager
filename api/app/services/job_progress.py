from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.planner_assistant import append_job_progress_to_thread

logger = logging.getLogger(__name__)

PROGRESS_KEY_PREFIX = "job:progress:"
PROGRESS_TTL_SEC = 3600  # 1 hour


class ProgressTracker:
    """Emits structured progress events to a Redis list for SSE streaming."""

    def __init__(self, redis: Redis, job_id: str, db: AsyncSession | None = None) -> None:
        self._redis = redis
        self._db = db
        self._job_id = str(job_id)
        self._key = f"{PROGRESS_KEY_PREFIX}{job_id}"

    async def _emit(self, event: dict[str, Any]) -> None:
        event.setdefault("ts", datetime.now(UTC).isoformat())
        event.setdefault("event_id", str(uuid.uuid4()))
        event.setdefault("job_id", self._job_id)
        try:
            await self._redis.rpush(self._key, json.dumps(event, default=str))
            await self._redis.expire(self._key, PROGRESS_TTL_SEC)
            if self._db is not None:
                await append_job_progress_to_thread(
                    self._db,
                    job_id=uuid.UUID(self._job_id),
                    event=event,
                )
        except Exception:
            logger.warning("progress_tracker_emit_failed", exc_info=True)

    async def step(self, name: str, detail: str = "", *, phase: str | None = None) -> None:
        await self._emit({"type": "step", "name": name, "detail": detail, "phase": phase})

    async def tool_call(
        self,
        tool_name: str,
        args: dict[str, Any],
        *,
        call_id: str | None = None,
        phase: str | None = None,
    ) -> str:
        resolved_call_id = call_id or str(uuid.uuid4())
        await self._emit(
            {
                "type": "tool_call",
                "tool_name": tool_name,
                "args": args,
                "call_id": resolved_call_id,
                "phase": phase,
            }
        )
        return resolved_call_id

    async def tool_result(
        self,
        tool_name: str,
        result: dict[str, Any],
        is_error: bool = False,
        *,
        call_id: str | None = None,
        phase: str | None = None,
    ) -> None:
        await self._emit(
            {
                "type": "tool_result",
                "tool_name": tool_name,
                "result": result,
                "is_error": is_error,
                "call_id": call_id,
                "phase": phase,
            }
        )

    async def done(
        self,
        status: str,
        summary: dict[str, Any] | None = None,
        *,
        phase: str | None = None,
    ) -> None:
        await self._emit(
            {"type": "done", "status": status, "summary": summary or {}, "phase": phase}
        )
