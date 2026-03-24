from __future__ import annotations

import asyncio
import contextlib
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import AssistantMessage, UserProfile
from app.db.repositories import AssistantRepository, JobRepository
from app.errors import ApiError, NotFoundError, ValidationApiError
from app.models.assistant import AssistantMessageResponse, AssistantThreadResponse
from app.rate_limit.limiter import limit_user_request
from app.services.planner_assistant_common import (
    ALLOWED_TOOL_NAMES,
    DESTRUCTIVE_TOOLS,
    DIRECT_COMMAND_TOOL_MAP,
    MAX_TOOL_TURNS,
    STREAM_EVENT_DONE,
    STREAM_EVENT_ERROR,
    STREAM_EVENT_MESSAGE_UPSERT,
    _decode_tool_arguments,
    _extract_message_text,
    _fallback_assistant_text,
    _format_command_request_text,
    _format_tool_summary,
    _jsonable,
    _message_to_llm_payload,
    _pending_confirmation_payload,
    _planner_result_part,
    _small_talk_reply,
    _string,
    _tool_call_part,
    _tool_result_content,
    _tool_supports_planner_result,
    _trim_provider_history,
    _validate_tool_name,
    assistant_message_to_response,
)
from app.services.planner_assistant_provider import _call_llm, _system_prompt
from app.services.planner_assistant_tools import _execute_tool_call
from app.services.user_preferences import resolve_assistant_llm_provider


async def get_thread_response(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    trip_id: uuid.UUID,
) -> AssistantThreadResponse:
    thread, messages = await AssistantRepository.get_thread_with_messages(
        db,
        user_id=user_id,
        trip_id=trip_id,
    )
    return AssistantThreadResponse(
        id=thread.id,
        trip_id=thread.trip_id,
        user_id=thread.user_id,
        messages=[assistant_message_to_response(message) for message in messages],
    )


async def clear_thread_messages(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    trip_id: uuid.UUID,
) -> None:
    await AssistantRepository.clear_thread_messages(db, user_id=user_id, trip_id=trip_id)


async def mirror_job_to_thread(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    trip_id: uuid.UUID,
    job_id: uuid.UUID,
    request_text: str,
    action: str,
) -> list[AssistantMessageResponse]:
    job = await JobRepository.get_job(db, user_id, job_id)
    payload = job.payload_json if isinstance(job.payload_json, dict) else {}
    if str(payload.get("trip_id") or "") != str(trip_id):
        raise NotFoundError("Job not found")

    (
        _thread,
        user_message,
        assistant_message,
    ) = await AssistantRepository.upsert_mirrored_job_messages(
        db,
        user_id=user_id,
        trip_id=trip_id,
        job_id=job_id,
        request_text=request_text,
        action=action,
    )
    responses: list[AssistantMessageResponse] = []
    if user_message is not None:
        responses.append(assistant_message_to_response(user_message))
    responses.append(assistant_message_to_response(assistant_message))
    return responses


async def append_job_progress_to_thread(
    db: AsyncSession,
    *,
    job_id: uuid.UUID,
    event: dict[str, Any],
) -> AssistantMessageResponse | None:
    message = await AssistantRepository.append_job_progress_event(db, job_id=job_id, event=event)
    if message is None:
        return None
    return assistant_message_to_response(message)


