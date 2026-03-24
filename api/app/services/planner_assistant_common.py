from __future__ import annotations

import json
import re
import uuid
from datetime import UTC, date, datetime, time
from decimal import Decimal
from typing import Any

from app.config import get_settings
from app.db.models import AssistantMessage
from app.errors import ValidationApiError
from app.models.assistant import AssistantMessageResponse

STREAM_EVENT_MESSAGE_UPSERT = "message_upsert"
STREAM_EVENT_DONE = "done"
STREAM_EVENT_ERROR = "error"
MAX_TOOL_TURNS = 8
DESTRUCTIVE_TOOLS = {"delete_activity", "reset_itinerary", "replace_itinerary"}
PLANNER_RESULT_TOOLS = {"create_activity", "update_activity", "move_activity", "delete_activity"}
ALLOWED_TOOL_NAMES = {
    "read_trip_snapshot",
    "search_places",
    "create_activity",
    "update_activity",
    "move_activity",
    "delete_activity",
    "generate_itinerary",
    "reset_itinerary",
}
DIRECT_COMMAND_TOOL_MAP = {
    "snapshot": "read_trip_snapshot",
    "search_places": "search_places",
    "create_activity": "create_activity",
    "update_activity": "update_activity",
    "move_activity": "move_activity",
    "delete_activity": "delete_activity",
}

GREETING_INPUT_RE = re.compile(
    r"^(hi|hello|hey|good morning|good afternoon|good evening)[!. ]*$",
    re.I,
)
THANKS_INPUT_RE = re.compile(r"^(thanks|thank you|thx)[!. ]*$", re.I)


def _jsonable(value: Any) -> Any:
    try:
        from pydantic import BaseModel as _BaseModel  # noqa: PLC0415

        if isinstance(value, _BaseModel):
            return _jsonable(value.model_dump())
    except ImportError:
        pass
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    if isinstance(value, tuple):
        return [_jsonable(item) for item in value]
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, time):
        return value.isoformat()
    return value


def _string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    cleaned = str(value).strip()
    return cleaned or None


def _extract_message_text(content: Any) -> str | None:
    if isinstance(content, str):
        stripped = content.strip()
        return stripped or None
    if isinstance(content, dict):
        if content.get("type") in {"text", "output_text"} and isinstance(content.get("text"), str):
            stripped = content["text"].strip()
            return stripped or None
        if isinstance(content.get("content"), str):
            stripped = content["content"].strip()
            return stripped or None
    if isinstance(content, list):
        parts: list[str] = []
        for entry in content:
            if not isinstance(entry, dict):
                continue
            if entry.get("type") in {"text", "output_text"} and isinstance(entry.get("text"), str):
                parts.append(entry["text"])
        joined = "".join(parts).strip()
        return joined or None
    return None


def _small_talk_reply(text: str) -> str | None:
    normalized = text.strip()
    if not normalized:
        return None
    if GREETING_INPUT_RE.fullmatch(normalized):
        return (
            "Hi. I can help with this trip when you're ready. Ask a question, search for a place, "
            "or use /generate or /reset."
        )
    if THANKS_INPUT_RE.fullmatch(normalized):
        return "You're welcome. Ask if you want to adjust the itinerary or generate a new pass."
    return None


def _float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def assistant_message_to_response(message: AssistantMessage) -> AssistantMessageResponse:
    return AssistantMessageResponse(
        id=message.id,
        thread_id=message.thread_id,
        role=message.role,
        status=message.status,
        parts=[part for part in message.parts_json or [] if isinstance(part, dict)],
        metadata=message.metadata_json or {},
        source_job_id=message.source_job_id,
        created_at=message.created_at,
        updated_at=message.updated_at,
    )


def _extract_text(parts: list[dict] | None) -> str | None:
    if not parts:
        return None
    texts = [str(part.get("text") or "").strip() for part in parts if part.get("type") == "text"]
    joined = "\n".join(item for item in texts if item)
    return joined or None


def _message_to_llm_payload(message: AssistantMessage) -> dict[str, Any] | None:
    if message.role == "user":
        text = _extract_text(message.parts_json)
        if text:
            return {"role": "user", "content": text}
        return None

    if message.role == "assistant":
        text = _extract_text(message.parts_json)
        if text:
            return {"role": "assistant", "content": text}
    return None


def _tool_result_content(payload: dict[str, Any]) -> str:
    return json.dumps(_jsonable(payload), separators=(",", ":"), ensure_ascii=True)


