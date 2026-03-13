from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services import planner_assistant


def _message(
    *,
    role: str,
    thread_id,
    status: str = "complete",
    parts: list[dict] | None = None,
    metadata: dict | None = None,
    source_job_id=None,
):
    timestamp = datetime.now(UTC)
    return SimpleNamespace(
        id=uuid4(),
        thread_id=thread_id,
        role=role,
        status=status,
        parts_json=parts or [],
        metadata_json=metadata or {},
        source_job_id=source_job_id,
        created_at=timestamp,
        updated_at=timestamp,
    )


async def _fake_update_message(_db, message, **kwargs):
    if "status" in kwargs:
        message.status = kwargs["status"]
    if "parts" in kwargs:
        message.parts_json = kwargs["parts"]
    if "metadata" in kwargs:
        message.metadata_json = kwargs["metadata"]
    if "source_job_id" in kwargs:
        message.source_job_id = kwargs["source_job_id"]
    message.updated_at = datetime.now(UTC)
    return message


@pytest.mark.anyio
async def test_handle_command_executes_non_destructive_tool(monkeypatch):
    thread_id = uuid4()
    emitted = []
    created_messages = [
      _message(
          role="user",
          thread_id=thread_id,
          parts=[{"type": "text", "text": "/snapshot"}],
          metadata={"kind": "command"},
      ),
      _message(role="assistant", thread_id=thread_id, status="running", metadata={"kind": "command"}),
    ]

    async def _fake_create_message(_db, **kwargs):
        message = created_messages.pop(0)
        message.status = kwargs.get("status", message.status)
        message.parts_json = kwargs.get("parts", message.parts_json)
        message.metadata_json = kwargs.get("metadata", message.metadata_json)
        return message

    async def _fake_execute_tool_call(
        _db,
        *,
        redis,
        user_id,
        trip_id,
        thread_id,
        tool_name,
        arguments,
        request_text,
    ):
        assert redis is not None
        assert user_id is not None
        assert trip_id is not None
        assert thread_id is not None
        assert tool_name == "read_trip_snapshot"
        assert arguments == {}
        assert request_text == "/snapshot"
        return {"trip": {"title": "Paris"}, "days": [{}, {}], "inbox_activities": []}, []

    monkeypatch.setattr(
        planner_assistant.AssistantRepository,
        "create_message",
        _fake_create_message,
    )
    monkeypatch.setattr(
        planner_assistant.AssistantRepository,
        "update_message",
        _fake_update_message,
    )
    monkeypatch.setattr(
        planner_assistant,
        "_execute_tool_call",
        _fake_execute_tool_call,
    )

    async def _emit(message):
        emitted.append(message)

    session = planner_assistant.PlannerAssistantSession(
        db=object(),
        redis=object(),
        user_id=uuid4(),
        trip_id=uuid4(),
        thread_id=thread_id,
        emit=_emit,
    )

    await session.handle_command(
        client_message_id=uuid4(),
        command_name="snapshot",
        args={},
    )

    assert [message.role for message in emitted] == ["user", "assistant", "assistant", "assistant"]
    final_message = emitted[-1]
    assert final_message.status == "complete"
    assert any(
        part.get("type") == "tool-call" and part.get("toolName") == "read_trip_snapshot"
        for part in final_message.parts
    )
    assert any(
        part.get("type") == "data" and part.get("name") == "planner-result"
        for part in final_message.parts
    )
    assert any(
        part.get("type") == "text"
        and "Loaded the latest trip snapshot" in str(part.get("text") or "")
        for part in final_message.parts
    )


@pytest.mark.anyio
async def test_handle_command_requires_confirmation_for_delete_activity(monkeypatch):
    thread_id = uuid4()
    emitted = []
    created_messages = [
      _message(
          role="user",
          thread_id=thread_id,
          parts=[{"type": "text", "text": '/delete_activity {"activity_id":"activity-1"}'}],
          metadata={"kind": "command"},
      ),
      _message(role="assistant", thread_id=thread_id, status="running", metadata={"kind": "command"}),
    ]

    async def _fake_create_message(_db, **kwargs):
        message = created_messages.pop(0)
        message.status = kwargs.get("status", message.status)
        message.parts_json = kwargs.get("parts", message.parts_json)
        message.metadata_json = kwargs.get("metadata", message.metadata_json)
        return message

    async def _unexpected_execute_tool_call(*args, **kwargs):
        raise AssertionError("destructive command should pause for confirmation")

    monkeypatch.setattr(
        planner_assistant.AssistantRepository,
        "create_message",
        _fake_create_message,
    )
    monkeypatch.setattr(
        planner_assistant.AssistantRepository,
        "update_message",
        _fake_update_message,
    )
    monkeypatch.setattr(
        planner_assistant,
        "_execute_tool_call",
        _unexpected_execute_tool_call,
    )

    async def _emit(message):
        emitted.append(message)

    session = planner_assistant.PlannerAssistantSession(
        db=object(),
        redis=object(),
        user_id=uuid4(),
        trip_id=uuid4(),
        thread_id=thread_id,
        emit=_emit,
    )

    await session.handle_command(
        client_message_id=uuid4(),
        command_name="delete_activity",
        args={"activity_id": "activity-1"},
    )

    assert [message.role for message in emitted] == ["user", "assistant", "assistant"]
    final_message = emitted[-1]
    assert final_message.status == "requires_action"
    assert any(
        part.get("type") == "tool-call"
        and part.get("toolName") == "delete_activity"
        and isinstance(part.get("interrupt"), dict)
        for part in final_message.parts
    )
    assert final_message.metadata["pending_confirmation"]["tool_name"] == "delete_activity"


@pytest.mark.anyio
async def test_stream_assistant_messages_routes_command_requests(monkeypatch):
    captured: dict[str, object] = {}
    thread_id = uuid4()

    async def _fake_get_or_create_thread(_db, *, user_id, trip_id):
        assert user_id is not None
        assert trip_id is not None
        return SimpleNamespace(id=thread_id)

    async def _fake_handle_command(self, *, client_message_id, command_name, args):
        captured["client_message_id"] = client_message_id
        captured["command_name"] = command_name
        captured["args"] = args

    monkeypatch.setattr(
        planner_assistant.AssistantRepository,
        "get_or_create_thread",
        _fake_get_or_create_thread,
    )
    monkeypatch.setattr(
        planner_assistant.PlannerAssistantSession,
        "handle_command",
        _fake_handle_command,
    )

    client_message_id = uuid4()
    events = [
        event
        async for event in planner_assistant.stream_assistant_messages(
            db=object(),
            redis=object(),
            user_id=uuid4(),
            trip_id=uuid4(),
            client_message_id=client_message_id,
            text=None,
            confirmation=None,
            command={"name": "snapshot", "args": {}},
        )
    ]

    assert captured == {
        "client_message_id": client_message_id,
        "command_name": "snapshot",
        "args": {},
    }
    assert events == [{"type": planner_assistant.STREAM_EVENT_DONE}]
