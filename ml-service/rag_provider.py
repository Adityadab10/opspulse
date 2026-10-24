"""Provider-isolated, OpenAI-compatible LLM adapter for AI Analyst."""

from __future__ import annotations

import os
import logging
from typing import Any

import requests


logger = logging.getLogger(__name__)


class ProviderUnavailable(RuntimeError):
    """Raised when the configured provider cannot be called safely."""


def _provider_config() -> tuple[str, str, str]:
    api_key = os.getenv("AI_ANALYST_LLM_API_KEY") or os.getenv("OPENROUTER_API_KEY")
    base_url = os.getenv("AI_ANALYST_LLM_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
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
    if response.status_code == 401 or response.status_code == 403:
        return "AI Analyst provider authorization failed"
    if response.status_code == 400:
        return "AI Analyst provider rejected the request"
    try:
        data = response.json()
    except ValueError:
        return f"AI Analyst provider returned HTTP {response.status_code}"

    return f"AI Analyst provider returned HTTP {response.status_code}"


def generate_grounded_answer(
    question: str,
    context: str,
    *,
    timeout_seconds: float = 20,
) -> str:
    api_key, base_url, model = _provider_config()
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
                    "from DOCUMENTATION explanations. Do not invent values."
                ),
            },
            {
                "role": "user",
                "content": f"Question:\n{question}\n\nEvidence:\n{context}",
            },
        ],
    }
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
        if not response.ok:
            raise ProviderUnavailable(_provider_error(response))
        try:
            data: dict[str, Any] = response.json()
        except ValueError as exc:
            logger.warning("AI Analyst provider returned invalid JSON")
            raise ProviderUnavailable(
                "AI Analyst provider returned an invalid response"
            ) from exc
        choices = data.get("choices")
        answer = (
            choices[0].get("message", {}).get("content")
            if isinstance(choices, list) and choices and isinstance(choices[0], dict)
            else None
        )
        if not isinstance(answer, str) or not answer.strip():
            logger.warning("AI Analyst provider returned an empty answer")
            raise ProviderUnavailable("AI Analyst provider returned an empty answer")
        return answer.strip()
    except requests.Timeout as exc:
        logger.warning("AI Analyst provider request timed out")
        raise ProviderUnavailable("AI Analyst provider timed out") from exc
    except requests.RequestException as exc:
        logger.warning("AI Analyst provider request failed: %s", type(exc).__name__)
        raise ProviderUnavailable("AI Analyst provider is unavailable") from exc