class PlannerAssistantSession:
    def __init__(
        self,
        *,
        db: AsyncSession,
        redis: Redis,
        user_id: uuid.UUID,
        trip_id: uuid.UUID,
        thread_id: uuid.UUID,
        emit: Callable[[AssistantMessageResponse], Awaitable[None]],
    ) -> None:
        self._db = db
        self._redis = redis
        self._user_id = user_id
        self._trip_id = trip_id
        self._thread_id = thread_id
        self._emit = emit

    async def _emit_message(self, message: AssistantMessage) -> None:
        await self._emit(assistant_message_to_response(message))

    async def _create_assistant_message(
        self, *, metadata: dict[str, Any] | None = None
    ) -> AssistantMessage:
        message = await AssistantRepository.create_message(
            self._db,
            thread_id=self._thread_id,
            role="assistant",
            parts=[],
            metadata=metadata or {"kind": "chat"},
            status="running",
        )
        await self._emit_message(message)
        return message

    async def _prepare_confirmation(
        self,
        *,
        message: AssistantMessage,
        tool_name: str,
        tool_call_id: str,
        args: dict[str, Any],
        confirmation_text: str,
        interrupt_payload: dict[str, Any],
    ) -> None:
        parts = list(message.parts_json or [])
        parts.append({"type": "text", "text": confirmation_text})
        parts.append(
            _tool_call_part(
                tool_call_id=tool_call_id,
                tool_name=tool_name,
                args=args,
                interrupt=interrupt_payload,
            )
        )
        await AssistantRepository.update_message(
            self._db,
            message,
            status="requires_action",
            parts=parts,
            metadata={
                **(message.metadata_json or {}),
                "kind": message.metadata_json.get("kind", "chat")
                if isinstance(message.metadata_json, dict)
                else "chat",
                "pending_confirmation": interrupt_payload,
            },
        )
        await self._emit_message(message)

    async def _run_direct_tool_call(
        self,
        *,
        message: AssistantMessage,
        tool_name: str,
        args: dict[str, Any],
        request_text: str,
    ) -> None:
        tool_call_id = str(uuid.uuid4())
        parts = list(message.parts_json or [])
        parts.append(_tool_call_part(tool_call_id=tool_call_id, tool_name=tool_name, args=args))
        await AssistantRepository.update_message(
            self._db,
            message,
            status="running",
            parts=parts,
        )
        await self._emit_message(message)

        try:
            result, extra_messages = await _execute_tool_call(
                self._db,
                redis=self._redis,
                user_id=self._user_id,
                trip_id=self._trip_id,
                thread_id=self._thread_id,
                tool_name=tool_name,
                arguments=args,
                request_text=request_text,
            )
        except Exception as exc:
            parts[-1] = _tool_call_part(
                tool_call_id=tool_call_id,
                tool_name=tool_name,
                args=args,
                result={"error": {"message": str(exc)}},
                is_error=True,
            )
            parts.append({"type": "text", "text": f"Tool failed: {exc}"})
            await AssistantRepository.update_message(
                self._db,
                message,
                status="incomplete",
                parts=parts,
            )
            await self._emit_message(message)
            return

        parts[-1] = _tool_call_part(
            tool_call_id=tool_call_id,
            tool_name=tool_name,
            args=args,
            result=result,
        )
        if _tool_supports_planner_result(tool_name):
            parts.append(_planner_result_part(tool_name, result))
        parts.append({"type": "text", "text": _format_tool_summary(tool_name, result)})
        await AssistantRepository.update_message(
            self._db,
            message,
            status="complete",
            parts=parts,
        )
        await self._emit_message(message)
        for extra_message in extra_messages:
            await self._emit(extra_message)

    async def handle_user_turn(
        self,
        *,
        client_message_id: uuid.UUID | None,
        text: str,
    ) -> None:
        request_text = text.strip()
        if not request_text:
            raise ValidationApiError("text is required")
        settings = get_settings()
        if len(request_text) > settings.assistant_max_input_chars:
            raise ValidationApiError(
                "text is too long",
                {"max_chars": settings.assistant_max_input_chars},
            )

        user = await self._db.get(UserProfile, self._user_id)
        llm_provider = resolve_assistant_llm_provider(
            user.preferences_json if user and user.preferences_json else None
        )

        thread, history = await AssistantRepository.get_thread_with_messages(
            self._db,
            user_id=self._user_id,
            trip_id=self._trip_id,
        )
        user_message = await AssistantRepository.create_message(
            self._db,
            thread_id=thread.id,
            role="user",
            parts=[{"type": "text", "text": request_text}],
            metadata={"kind": "chat"},
            status="complete",
            message_id=client_message_id,
        )
        await self._emit_message(user_message)

        assistant_message = await self._create_assistant_message(metadata={"kind": "chat"})
        direct_reply = _small_talk_reply(request_text)
        if direct_reply:
            await AssistantRepository.update_message(
                self._db,
                assistant_message,
                status="complete",
                parts=[{"type": "text", "text": direct_reply}],
            )
            await self._emit_message(assistant_message)
            return

        provider_history: list[dict[str, Any]] = [{"role": "system", "content": _system_prompt()}]
        for item in history:
            payload = _message_to_llm_payload(item)
            if payload is not None:
                provider_history.append(payload)
        provider_history.append({"role": "user", "content": request_text})
        provider_history = _trim_provider_history(provider_history)

        for _ in range(MAX_TOOL_TURNS):
            provider_message = await _call_llm(history=provider_history, llm_provider=llm_provider)
            tool_calls = provider_message.get("tool_calls")
            if isinstance(tool_calls, list) and tool_calls:
                provider_history.append(
                    {
                        "role": "assistant",
                        "content": _extract_message_text(provider_message.get("content")) or "",
                        "tool_calls": tool_calls,
                    }
                )
                for tool_call in tool_calls:
                    if not isinstance(tool_call, dict):
                        continue
                    call_id = _string(tool_call.get("id")) or str(uuid.uuid4())
                    function = tool_call.get("function")
                    if not isinstance(function, dict):
                        continue
                    tool_name = _string(function.get("name")) or "tool"
                    args = _decode_tool_arguments(function.get("arguments"))

                    if tool_name not in ALLOWED_TOOL_NAMES:
                        blocked_result = {
                            "error": {
                                "message": f"Tool '{tool_name}' is not allowed",
                            }
                        }
                        parts = list(assistant_message.parts_json or [])
                        parts.append(
                            _tool_call_part(
                                tool_call_id=call_id,
                                tool_name=tool_name,
                                args=args,
                                result=blocked_result,
                                is_error=True,
                            )
                        )
                        parts.append(
                            {
                                "type": "text",
                                "text": f"Blocked unsupported tool request: {tool_name}.",
                            }
                        )
                        await AssistantRepository.update_message(
                            self._db,
                            assistant_message,
                            status="running",
                            parts=parts,
                        )
                        await self._emit_message(assistant_message)
                        provider_history.append(
                            {
                                "role": "tool",
                                "tool_call_id": call_id,
                                "name": tool_name,
                                "content": _tool_result_content(blocked_result),
                            }
                        )
                        continue

                    if tool_name in DESTRUCTIVE_TOOLS or (
                        tool_name == "generate_itinerary"
                        and str(args.get("mode") or "").lower() == "replace"
                    ):
                        interrupt_payload, confirmation_text = _pending_confirmation_payload(
                            tool_name="replace_itinerary"
                            if tool_name == "generate_itinerary"
                            and str(args.get("mode") or "").lower() == "replace"
                            else tool_name,
                            tool_call_id=call_id,
                            args=args,
                        )
                        await self._prepare_confirmation(
                            message=assistant_message,
                            tool_name=tool_name,
                            tool_call_id=call_id,
                            args=args,
                            confirmation_text=confirmation_text,
                            interrupt_payload=interrupt_payload,
                        )
                        return

                    parts = list(assistant_message.parts_json or [])
                    parts.append(
                        _tool_call_part(tool_call_id=call_id, tool_name=tool_name, args=args)
                    )
                    await AssistantRepository.update_message(
                        self._db,
                        assistant_message,
                        status="running",
                        parts=parts,
                    )
                    await self._emit_message(assistant_message)

                    try:
                        result, extra_messages = await _execute_tool_call(
                            self._db,
                            redis=self._redis,
                            user_id=self._user_id,
                            trip_id=self._trip_id,
                            thread_id=self._thread_id,
                            tool_name=tool_name,
                            arguments=args,
                            request_text=request_text,
                        )
                        parts[-1] = _tool_call_part(
                            tool_call_id=call_id,
                            tool_name=tool_name,
                            args=args,
                            result=result,
                        )
                        if _tool_supports_planner_result(tool_name):
                            parts.append(_planner_result_part(tool_name, result))
                        await AssistantRepository.update_message(
                            self._db,
                            assistant_message,
                            status="running",
                            parts=parts,
                        )
                        await self._emit_message(assistant_message)
                        for extra_message in extra_messages:
                            await self._emit(extra_message)
                        provider_history.append(
                            {
                                "role": "tool",
                                "tool_call_id": call_id,
                                "name": tool_name,
                                "content": _tool_result_content(result),
                            }
                        )
                    except Exception as exc:
                        result = {"error": {"message": str(exc)}}
                        parts[-1] = _tool_call_part(
                            tool_call_id=call_id,
                            tool_name=tool_name,
                            args=args,
                            result=result,
                            is_error=True,
                        )
                        parts.append({"type": "text", "text": f"Tool failed: {exc}"})
                        await AssistantRepository.update_message(
                            self._db,
                            assistant_message,
                            status="incomplete",
                            parts=parts,
                        )
                        await self._emit_message(assistant_message)
                        return
                continue

            content = _extract_message_text(provider_message.get("content"))
            parts = list(assistant_message.parts_json or [])
            if content:
                parts.append({"type": "text", "text": content})
            elif parts:
                fallback_text = _fallback_assistant_text(parts)
                if fallback_text:
                    parts.append({"type": "text", "text": fallback_text})
            else:
                parts.append({"type": "text", "text": "I’m ready to help with this trip."})
            await AssistantRepository.update_message(
                self._db,
                assistant_message,
                status="complete",
                parts=parts,
            )
            await self._emit_message(assistant_message)
            return

        parts = list(assistant_message.parts_json or [])
        parts.append(
            {
                "type": "text",
                "text": "I hit the tool-turn limit for this request. Please narrow the task and try again.",
            }
        )
        await AssistantRepository.update_message(
            self._db,
            assistant_message,
            status="incomplete",
            parts=parts,
        )
        await self._emit_message(assistant_message)

    async def handle_command(
        self,
        *,
        client_message_id: uuid.UUID | None,
        command_name: str,
        args: dict[str, Any],
    ) -> None:
        normalized_name = command_name.strip().lower()
        tool_name = DIRECT_COMMAND_TOOL_MAP.get(normalized_name)
        if tool_name is None:
            raise ValidationApiError(f"Unsupported assistant command: {command_name}")

        request_text = _format_command_request_text(normalized_name, args)
        settings = get_settings()
        if len(request_text) > settings.assistant_max_input_chars:
            raise ValidationApiError(
                "command payload is too long",
                {"max_chars": settings.assistant_max_input_chars},
            )
        user_message = await AssistantRepository.create_message(
            self._db,
            thread_id=self._thread_id,
            role="user",
            parts=[{"type": "text", "text": request_text}],
            metadata={
                "kind": "command",
                "command_name": normalized_name,
                "command_args": _jsonable(args),
            },
            status="complete",
            message_id=client_message_id,
        )
        await self._emit_message(user_message)

        assistant_message = await self._create_assistant_message(
            metadata={"kind": "command", "command_name": normalized_name}
        )

        if tool_name in DESTRUCTIVE_TOOLS:
            interrupt_payload, confirmation_text = _pending_confirmation_payload(
                tool_name=tool_name,
                tool_call_id=str(uuid.uuid4()),
                args=args,
            )
            await self._prepare_confirmation(
                message=assistant_message,
                tool_name=tool_name,
                tool_call_id=str(interrupt_payload["tool_call_id"]),
                args=args,
                confirmation_text=confirmation_text,
                interrupt_payload=interrupt_payload,
            )
            return

        await self._run_direct_tool_call(
            message=assistant_message,
            tool_name=tool_name,
            args=args,
            request_text=request_text,
        )

    async def handle_confirmation(
        self,
        *,
        message_id: uuid.UUID,
        tool_call_id: str,
        confirmed: bool,
    ) -> None:
        message = await AssistantRepository.get_message_for_trip(
            self._db,
            user_id=self._user_id,
            trip_id=self._trip_id,
            message_id=message_id,
        )
        parts = list(message.parts_json or [])
        tool_index = next(
            (
                idx
                for idx, part in enumerate(parts)
                if isinstance(part, dict)
                and part.get("type") == "tool-call"
                and str(part.get("toolCallId")) == tool_call_id
            ),
            -1,
        )
        if tool_index < 0:
            raise ValidationApiError("Pending tool call not found")
        tool_part = parts[tool_index]
        interrupt = tool_part.get("interrupt")
        if not isinstance(interrupt, dict):
            raise ValidationApiError("This tool call does not require confirmation")
        payload = interrupt.get("payload")
        if not isinstance(payload, dict):
            raise ValidationApiError("Invalid confirmation payload")
        tool_name = (
            _string(payload.get("tool_name")) or _string(tool_part.get("toolName")) or "tool"
        )
        resolved_tool_name = (
            _string(tool_part.get("toolName")) or "generate_itinerary"
            if tool_name == "replace_itinerary"
            else tool_name
        )
        _validate_tool_name(resolved_tool_name)
        args = payload.get("args") if isinstance(payload.get("args"), dict) else {}

        if not confirmed:
            tool_part["result"] = {"cancelled": True}
            tool_part.pop("interrupt", None)
            parts[tool_index] = tool_part
            parts.append({"type": "text", "text": "Cancelled. I did not make any changes."})
            await AssistantRepository.update_message(
                self._db,
                message,
                status="complete",
                parts=parts,
                metadata={**(message.metadata_json or {}), "pending_confirmation": None},
            )
            await self._emit_message(message)
            return

        await AssistantRepository.update_message(
            self._db,
            message,
            status="running",
            metadata={**(message.metadata_json or {}), "pending_confirmation": None},
        )
        await self._emit_message(message)

        try:
            result, extra_messages = await _execute_tool_call(
                self._db,
                redis=self._redis,
                user_id=self._user_id,
                trip_id=self._trip_id,
                thread_id=message.thread_id,
                tool_name=resolved_tool_name,
                arguments=args,
                request_text="Confirmed assistant action",
            )
        except Exception as exc:
            tool_part["result"] = {"error": {"message": str(exc)}}
            tool_part["isError"] = True
            tool_part.pop("interrupt", None)
            parts[tool_index] = tool_part
            parts.append({"type": "text", "text": f"Confirmed action failed: {exc}"})
            await AssistantRepository.update_message(
                self._db,
                message,
                status="incomplete",
                parts=parts,
            )
            await self._emit_message(message)
            return

        tool_part["result"] = _jsonable(result)
        tool_part.pop("interrupt", None)
        parts[tool_index] = tool_part
        if _tool_supports_planner_result(tool_name):
            parts.append(_planner_result_part(tool_name, result))
        parts.append({"type": "text", "text": _format_tool_summary(tool_name, result)})
        await AssistantRepository.update_message(
            self._db,
            message,
            status="complete",
            parts=parts,
        )
        await self._emit_message(message)
        for extra_message in extra_messages:
            await self._emit(extra_message)


