"""Provider-isolated, OpenAI-compatible LLM adapter for AI Analyst."""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from typing import Any

import requests


logger = logging.getLogger(__name__)


class ProviderUnavailable(RuntimeError):
    """Raised when the configured provider cannot be called safely."""


def _provider_config() -> tuple[str, str, str]:
    api_key = os.getenv("AI_ANALYST_LLM_API_KEY") or os.getenv("OPENROUTER_API_KEY")
    base_url = os.getenv(
        "AI_ANALYST_LLM_BASE_URL",
        "https://openrouter.ai/api/v1",
    ).rstrip("/")
    model = os.getenv("AI_ANALYST_LLM_MODEL", "deepseek/deepseek-v4.1")
    if not api_key:
        raise ProviderUnavailable(
            "AI Analyst provider is not configured; set AI_ANALYST_LLM_API_KEY"
        )
    return api_key, base_url, model


def _provider_error(response: requests.Response) -> str:
    logger.warning("AI Analyst provider returned HTTP status %s", response.status_code)
    if response.status_code == 429:
        return "AI Analyst provider is rate-limited; try again later"
    if response.status_code >= 500:
        return "AI Analyst provider is temporarily unavailable"
    if response.status_code in (401, 403):
        return "AI Analyst provider authorization failed"
    if response.status_code == 400:
        return "AI Analyst provider rejected the request"
    return f"AI Analyst provider returned HTTP {response.status_code}"


def _message_text(message: Any) -> tuple[str | None, str]:
    if not isinstance(message, dict):
        return None, "missing_message"
    if message.get("refusal"):
        return None, "refusal"
    content = message.get("content")
    if content is None:
        return None, "null_content"
    if isinstance(content, str):
        return (content, "text") if content.strip() else (None, "whitespace_content")
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
        text = "".join(parts)
        return (text, "content_parts") if text.strip() else (None, "empty_content_parts")
    return None, "unsupported_content"


def _completion_content(data: Any) -> tuple[str | None, str, str | None, Any]:
    if not isinstance(data, dict):
        return None, "invalid_body", None, None
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        return None, "empty_choices", None, data.get("usage")
    choice = choices[0]
    if not isinstance(choice, dict):
        return None, "invalid_choice", None, data.get("usage")
    text, structure = _message_text(choice.get("message"))
    return text, structure, choice.get("finish_reason"), data.get("usage")


def _log_completion(
    request_id: str,
    stage: str,
    attempt: int,
    status: int,
    structure: str,
    finish_reason: Any,
    usage: Any,
    started: float,
) -> None:
    usage_tokens = usage.get("completion_tokens") if isinstance(usage, dict) else None
    logger.info(
        "AI Analyst request_id=%s stage=%s attempt=%s status=%s structure=%s "
        "usable=%s finish_reason=%s completion_tokens=%s latency_ms=%.1f",
        request_id,
        stage,
        attempt,
        status,
        structure,
        structure in {"text", "content_parts"},
        finish_reason if isinstance(finish_reason, str) else "unknown",
        usage_tokens if isinstance(usage_tokens, int) else "unknown",
        (time.perf_counter() - started) * 1000,
    )


def _request_completion(
    payload: dict[str, Any],
    *,
    stage: str,
    timeout_seconds: float,
    allow_empty_retry: bool,
) -> tuple[dict[str, Any], str]:
    api_key, base_url, _ = _provider_config()
    attempts = 2 if allow_empty_retry else 1
    empty_structures = {
        "empty_choices",
        "missing_message",
        "null_content",
        "whitespace_content",
        "empty_content_parts",
    }
    request_id = uuid.uuid4().hex[:12]
    for attempt in range(attempts):
        started = time.perf_counter()
        try:
            response = requests.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=timeout_seconds,
            )
        except requests.Timeout as exc:
            logger.warning("AI Analyst stage=%s timeout attempt=%s", stage, attempt + 1)
            raise ProviderUnavailable(
                f"AI Analyst {stage.replace('_', ' ')} timed out"
            ) from exc
        except requests.RequestException as exc:
            logger.warning(
                "AI Analyst stage=%s request_failed=%s attempt=%s",
                stage,
                type(exc).__name__,
                attempt + 1,
            )
            raise ProviderUnavailable("AI Analyst provider is unavailable") from exc

        if not response.ok:
            raise ProviderUnavailable(_provider_error(response))
        try:
            data = response.json()
        except ValueError as exc:
            logger.warning("AI Analyst stage=%s invalid_json", stage)
            raise ProviderUnavailable(
                "AI Analyst provider returned an invalid response"
            ) from exc

        text, structure, finish_reason, usage = _completion_content(data)
        _log_completion(
            request_id,
            stage,
            attempt + 1,
            getattr(response, "status_code", 200),
            structure,
            finish_reason,
            usage,
            started,
        )
        if finish_reason == "length":
            raise ProviderUnavailable(
                "AI Analyst provider stopped at the output limit"
            )
        if finish_reason == "content_filter" or structure == "refusal":
            raise ProviderUnavailable("AI Analyst provider refused the response")
        if text and text.strip():
            return data, text.strip()
        if allow_empty_retry and attempt == 0 and structure in empty_structures:
            logger.warning(
                "AI Analyst stage=%s retrying_empty structure=%s",
                stage,
                structure,
            )
            continue
        if structure in empty_structures:
            raise ProviderUnavailable(
                f"AI Analyst provider returned empty answer after retry ({structure})"
            )
        raise ProviderUnavailable(
            f"AI Analyst provider returned unusable content ({structure})"
        )
    raise ProviderUnavailable("AI Analyst provider returned unusable content")


def generate_grounded_answer(
    question: str,
    context: str,
    *,
    timeout_seconds: float = 20,
) -> str:
    _, _, model = _provider_config()
    payload = {
        "model": model,
        "temperature": 0,
        "max_tokens": 500,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are the OpsPulse AI Analyst. Answer only from the supplied "
                    "evidence. Numerical business claims must come from LIVE_DATABASE "
                    "evidence. If evidence is missing, say so. Distinguish live facts "
                    "from DOCUMENTATION explanations. Do not invent values. Cite "
                    "evidence inline using [LIVE_DATABASE] or [DOCUMENTATION:<id>] "
                    "when an identifier is present. Never invent citations."
                ),
            },
            {
                "role": "user",
                "content": f"Question:\n{question}\n\nEvidence:\n{context}",
            },
        ],
    }
    _, answer = _request_completion(
        payload,
        stage="answer_generation",
        timeout_seconds=timeout_seconds,
        allow_empty_retry=True,
    )
    return answer


def plan_question(question: str, *, timeout_seconds: float = 12) -> dict[str, Any]:
    _, _, model = _provider_config()
    payload = {
        "model": model,
        "temperature": 0,
        "max_tokens": 350,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are an OpsPulse query planner. Return only a JSON object. "
                    "Select only supported retrieval tasks and evidence sources. "
                    "Never invent IDs, schema names, SQL, or results."
                ),
            },
            {"role": "user", "content": question},
        ],
    }
    _, content = _request_completion(
        payload,
        stage="planning",
        timeout_seconds=timeout_seconds,
        allow_empty_retry=False,
    )
    try:
        planned = json.loads(content)
    except json.JSONDecodeError as exc:
        logger.warning("AI Analyst stage=planning malformed_json")
        raise ProviderUnavailable(
            "AI Analyst planner returned malformed JSON"
        ) from exc
    if not isinstance(planned, dict):
        raise ProviderUnavailable("AI Analyst planner returned an invalid plan")
    return planned
