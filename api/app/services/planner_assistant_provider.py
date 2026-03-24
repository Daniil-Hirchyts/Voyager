from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from app.config import get_settings
from app.errors import ServiceUnavailableError
from app.services.llm_retry import llm_rate_limit_retry_delay_sec
from app.services.planner_assistant_tools import _tool_definitions

logger = logging.getLogger(__name__)


def _system_prompt() -> str:
    return (
        "You are Voyager's planner assistant. "
        "Help the user understand and edit a trip itinerary. "
        "Use tools only when you need current trip data or when the user requests a mutation. "
        "For simple greetings, acknowledgements, or small talk, reply directly without tools. "
        "If the user asks about places, options, or ideas, inspect the trip context and search places before answering. "
        "Always call search_places before recommending specific new venues so the UI can show grounded place cards. "
        "Never invent activity ids, day ids, or place ids. "
        "For destructive actions, still call the tool; the system will request confirmation. "
        "When a tool already completed the user's request, answer briefly and concretely."
    )


async def _call_llm(
    *,
    history: list[dict[str, Any]],
    llm_provider: str = "openrouter",
) -> dict[str, Any]:
    settings = get_settings()

    if llm_provider == "mistral":
        models = settings.itinerary_mistral_model_order()
        api_key = settings.llm_mistral_api_key
        base_url = settings.llm_mistral_base_url
        timeout_sec = settings.llm_mistral_timeout_sec
    elif llm_provider == "gemini":
        models = settings.itinerary_gemini_model_order()
        api_key = settings.llm_gemini_api_key
        base_url = settings.llm_gemini_base_url
        timeout_sec = settings.llm_gemini_timeout_sec
    else:
        llm_provider = "openrouter"
        models = settings.itinerary_llm_model_order()
        api_key = settings.llm_openrouter_api_key
        base_url = settings.llm_openrouter_base_url
        timeout_sec = settings.llm_openrouter_timeout_sec

    if not api_key:
        raise ServiceUnavailableError(
            "INTEGRATION_NOT_CONFIGURED",
            f"{llm_provider} API key is not configured",
            {"missing_env_vars": [f"VOYAGER_LLM_{llm_provider.upper()}_API_KEY"]},
        )

    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    last_error: Exception | None = None

    async with httpx.AsyncClient(timeout=timeout_sec) as client:
        for model in models:
            payload = {
                "model": model,
                "temperature": 0.2,
                "messages": history,
                "tools": _tool_definitions(),
                "tool_choice": "auto",
                "max_tokens": max(64, settings.assistant_max_response_tokens),
            }
            rate_limit_attempts = 0
            while True:
                try:
                    response = await client.post(endpoint, headers=headers, json=payload)
                    response.raise_for_status()
                    data = response.json()
                    choices = data.get("choices")
                    if not isinstance(choices, list) or not choices:
                        raise ValueError("Missing choices in provider response")
                    first = choices[0]
                    if not isinstance(first, dict) or not isinstance(first.get("message"), dict):
                        raise ValueError("Missing assistant message in provider response")
                    message = first["message"]
                    message["_model"] = model
                    return message
                except Exception as exc:  # pragma: no cover - defensive provider failover
                    if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 429:
                        if rate_limit_attempts < settings.llm_rate_limit_max_retries:
                            rate_limit_attempts += 1
                            delay_sec = llm_rate_limit_retry_delay_sec(
                                attempt=rate_limit_attempts,
                                retry_after=exc.response.headers.get("Retry-After"),
                                base_delay_ms=settings.llm_rate_limit_base_delay_ms,
                                max_delay_ms=settings.llm_rate_limit_max_delay_ms,
                            )
                            logger.warning(
                                "planner_assistant_provider_rate_limited_retrying",
                                extra={
                                    "trace_id": "-",
                                    "provider": llm_provider,
                                    "model": model,
                                    "attempt": rate_limit_attempts,
                                    "delay_sec": delay_sec,
                                },
                                exc_info=True,
                            )
                            await asyncio.sleep(delay_sec)
                            continue
                        last_error = ServiceUnavailableError(
                            "UPSTREAM_PROVIDER_RATE_LIMIT",
                            f"{llm_provider.capitalize()} is temporarily unavailable right now.",
                            {"provider": llm_provider, "status_code": 429},
                        )
                        logger.warning(
                            "planner_assistant_provider_rate_limited_exhausted",
                            extra={"trace_id": "-", "provider": llm_provider, "model": model},
                            exc_info=True,
                        )
                        break
                    last_error = exc
                    logger.warning("planner_assistant_provider_failed", exc_info=True)
                    break

    if isinstance(last_error, ServiceUnavailableError):
        raise last_error
    raise ServiceUnavailableError(
        "UPSTREAM_PROVIDER_ERROR",
        "Planner assistant provider request failed",
        {"error": str(last_error) if last_error else "unknown"},
    )
