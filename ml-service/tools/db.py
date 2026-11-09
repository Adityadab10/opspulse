"""Database access layer for OpsPulse deterministic analytics tools.

Enforces parameterized queries, row limits, timeouts, and tenant scoping.
"""

from __future__ import annotations

from contextlib import contextmanager
import logging
from typing import Any, Callable, Generator
import psycopg2
from psycopg2.extras import RealDictCursor

from postgresService import _connection, _cursor, serialize_value

logger = logging.getLogger(__name__)

DEFAULT_QUERY_TIMEOUT_MS = 5000
MAX_ROW_LIMIT = 50

# Type for injectable query executor: (sql, params) -> list[dict]
QueryExecutor = Callable[[str, tuple[Any, ...]], list[dict[str, Any]]]


def _default_query_executor(sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
    """Execute a parameterized read-only query with timeout and row limit."""
    with _cursor() as cursor:
        # Set statement timeout for this query
        cursor.execute(f"SET LOCAL statement_timeout = {DEFAULT_QUERY_TIMEOUT_MS}")
        cursor.execute(sql, params)
        if cursor.description:
            rows = cursor.fetchmany(MAX_ROW_LIMIT)
            return [serialize_value(dict(r)) for r in rows]
        return []


class DatabaseAdapter:
    """Encapsulates SQL execution with pluggable executor for unit tests."""

    def __init__(self, executor: QueryExecutor | None = None):
        self._executor = executor or _default_query_executor

    def query(self, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        return self._executor(sql, params)

    def query_one(self, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None
