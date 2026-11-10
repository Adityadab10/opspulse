import os
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
from functools import lru_cache

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL is not set in environment")

TEST_LEGACY_ID = "test123"


@lru_cache(maxsize=32)
def table_has_tenant_id(table_name: str) -> bool:
    """Check if table has a tenant_id column in PostgreSQL; results are cached."""
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


@contextmanager
def _connection():
    connection = psycopg2.connect(DATABASE_URL, connect_timeout=5)
    try:
        yield connection
    finally:
        connection.close()


@contextmanager
def _cursor():
    with _connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            yield cursor


def _safe_str(value):
    return "" if value is None else str(value).strip()


def _normalize_product_id(product_id):
    if isinstance(product_id, dict):
        if "id" in product_id:
            product_id = product_id["id"]
        elif "_id" in product_id:
            product_id = product_id["_id"]

    normalized = _safe_str(product_id)
    if not normalized:
        raise ValueError("productId is empty after normalization")

    return normalized


def resolve_product(product_id: str, tenant_id: str | None = None):
    normalized = _normalize_product_id(product_id)

    if tenant_id:
        if not table_has_tenant_id("products"):
            raise RuntimeError(
                "Tenant isolation schema not established: 'products' table lacks 'tenant_id'. "
                "Apply migration 005_tenant_isolation.sql."
            )
        sql = """
            SELECT id, name, category, legacy_mongo_id
            FROM products
            WHERE (id::text = %s OR legacy_mongo_id = %s) AND tenant_id = %s
            ORDER BY CASE WHEN id::text = %s THEN 0 ELSE 1 END
            LIMIT 2
        """
        params = (normalized, normalized, tenant_id, normalized)
    else:
        sql = """
            SELECT id, name, category, legacy_mongo_id
            FROM products
            WHERE id::text = %s OR legacy_mongo_id = %s
            ORDER BY CASE WHEN id::text = %s THEN 0 ELSE 1 END
            LIMIT 2
        """
        params = (normalized, normalized, normalized)

    with _cursor() as cursor:
        cursor.execute(sql, params)
        rows = cursor.fetchall()

    if not rows:
        return None

    for row in rows:
        if str(row["id"]) == normalized:
            return row

    return rows[0]


def get_db_diagnostics(tenant_id: str | None = None):
    diagnostics = {
        "database": "postgresql",
        "database_configured": bool(DATABASE_URL),
        "connected": False,
        "tenant_id": tenant_id,
        "products_count": None,
        "sales_count": None,
        "predictions_count": None,
        "alerts_count": None,
        "error": None,
    }

    try:
        with _cursor() as cursor:
            cursor.execute("SELECT 1 AS ok")
            has_tenant = table_has_tenant_id("products") and bool(tenant_id)
            if has_tenant:
                cursor.execute("SELECT COUNT(*) AS cnt FROM products WHERE tenant_id = %s", (tenant_id,))
                diagnostics["products_count"] = int(cursor.fetchone()["cnt"])
                cursor.execute("SELECT COUNT(*) AS cnt FROM sales WHERE tenant_id = %s", (tenant_id,))
                diagnostics["sales_count"] = int(cursor.fetchone()["cnt"])
                cursor.execute("SELECT COUNT(*) AS cnt FROM predictions WHERE tenant_id = %s", (tenant_id,))
                diagnostics["predictions_count"] = int(cursor.fetchone()["cnt"])
                cursor.execute("SELECT COUNT(*) AS cnt FROM alerts WHERE tenant_id = %s", (tenant_id,))
                diagnostics["alerts_count"] = int(cursor.fetchone()["cnt"])
            else:
                cursor.execute("SELECT COUNT(*) AS cnt FROM products")
                diagnostics["products_count"] = int(cursor.fetchone()["cnt"])
                cursor.execute("SELECT COUNT(*) AS cnt FROM sales")
                diagnostics["sales_count"] = int(cursor.fetchone()["cnt"])
                cursor.execute("SELECT COUNT(*) AS cnt FROM predictions")
                diagnostics["predictions_count"] = int(cursor.fetchone()["cnt"])
                cursor.execute("SELECT COUNT(*) AS cnt FROM alerts")
                diagnostics["alerts_count"] = int(cursor.fetchone()["cnt"])
        diagnostics["connected"] = True
    except Exception as exc:
        diagnostics["error"] = "Database diagnostics unavailable"

    return diagnostics


