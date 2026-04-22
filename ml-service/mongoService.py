from pymongo import MongoClient
from bson import ObjectId
import os
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")
DB_NAME = os.getenv("MONGO_DB_NAME")

if not MONGO_URI:
    raise ValueError("MONGO_URI is not set in environment")

if not DB_NAME:
    raise ValueError("MONGO_DB_NAME is not set in environment")

client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
db = client[DB_NAME]
sales_collection = db["sales"]
products_collection = db["products"]


def _safe_str(value):
    return "" if value is None else str(value).strip()


def _normalize_product_id(product_id):
    """Normalize incoming product_id from string/ObjectId/object payloads."""
    if isinstance(product_id, dict):
        if "_id" in product_id:
            product_id = product_id["_id"]
        elif "$oid" in product_id:
            product_id = product_id["$oid"]

    if isinstance(product_id, ObjectId):
        return str(product_id)

    normalized = _safe_str(product_id)
    if not normalized:
        raise ValueError("productId is empty after normalization")

    return normalized


def _build_query_variants(normalized_product_id):
    """
    Build query options to match productId in common storage formats:
    - productId: string
    - productId: ObjectId
    - productId._id: string/ObjectId (nested object)
    """
    query_options = [
        {"productId": normalized_product_id},
        {"productId._id": normalized_product_id},
    ]

    if ObjectId.is_valid(normalized_product_id):
        oid = ObjectId(normalized_product_id)
        query_options.extend([
            {"productId": oid},
            {"productId._id": oid},
        ])

    return {"$or": query_options}


def _sample_sales_documents(limit=3):
    docs = list(
        sales_collection.find(
            {},
            {"_id": 1, "productId": 1, "quantity": 1, "date": 1},
        ).limit(limit)
    )
    return docs


def _find_other_db_with_sales():
    """Best-effort helper to detect if sales data exists in another database."""
    try:
        for db_name in client.list_database_names():
            if db_name == DB_NAME:
                continue
            count = client[db_name]["sales"].estimated_document_count()
            if count > 0:
                return db_name, int(count)
    except Exception as exc:
        print("[mongo] Unable to scan alternate databases:", str(exc))
    return None


def _validate_sales_docs(docs):
    missing_fields = []
    invalid_dates = []
    invalid_quantities = []

    for idx, doc in enumerate(docs):
        if "date" not in doc or "quantity" not in doc:
            missing_fields.append(idx)
            continue

        date_value = doc.get("date")
        quantity_value = doc.get("quantity")

        date_ok = False
        if isinstance(date_value, datetime):
            date_ok = True
        elif isinstance(date_value, str):
            try:
                datetime.fromisoformat(date_value.replace("Z", "+00:00"))
                date_ok = True
            except ValueError:
                date_ok = False

        if not date_ok:
            invalid_dates.append(idx)

        try:
            float(quantity_value)
        except (TypeError, ValueError):
            invalid_quantities.append(idx)

    if missing_fields:
        raise ValueError(
            f"Sales documents missing required fields (date/quantity) at rows: {missing_fields}"
        )

    if invalid_dates:
        raise ValueError(
            f"Date parsing failed for sales rows: {invalid_dates}"
        )

    if invalid_quantities:
        raise ValueError(
            f"Quantity parsing failed for sales rows: {invalid_quantities}"
        )


def get_db_diagnostics():
    """Return connection diagnostics useful for debugging environment mismatches."""
    diagnostics = {
        "configured_db_name": DB_NAME,
        "sales_collection": "sales",
        "mongo_uri_present": bool(MONGO_URI),
        "connected": False,
        "sales_count": None,
        "error": None,
    }

    try:
        client.admin.command("ping")
        diagnostics["connected"] = True
        diagnostics["sales_count"] = int(sales_collection.estimated_document_count())
    except Exception as exc:
        diagnostics["error"] = str(exc)

    return diagnostics


def build_product_query(product_id: str):
    """Build MongoDB query covering string/ObjectId/nested productId formats."""
    normalized_product_id = _normalize_product_id(product_id)
    query = _build_query_variants(normalized_product_id)
    return query, normalized_product_id


def get_raw_sales_data(product_id: str, limit: int = 100):
    """Return raw matching sales docs for debug endpoints."""
    query, normalized_product_id = build_product_query(product_id)
    docs = list(
        sales_collection.find(query).sort("date", 1).limit(limit)
    )
    return docs, query, normalized_product_id


def get_sales_data(product_id: str):
    """
    Fetch sales records for a given product from MongoDB.
    
    Args:
        product_id: Product ID to fetch sales data for
        
    Returns:
        list: Sales records with date and quantity fields
        
    Raises:
        ValueError: If no sales data found for the product
    """
    query, normalized_product_id = build_product_query(product_id)

    print("\n[mongo] get_sales_data called")
    print("[mongo] Incoming product_id:", product_id)
    print("[mongo] Normalized product_id:", normalized_product_id)
    print("[mongo] Query:", query)

    total_docs = sales_collection.count_documents({})
    print("[mongo] Total documents in sales collection:", total_docs)
    print("[mongo] Sample sales docs (limit 3):", _sample_sales_documents(limit=3))

    docs = list(
        sales_collection.find(
            query,
            {"_id": 0, "date": 1, "quantity": 1}
        ).sort("date", 1)
    )

    if not docs:
        if total_docs == 0:
            alt = _find_other_db_with_sales()
            if alt:
                other_db_name, other_sales_count = alt
                reason = (
                    "Connected to wrong database"
                    f" (configured DB '{DB_NAME}' has 0 docs,"
                    f" found {other_sales_count} docs in '{other_db_name}.sales')"
                )
            else:
                reason = "Collection empty"
        else:
            reason = "No matching productId"

        print("[mongo] No sales data reason:", reason)
        raise ValueError(
            f"No sales data found for productId: {normalized_product_id}. Reason: {reason}"
        )

    _validate_sales_docs(docs)

    print("[mongo] Matched sales docs:", len(docs))
    return docs


def get_product_name(product_id: str):
    """Fetch product name for a given product ID. Returns None when unavailable."""
    try:
        query, _ = build_product_query(product_id)
        product = products_collection.find_one(query, {"_id": 0, "name": 1})
        name = product.get("name") if isinstance(product, dict) else None
        if isinstance(name, str):
            normalized = name.strip()
            return normalized or None
        return None
    except Exception as exc:
        print("[mongo] Failed to resolve product name:", str(exc))
        return None


_diagnostics = get_db_diagnostics()
print("\n[mongo] Connection diagnostics:", _diagnostics)