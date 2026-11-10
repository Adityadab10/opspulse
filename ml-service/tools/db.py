"""Database access layer for OpsPulse deterministic analytics tools.

Enforces parameterized queries, row limits, timeouts, and tenant scoping.
"""

from __future__ import annotations

from contextlib import contextmanager
from functools import lru_cache
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


@lru_cache(maxsize=32)
def _check_table_has_tenant_id(table_name: str) -> bool:
    """Check if table has a tenant_id column in PostgreSQL; cached."""
    try:
        with _cursor() as cursor:
            cursor.execute(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = %s AND column_name = 'tenant_id'
                LIMIT 1
                """,
                (table_name,),
            )
            return bool(cursor.fetchone())
    except Exception:
        return False


def _default_query_executor(sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
    """Execute a parameterized query with timeout, row limit, and commit."""
    with _cursor() as cursor:
        # Set statement timeout for this query
        cursor.execute(f"SET LOCAL statement_timeout = {DEFAULT_QUERY_TIMEOUT_MS}")
        cursor.execute(sql, params)
        rows = []
        if cursor.description:
            rows = [serialize_value(dict(r)) for r in cursor.fetchmany(MAX_ROW_LIMIT)]
        try:
            cursor.connection.commit()
        except Exception:
            pass
        return rows


class DatabaseAdapter:
    """Encapsulates SQL execution with pluggable executor for unit tests."""

    def __init__(
        self,
        executor: QueryExecutor | None = None,
        schema_checker: Callable[[str], bool] | None = None,
    ):
        self._executor = executor or _default_query_executor
        self._schema_checker = schema_checker

    def has_tenant_column(self, table_name: str) -> bool:
        """Check if table has tenant_id column, using injected checker or DB information_schema."""
        if self._schema_checker is not None:
            return self._schema_checker(table_name)
        return _check_table_has_tenant_id(table_name)

    def query(self, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        return self._executor(sql, params)

    def query_one(self, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None
