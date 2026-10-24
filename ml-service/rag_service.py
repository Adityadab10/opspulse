"""Read-only retrieval and grounded answer orchestration for AI Analyst."""

from __future__ import annotations

import hashlib
import os
import re
from typing import Any

from postgresService import _cursor, serialize_value
from rag_provider import ProviderUnavailable, generate_grounded_answer

MAX_CONTEXT_CHARS = 9000
MAX_ROWS = 25
SUPPORTED_DOCUMENTS = (
    "metric-definitions",
    "forecast-methodology",
    "inventory-recommendations",
    "schema-data-dictionary",
    "troubleshooting",
)


def classify_question(question: str) -> str:
    lowered = question.lower()
    live_terms = ("sales", "product", "forecast", "prediction", "alert", "inventory", "demand")
    document_terms = (
        "what does",
        "what is",
        "what are",
        "how does",
        "how are",
        "meaning",
        "define",
        "explain",
        "methodology",
        "schema",
        "troubleshoot",
    )
    has_live = any(term in lowered for term in live_terms)
    has_docs = any(term in lowered for term in document_terms)
    if has_live and has_docs:
        return "combined"
    if has_live:
        return "live_business_analytics"
    return "documentation_semantic_knowledge"


def _extract_product_reference(question: str) -> str | None:
    match = re.search(
        r"\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b",
        question,
        flags=re.IGNORECASE,
    )
    return match.group(0) if match else None


def _live_evidence(question: str) -> dict[str, Any]:
    product_id = _extract_product_reference(question)
    with _cursor() as cursor:
        if product_id:
            cursor.execute(
                """
                SELECT p.id, p.name, p.category,
                       COALESCE(SUM(s.quantity), 0) AS total_sales,
                       COUNT(s.id) AS sales_rows,
                       pr.predicted_demand, pr.adjusted_prediction,
                       pr.confidence, pr.decision,
                       COUNT(a.id) FILTER (WHERE a.is_active) AS active_alerts
                FROM products p
                LEFT JOIN sales s ON s.product_id = p.id
                LEFT JOIN predictions pr ON pr.product_id = p.id
                LEFT JOIN alerts a ON a.product_id = p.id
                WHERE p.id = %s
                GROUP BY p.id, pr.id
                LIMIT 1
                """,
                (product_id,),
            )
        else:
            cursor.execute(
                """
                SELECT
                  (SELECT COUNT(*) FROM products) AS products_count,
                  (SELECT COUNT(*) FROM sales) AS sales_count,
                  (SELECT COUNT(*) FROM predictions) AS predictions_count,
                  (SELECT COUNT(*) FROM alerts WHERE is_active = true) AS active_alerts
                """
            )
        row = cursor.fetchone()
    if not row:
        return {"rows": [], "source": "LIVE_DATABASE"}
    return {
        "rows": [serialize_value(dict(row))],
        "source": "LIVE_DATABASE",
        "product_id": product_id,
    }


def _vector_available() -> bool:
    with _cursor() as cursor:
        cursor.execute("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')")
        return bool(cursor.fetchone()["exists"])


def _document_evidence(question: str) -> dict[str, Any]:
    if not _vector_available():
        return {
            "rows": [],
            "source": "DOCUMENTATION",
            "available": False,
            "error": "pgvector extension is not enabled",
        }
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        return {
            "rows": [],
            "source": "DOCUMENTATION",
            "available": False,
            "error": "sentence-transformers is not installed",
        }

    model_name = os.getenv("AI_ANALYST_EMBEDDING_MODEL", "all-MiniLM-L6-v2")
    embedding = SentenceTransformer(model_name).encode(question).tolist()
    with _cursor() as cursor:
        cursor.execute(
            """
            SELECT id, document_key, title, section, content, version,
                   1 - (embedding <=> %s::vector) AS similarity
            FROM ai_document_chunks
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> %s::vector
            LIMIT %s
            """,
            (str(embedding), str(embedding), MAX_ROWS),
        )
        rows = [serialize_value(dict(row)) for row in cursor.fetchall()]
    return {"rows": rows, "source": "DOCUMENTATION", "available": True}


def _context(live: dict[str, Any], docs: dict[str, Any]) -> str:
    chunks = []
    if live.get("rows"):
        chunks.append("LIVE_DATABASE:\n" + str(live["rows"]))
    if docs.get("rows"):
        chunks.append("DOCUMENTATION:\n" + str(docs["rows"]))
    return "\n\n".join(chunks)[:MAX_CONTEXT_CHARS]


def answer_question(question: str) -> dict[str, Any]:
    category = classify_question(question)
    live = _live_evidence(question) if category in {"live_business_analytics", "combined"} else {"rows": []}
    docs = _document_evidence(question) if category in {"documentation_semantic_knowledge", "combined"} else {"rows": []}
    context = _context(live, docs)
    if not context:
        raise ProviderUnavailable(
            "No retrieval evidence is available; configure pgvector/document embeddings "
            "or ask a question about live database metrics"
        )
    answer = generate_grounded_answer(question, context)
    sources = []
    if live.get("rows"):
        sources.append({"type": "live_database", "label": "PostgreSQL analytics"})
    if docs.get("rows"):
        sources.extend(
            {
                "type": "documentation",
                "label": row.get("title", "OpsPulse documentation"),
                "documentKey": row.get("document_key"),
                "similarity": row.get("similarity"),
            }
            for row in docs["rows"]
        )
    return {
        "answer": answer,
        "category": category,
        "sources": sources,
        "provenance": {
            "liveData": bool(live.get("rows")),
            "documentation": bool(docs.get("rows")),
            "documentRetrievalAvailable": docs.get("available", True),
        },
    }


def documentation_seed_rows() -> list[dict[str, str]]:
    documents = {
        "metric-definitions": ("Metric definitions", "Sales totals are the sum of positive quantities in the PostgreSQL sales table. Active alerts are alerts with is_active=true."),
        "forecast-methodology": ("Forecast methodology", "OpsPulse uses PostgreSQL sales history with Prophet for the demand forecast and compares Prophet with ARIMA when at least five usable rows are available."),
        "inventory-recommendations": ("Inventory recommendation logic", "Recommendations combine forecast output, trend, season, and news impact. The system does not create forecasts when required sales history is unavailable."),
        "schema-data-dictionary": ("Schema and data dictionary", "Products are identified by UUID. Sales reference products through sales.product_id. Predictions and alerts reference products through product_id."),
        "troubleshooting": ("Troubleshooting", "A comparison with fewer than five usable sales rows is reported as insufficient data. Supabase session exhaustion is mitigated by bounded comparison concurrency in the Node backend."),
    }
    return [
        {
            "document_key": key,
            "title": title,
            "content": content,
            "content_hash": hashlib.sha256(content.encode("utf-8")).hexdigest(),
            "version": "v1",
        }
        for key, (title, content) in documents.items()
    ]
