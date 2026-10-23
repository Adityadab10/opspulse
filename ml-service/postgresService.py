import os
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL is not set in environment")

TEST_LEGACY_ID = "test123"


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


def resolve_product(product_id):
    normalized = _normalize_product_id(product_id)

    with _cursor() as cursor:
        cursor.execute(
            """
            SELECT id, name, category, legacy_mongo_id
            FROM products
            WHERE id::text = %s OR legacy_mongo_id = %s
            ORDER BY CASE WHEN id::text = %s THEN 0 ELSE 1 END
            LIMIT 2
            """,
            (normalized, normalized, normalized),
        )
        rows = cursor.fetchall()

    if not rows:
        return None

    for row in rows:
        if str(row["id"]) == normalized:
            return row

    return rows[0]


def get_db_diagnostics():
    diagnostics = {
        "database": "postgresql",
        "database_configured": bool(DATABASE_URL),
        "connected": False,
        "products_count": None,
        "sales_count": None,
        "predictions_count": None,
        "alerts_count": None,
        "error": None,
    }

    try:
        with _cursor() as cursor:
            cursor.execute("SELECT 1 AS ok")
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
        diagnostics["error"] = str(exc)

    return diagnostics


def get_raw_sales_data(product_id: str, limit: int = 100):
    product = resolve_product(product_id)
    if not product:
        raise ValueError(f"Product not found for productId: {_normalize_product_id(product_id)}")

    query = {
        "sql": (
            "SELECT id, product_id, sale_date AS date, quantity, created_at "
            "FROM sales WHERE product_id = %s ORDER BY sale_date ASC LIMIT %s"
        ),
        "params": [str(product["id"]), int(limit)],
    }

    with _cursor() as cursor:
        cursor.execute(query["sql"], tuple(query["params"]))
        docs = cursor.fetchall()

    return docs, query, str(product["id"])


def get_sales_data(product_id: str):
    normalized = _normalize_product_id(product_id)
    product = resolve_product(normalized)

    if not product:
        raise ValueError(f"No product found for productId: {normalized}")

    if product.get("legacy_mongo_id") == TEST_LEGACY_ID:
        raise ValueError(f"Product {normalized} is a test record and cannot be forecast")

    with _cursor() as cursor:
        cursor.execute(
            """
            SELECT sale_date AS date, quantity
            FROM sales
            WHERE product_id = %s
            ORDER BY sale_date ASC
            """,
            (str(product["id"]),),
        )
        docs = cursor.fetchall()

    print(f"\n[postgres] get_sales_data product_id={normalized} resolved={product['id']}")
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


def get_product_name(product_id: str):
    try:
        product = resolve_product(product_id)
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
