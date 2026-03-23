from __future__ import annotations

from typing import Any

DEFAULT_ASSISTANT_LLM_PROVIDER = "openrouter"
SUPPORTED_ASSISTANT_LLM_PROVIDERS = {"openrouter", "mistral", "gemini"}


def resolve_assistant_llm_provider(preferences: dict[str, Any] | None) -> str:
    if not isinstance(preferences, dict):
        return DEFAULT_ASSISTANT_LLM_PROVIDER

    voyager = preferences.get("voyager")
    voyager_payload = voyager if isinstance(voyager, dict) else {}
    voyager_assistant = voyager_payload.get("assistant")
    voyager_assistant_payload = voyager_assistant if isinstance(voyager_assistant, dict) else {}

    legacy_assistant = preferences.get("assistant")
    legacy_assistant_payload = legacy_assistant if isinstance(legacy_assistant, dict) else {}

    raw_provider = (
        voyager_assistant_payload.get("llmProvider")
        or legacy_assistant_payload.get("llmProvider")
        or DEFAULT_ASSISTANT_LLM_PROVIDER
    )
    normalized = str(raw_provider).strip().lower()
    if normalized in SUPPORTED_ASSISTANT_LLM_PROVIDERS:
        return normalized
    return DEFAULT_ASSISTANT_LLM_PROVIDER