def _trim_provider_history(history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    settings = get_settings()
    max_messages = max(4, settings.assistant_max_history_messages)
    if len(history) <= max_messages:
        return history

    system_message = history[0] if history and history[0].get("role") == "system" else None
    trimmed = history[-max_messages:]
    if system_message is None:
        return trimmed
    return [system_message, *trimmed[-(max_messages - 1) :]]


def _validate_tool_name(tool_name: str) -> None:
    if tool_name not in ALLOWED_TOOL_NAMES:
        raise ValidationApiError(f"Unsupported tool {tool_name}")


def _tool_call_part(
    *,
    tool_call_id: str,
    tool_name: str,
    args: dict[str, Any],
    result: dict[str, Any] | None = None,
    is_error: bool = False,
    interrupt: dict[str, Any] | None = None,
) -> dict[str, Any]:
    part = {
        "type": "tool-call",
        "toolCallId": tool_call_id,
        "toolName": tool_name,
        "args": _jsonable(args) if isinstance(args, dict) else {},
        "argsText": _tool_result_content(args if isinstance(args, dict) else {}),
    }
    if result is not None:
        part["result"] = _jsonable(result)
    if is_error:
        part["isError"] = True
    if interrupt is not None:
        part["interrupt"] = {"type": "human", "payload": _jsonable(interrupt)}
    return part


def _planner_result_part(operation: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "data",
        "name": "planner-result",
        "data": {"operation": operation, **_jsonable(payload)},
    }


def _job_progress_part(
    *,
    job_id: uuid.UUID,
    action: str,
    request_text: str,
) -> dict[str, Any]:
    return {
        "type": "data",
        "name": "job-progress",
        "data": {
            "job_id": str(job_id),
            "action": action,
            "request_text": request_text,
            "job_status": "PENDING",
            "events": [],
            "summary": None,
        },
    }


def _format_tool_summary(tool_name: str, result: dict[str, Any]) -> str:
    if tool_name == "read_trip_snapshot":
        days = result.get("days") or []
        return f"Loaded the latest trip snapshot with {len(days)} day(s)."
    if tool_name == "search_places":
        items = result.get("items") or []
        return f"Found {len(items)} place option(s)."
    if tool_name == "create_activity":
        activity = result.get("activity") or {}
        title = _string(activity.get("title")) or "the activity"
        return f"Added {title}."
    if tool_name in {"update_activity", "move_activity"}:
        activity = result.get("activity") or {}
        title = _string(activity.get("title")) or "the activity"
        return f"Updated {title}."
    if tool_name == "delete_activity":
        return "Deleted the activity."
    if tool_name in {"generate_itinerary", "reset_itinerary"}:
        return "Queued the planner job and added its live progress below."
    return "Completed the requested tool action."


def _tool_supports_planner_result(tool_name: str) -> bool:
    return tool_name in PLANNER_RESULT_TOOLS


def _fallback_assistant_text(parts: list[dict[str, Any]]) -> str | None:
    for part in reversed(parts):
        if not isinstance(part, dict) or part.get("type") != "tool-call":
            continue
        tool_name = _string(part.get("toolName"))
        if not tool_name:
            continue
        result = part.get("result")
        result_payload = result if isinstance(result, dict) else {}
        if part.get("isError"):
            error = result_payload.get("error")
            if isinstance(error, dict):
                message = _string(error.get("message"))
                if message:
                    return f"{_format_tool_summary(tool_name, result_payload)} {message}"
            return _format_tool_summary(tool_name, result_payload)
        if isinstance(result, dict):
            return _format_tool_summary(tool_name, result_payload)
    return None


def _format_command_request_text(command_name: str, args: dict[str, Any]) -> str:
    if command_name == "snapshot":
        return "/snapshot"
    if command_name == "search_places":
        query = _string(args.get("query")) or ""
        return f"/search_places {query}".strip()
    if args:
        return (
            f"/{command_name} "
            f"{json.dumps(_jsonable(args), separators=(',', ':'), ensure_ascii=True)}"
        )
    return f"/{command_name}"


def _decode_tool_arguments(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _pending_confirmation_payload(
    *,
    tool_name: str,
    tool_call_id: str,
    args: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    if tool_name == "delete_activity":
        return (
            {"tool_name": tool_name, "tool_call_id": tool_call_id, "args": args},
            "Deleting this activity will remove it from the planner. Confirm to continue.",
        )
    if tool_name == "reset_itinerary":
        return (
            {"tool_name": tool_name, "tool_call_id": tool_call_id, "args": args},
            "Reset will remove every activity from the selected days. Confirm to continue.",
        )
    return (
        {"tool_name": tool_name, "tool_call_id": tool_call_id, "args": args},
        "Replace mode can overwrite generated activities. Confirm to continue.",
    )