async def stream_assistant_messages(
    db: AsyncSession,
    *,
    redis: Redis,
    user_id: uuid.UUID,
    trip_id: uuid.UUID,
    client_message_id: uuid.UUID | None,
    text: str | None,
    confirmation: dict[str, Any] | None,
    command: dict[str, Any] | None,
) -> AsyncIterator[dict[str, Any]]:
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    async def emit(message: AssistantMessageResponse) -> None:
        await queue.put(
            {
                "type": STREAM_EVENT_MESSAGE_UPSERT,
                "message": message.model_dump(mode="json"),
            }
        )

    async def run() -> None:
        settings = get_settings()
        await limit_user_request(
            redis,
            str(user_id),
            "assistant:turn",
            settings.rate_limit_assistant_turns_per_min,
            window_seconds=60,
        )
        thread = await AssistantRepository.get_or_create_thread(
            db, user_id=user_id, trip_id=trip_id
        )
        session = PlannerAssistantSession(
            db=db,
            redis=redis,
            user_id=user_id,
            trip_id=trip_id,
            thread_id=thread.id,
            emit=emit,
        )
        try:
            if confirmation is not None:
                await session.handle_confirmation(
                    message_id=uuid.UUID(str(confirmation["message_id"])),
                    tool_call_id=str(confirmation["tool_call_id"]),
                    confirmed=bool(confirmation["confirmed"]),
                )
            elif command is not None:
                await session.handle_command(
                    client_message_id=client_message_id,
                    command_name=str(command.get("name") or ""),
                    args=command.get("args") if isinstance(command.get("args"), dict) else {},
                )
            else:
                await session.handle_user_turn(client_message_id=client_message_id, text=text or "")
            await queue.put({"type": STREAM_EVENT_DONE})
        except Exception as exc:
            error_message = exc.message if isinstance(exc, ApiError) else str(exc)
            await queue.put(
                {
                    "type": STREAM_EVENT_ERROR,
                    "error": {
                        "message": error_message,
                        "code": getattr(exc, "code", "ASSISTANT_ERROR"),
                    },
                }
            )
        finally:
            await queue.put(None)

    task = asyncio.create_task(run())
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield item
    finally:
        if not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
