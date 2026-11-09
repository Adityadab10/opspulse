"""Trusted internal service authentication and tenant identity middleware."""

from __future__ import annotations

import hmac
import os
import uuid
from typing import NamedTuple

from fastapi import HTTPException, Request, Security
from fastapi.security import APIKeyHeader


INTERNAL_TOKEN_HEADER = "x-ml-internal-token"
USER_ID_HEADER = "x-user-id"
TENANT_ID_HEADER = "x-tenant-id"
CORRELATION_ID_HEADER = "x-correlation-id"


class TrustedContext(NamedTuple):
    tenant_id: str
    user_id: str
    correlation_id: str


def get_expected_internal_token() -> str:
    token = os.getenv("ML_ANALYST_INTERNAL_TOKEN", "").strip()
    return token


def verify_internal_token(supplied_token: str | None) -> None:
    expected_token = get_expected_internal_token()
    if not expected_token:
        raise HTTPException(
            status_code=503,
            detail="AI Analyst authorization is not configured on ML service",
        )
    if not supplied_token or not hmac.compare_digest(supplied_token.strip(), expected_token):
        raise HTTPException(
            status_code=401,
            detail="Invalid internal authorization token",
        )


async def require_trusted_context(request: Request) -> TrustedContext:
    """Enforce trusted internal service token, caller user ID, and tenant ID."""
    token = request.headers.get(INTERNAL_TOKEN_HEADER)
    verify_internal_token(token)

    user_id = request.headers.get(USER_ID_HEADER, "").strip()
    if not user_id:
        raise HTTPException(
            status_code=401,
            detail=f"Missing required identity header: '{USER_ID_HEADER}'",
        )

    tenant_id = request.headers.get(TENANT_ID_HEADER, "").strip()
    if not tenant_id:
        raise HTTPException(
            status_code=401,
            detail=f"Missing required tenant header: '{TENANT_ID_HEADER}'",
        )

    correlation_id = (
        request.headers.get(CORRELATION_ID_HEADER, "").strip()
        or uuid.uuid4().hex[:12]
    )

    context = TrustedContext(
        tenant_id=tenant_id,
        user_id=user_id,
        correlation_id=correlation_id,
    )
    request.state.trusted_context = context
    return context