def get_raw_sales_data(product_id: str, limit: int = 100, tenant_id: str | None = None):
    product = resolve_product(product_id, tenant_id=tenant_id)
    if not product:
        raise ValueError(f"Product not found for productId: {_normalize_product_id(product_id)}")

    if tenant_id:
        if not table_has_tenant_id("sales"):
            raise RuntimeError(
                "Tenant isolation schema not established: 'sales' table lacks 'tenant_id'. "
                "Apply migration 005_tenant_isolation.sql."
            )
        sql = (
            "SELECT id, product_id, sale_date AS date, quantity, created_at "
            "FROM sales WHERE product_id = %s AND tenant_id = %s ORDER BY sale_date ASC LIMIT %s"
        )
        params = [str(product["id"]), tenant_id, int(limit)]
    else:
        sql = (
            "SELECT id, product_id, sale_date AS date, quantity, created_at "
            "FROM sales WHERE product_id = %s ORDER BY sale_date ASC LIMIT %s"
        )
        params = [str(product["id"]), int(limit)]

    query = {"sql": sql, "params": params}

    with _cursor() as cursor:
        cursor.execute(query["sql"], tuple(query["params"]))
        docs = cursor.fetchall()

    return docs, query, str(product["id"])


def get_sales_data(product_id: str, tenant_id: str | None = None):
    normalized = _normalize_product_id(product_id)
    product = resolve_product(normalized, tenant_id=tenant_id)

    if not product:
        raise ValueError(f"No product found for productId: {normalized}")

    if product.get("legacy_mongo_id") == TEST_LEGACY_ID:
        raise ValueError(f"Product {normalized} is a test record and cannot be forecast")

    if tenant_id:
        if not table_has_tenant_id("sales"):
            raise RuntimeError(
                "Tenant isolation schema not established: 'sales' table lacks 'tenant_id'. "
                "Apply migration 005_tenant_isolation.sql."
            )
        sql = """
            SELECT sale_date AS date, quantity
            FROM sales
            WHERE product_id = %s AND tenant_id = %s
            ORDER BY sale_date ASC
        """
        params = (str(product["id"]), tenant_id)
    else:
        sql = """
            SELECT sale_date AS date, quantity
            FROM sales
            WHERE product_id = %s
            ORDER BY sale_date ASC
        """
        params = (str(product["id"]),)

    with _cursor() as cursor:
        cursor.execute(sql, params)
        docs = cursor.fetchall()

    print(f"\n[postgres] get_sales_data product_id={normalized} resolved={product['id']} tenant_id={tenant_id}")
    print(f"[postgres] matched sales rows: {len(docs)}")

    if not docs:
        raise ValueError(f"No sales data found for productId: {normalized}")

    normalized_docs = []
    invalid_rows = []
    for index, row in enumerate(docs):
        sale_date = row.get("date")
        quantity = row.get("quantity")

        if isinstance(sale_date, datetime):
            sale_date = sale_date.date()
        elif not isinstance(sale_date, date):
            sale_date = None

        if sale_date is None or quantity is None:
            invalid_rows.append(index)
            continue

        normalized_docs.append({"date": sale_date, "quantity": quantity})

    if invalid_rows:
        raise ValueError(f"Sales rows contain invalid date/quantity values: {invalid_rows}")

    return normalized_docs


def get_product_name(product_id: str, tenant_id: str | None = None):
    try:
        product = resolve_product(product_id, tenant_id=tenant_id)
        name = product.get("name") if product else None
        if isinstance(name, str):
            normalized = name.strip()
            return normalized or None
        return None
    except Exception as exc:
        print("[postgres] Failed to resolve product name:", str(exc))
        return None


def serialize_value(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {key: serialize_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [serialize_value(item) for item in value]
    return value
