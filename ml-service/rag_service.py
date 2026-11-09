"""Read-only retrieval and grounded answer orchestration for AI Analyst."""

from __future__ import annotations

import hashlib
import logging
import os
import re
import time
from functools import lru_cache
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from postgresService import _cursor, serialize_value
from rag_provider import ProviderUnavailable, generate_grounded_answer, plan_question

MAX_CONTEXT_CHARS = 9000
MAX_ROWS = 25
MAX_PRODUCTS = 8
MAX_RETRIEVAL_TASKS = 8
SUPPORTED_DOCUMENTS = (
    "metric-definitions",
    "forecast-methodology",
    "inventory-recommendations",
    "schema-data-dictionary",
    "troubleshooting",
)

logger = logging.getLogger(__name__)


class RetrievalTask(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal[
        "product_snapshot",
        "sales_summary",
        "sales_comparison",
        "predictions",
        "alerts",
        "documentation",
    ]
    entities: list[str] = Field(default_factory=list, max_length=MAX_PRODUCTS)


class QueryPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    intent: str = Field(min_length=1, max_length=160)
    requested_output: str = Field(min_length=1, max_length=500)
    entities: list[str] = Field(default_factory=list, max_length=MAX_PRODUCTS)
    metrics: list[str] = Field(default_factory=list, max_length=12)
    start_date: date | None = None
    end_date: date | None = None
    evidence_sources: list[Literal["live_sql", "vector_docs"]] = Field(
        default_factory=list,
        max_length=2,
    )
    retrieval_tasks: list[RetrievalTask] = Field(
        default_factory=list,
        max_length=MAX_RETRIEVAL_TASKS,
    )
    decomposed: bool = False
    clarification: str | None = Field(default=None, max_length=300)

PRODUCT_INTENT_TERMS = (
    "update",
    "updates",
    "changed",
    "change",
    "performing",
    "performance",
    "sales",
    "prediction",
    "predictions",
    "forecast",
    "recommendation",
    "marked",
    "stock",
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
    has_product = _extract_product_term(question) is not None
    if has_product:
        explanatory_terms = (
            "what does",
            "what is",
            "what are",
            "how does",
            "meaning",
            "define",
            "explain",
            "methodology",
            "schema",
            "troubleshoot",
        )
        return (
            "combined"
            if has_docs and any(term in lowered for term in explanatory_terms)
            else "live_business_analytics"
        )
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


def _clean_product_term(value: str) -> str:
    cleaned = re.sub(r"[\s?.!,;:]+$", "", value.strip())
    cleaned = re.sub(r"^(?:the|a|an)\s+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(
        r"\s+(?:recently|lately|today|now)$",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    return cleaned.strip()


def _extract_product_term(question: str) -> str | None:
    reference = _extract_product_reference(question)
    if reference:
        return reference

    patterns = (
        r"\b(?:updates?|changed|change|latest update)\s+(?:on|for|about)\s+(.+)",
        r"\b(?:how are|how is)\s+(.+?)\s+(?:performing|doing|selling)\b",
        r"\b(?:sales|predictions?|forecast|recommendation|stock|alerts?)\s+"
        r"(?:for|of|on)\s+(.+)",
        r"\b(?:how does|what is)\s+.+?\s+work\s+(?:for|with)\s+(.+)",
        r"\bwhy is\s+(.+?)\s+marked\s+for\s+"
        r"(?:increase|reduce|maintain)\b",
        r"\bmarked\s+for\s+(?:increase|reduce|maintain)\s*[:\-]?\s*(.+)",
    )
    for pattern in patterns:
        match = re.search(pattern, question, flags=re.IGNORECASE)
        if match:
            candidate = _clean_product_term(match.group(1))
            if candidate:
                return candidate
    return None


def _resolve_product(cursor, product_term: str) -> dict[str, Any] | None:
    normalized_term = _clean_product_term(product_term)
    if not normalized_term:
        return None

    cursor.execute(
        """
        SELECT id, name, category, created_at, updated_at
        FROM products
        WHERE lower(name) = lower(%s)
        LIMIT 1
        """,
        (normalized_term,),
    )
    exact = cursor.fetchone()
    if exact:
        return dict(exact)

    safe_partial = normalized_term.replace("%", "").replace("_", "").strip()
    if not safe_partial:
        return None

    cursor.execute(
        """
        SELECT id, name, category, created_at, updated_at
        FROM products
        WHERE lower(name) LIKE lower(%s)
        ORDER BY length(name), name
        LIMIT 2
        """,
        (f"%{safe_partial}%",),
    )
    matches = cursor.fetchall()
    if len(matches) == 1:
        return dict(matches[0])
    return None


def _live_evidence(question: str) -> dict[str, Any]:
    product_id = _extract_product_reference(question)
    with _cursor() as cursor:
        product_term = _extract_product_term(question)
        if product_term:
            product = _resolve_product(cursor, product_term)
            if not product:
                return {
                    "rows": [],
                    "source": "LIVE_DATABASE",
                    "product_specific": True,
                    "product_term": product_term,
                    "product_found": False,
                }

            cursor.execute(
                """
                SELECT
                  p.id,
                  p.name,
                  p.category,
                  p.created_at AS product_created_at,
                  p.updated_at AS product_updated_at,
                  COALESCE((
                    SELECT SUM(s.quantity)
                    FROM sales s
                    WHERE s.product_id = p.id
                  ), 0) AS total_sales,
                  (
                    SELECT COUNT(*)
                    FROM sales s
                    WHERE s.product_id = p.id
                  ) AS sales_rows,
                  (
                    SELECT MAX(s.sale_date)
                    FROM sales s
                    WHERE s.product_id = p.id
                  ) AS latest_sale_at,
                  (
                    SELECT json_build_object(
                      'predicted_demand', pr.predicted_demand,
                      'rule_prediction', pr.rule_prediction,
                      'ml_prediction', pr.ml_prediction,
                      'adjusted_prediction', pr.adjusted_prediction,
                      'percent_change', pr.percent_change,
                      'confidence', pr.confidence,
                      'season_tag', pr.season_tag,
                      'decision', pr.decision,
                      'impact', pr.impact,
                      'reason', pr.reason,
                      'prediction_source', pr.prediction_source,
                      'predicted_at', pr.predicted_at
                    )
                    FROM predictions pr
                    WHERE pr.product_id = p.id
                    ORDER BY pr.predicted_at DESC
                    LIMIT 1
                  ) AS latest_prediction,
                  COALESCE((
                    SELECT json_agg(alert_row ORDER BY alert_row.created_at DESC)
                    FROM (
                      SELECT a.type, a.message, a.severity, a.percent_change,
                             a.is_active, a.created_at
                      FROM alerts a
                      WHERE a.product_id = p.id
                      ORDER BY a.created_at DESC
                      LIMIT 5
                    ) AS alert_row
                  ), '[]'::json) AS alerts,
                  COALESCE((
                    SELECT json_agg(sale_row ORDER BY sale_row.sale_date DESC)
                    FROM (
                      SELECT s.sale_date, s.quantity, s.created_at
                      FROM sales s
                      WHERE s.product_id = p.id
                      ORDER BY s.sale_date DESC
                      LIMIT 5
                    ) AS sale_row
                  ), '[]'::json) AS recent_sales
                FROM products p
                WHERE p.id = %s
                LIMIT 1
                """,
                (str(product["id"]),),
            )
            row = cursor.fetchone()
            if not row:
                return {
                    "rows": [],
                    "source": "LIVE_DATABASE",
                    "product_specific": True,
                    "product_term": product_term,
                    "product_found": False,
                }
            return {
                "rows": [serialize_value(dict(row))],
                "source": "LIVE_DATABASE",
                "product_specific": True,
                "product_term": product_term,
                "product_found": True,
            }
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
    embedding = _embedding_model(model_name).encode(question).tolist()
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


@lru_cache(maxsize=2)
def _embedding_model(model_name: str):
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(model_name)


def _context(live: dict[str, Any], docs: dict[str, Any]) -> str:
    chunks = []
    if live.get("rows"):
        chunks.append("LIVE_DATABASE:\n" + str(live["rows"]))
    if docs.get("rows"):
        chunks.append("DOCUMENTATION:\n" + str(docs["rows"]))
    return "\n\n".join(chunks)[:MAX_CONTEXT_CHARS]


def _has_product_activity(live: dict[str, Any]) -> bool:
    if not live.get("product_specific") or not live.get("rows"):
        return False
    row = live["rows"][0]
    return bool(
        row.get("sales_rows")
        or row.get("latest_prediction")
        or row.get("alerts")
    )


def _fallback_plan(question: str) -> QueryPlan:
    """Keep existing deterministic behavior only when planning is unavailable."""
    category = classify_question(question)
    tasks = []
    if category in {"live_business_analytics", "combined"}:
        tasks.append(
            RetrievalTask(
                kind="product_snapshot"
                if _extract_product_term(question)
                else "sales_summary",
                entities=[_extract_product_term(question)]
                if _extract_product_term(question)
                else [],
            )
        )
    if category in {"documentation_semantic_knowledge", "combined"}:
        tasks.append(RetrievalTask(kind="documentation"))
    return QueryPlan(
        intent=category,
        requested_output="Answer using available OpsPulse evidence.",
        entities=[
            entity
            for entity in [_extract_product_term(question)]
            if entity
        ],
        evidence_sources=(
            ["live_sql", "vector_docs"]
            if category == "combined"
            else ["live_sql"]
            if category == "live_business_analytics"
            else ["vector_docs"]
        ),
        retrieval_tasks=tasks,
        decomposed=len(tasks) > 1,
    )


def _validated_plan(question: str) -> tuple[QueryPlan, bool]:
    try:
        raw_plan = plan_question(question)
        plan = QueryPlan.model_validate(raw_plan)
        if plan.start_date and plan.end_date and plan.start_date > plan.end_date:
            raise ValueError("invalid date range")
        if not plan.retrieval_tasks and not plan.clarification:
            raise ValueError("planner returned no retrieval tasks")
        return plan, False
    except (ProviderUnavailable, ValidationError, ValueError) as exc:
        logger.warning("AI Analyst query planning fell back: %s", type(exc).__name__)
        return _fallback_plan(question), True


def _resolve_plan_entities(cursor, entities: list[str]) -> tuple[list[dict[str, Any]], list[str]]:
    products = []
    missing = []
    seen = set()
    for entity in entities[:MAX_PRODUCTS]:
        candidate = _extract_product_reference(entity) or _clean_product_term(entity)
        if not candidate or candidate.lower() in seen:
            continue
        seen.add(candidate.lower())
        product = _resolve_product(cursor, candidate)
        if product:
            products.append(product)
        else:
            missing.append(candidate)
    return products, missing


def _product_sql_evidence(
    cursor,
    product: dict[str, Any],
    *,
    start_date: date | None,
    end_date: date | None,
    task_kinds: set[str],
) -> dict[str, Any]:
    product_id = str(product["id"])
    sales = {}
    if task_kinds & {"product_snapshot", "sales_summary", "sales_comparison"}:
        cursor.execute(
            """
            SELECT COALESCE(SUM(quantity), 0) AS total_sales,
                   COUNT(*) AS sales_rows,
                   MAX(sale_date) AS latest_sale_at,
                   COALESCE(AVG(quantity), 0) AS average_sale_quantity
            FROM sales
            WHERE product_id = %s
              AND (%s IS NULL OR sale_date >= %s)
              AND (%s IS NULL OR sale_date < %s)
            """,
            (product_id, start_date, start_date, end_date, end_date),
        )
        sales = serialize_value(dict(cursor.fetchone() or {}))
    prediction = None
    if task_kinds & {"product_snapshot", "predictions", "sales_comparison"}:
        cursor.execute(
            """
            SELECT predicted_demand, adjusted_prediction, percent_change,
                   confidence, season_tag, decision, impact, reason,
                   prediction_source, predicted_at
            FROM predictions
            WHERE product_id = %s
            ORDER BY predicted_at DESC
            LIMIT 1
            """,
            (product_id,),
        )
        row = cursor.fetchone()
        prediction = serialize_value(dict(row)) if row else None
    alerts = []
    if task_kinds & {"product_snapshot", "alerts"}:
        cursor.execute(
            """
            SELECT type, message, severity, percent_change, is_active, created_at
            FROM alerts
            WHERE product_id = %s
            ORDER BY created_at DESC
            LIMIT 5
            """,
            (product_id,),
        )
        alerts = [serialize_value(dict(row)) for row in cursor.fetchall()]
    return {
        "id": product_id,
        "name": product["name"],
        "category": product.get("category"),
        "created_at": serialize_value(product.get("created_at")),
        "updated_at": serialize_value(product.get("updated_at")),
        "sales": sales,
        "latest_prediction": prediction,
        "alerts": alerts,
    }


def _planned_live_evidence(plan: QueryPlan) -> dict[str, Any]:
    entities = list(dict.fromkeys(plan.entities))
    task_kinds = {task.kind for task in plan.retrieval_tasks}
    if not entities and "sales_summary" not in task_kinds:
        return {"rows": [], "source": "LIVE_DATABASE", "product_specific": False}
    with _cursor() as cursor:
        products, missing = _resolve_plan_entities(cursor, entities)
        if entities and not products:
            return {
                "rows": [],
                "source": "LIVE_DATABASE",
                "product_specific": True,
                "product_term": entities[0],
                "product_found": False,
                "missing_entities": missing,
            }
        rows = [
            _product_sql_evidence(
                cursor,
                product,
                start_date=plan.start_date,
                end_date=plan.end_date,
                task_kinds=task_kinds,
            )
            for product in products
        ]
        if not entities and "sales_summary" in task_kinds:
            cursor.execute(
                """
                SELECT COUNT(*) AS products_count,
                       COALESCE(SUM(s.quantity), 0) AS sales_count,
                       COUNT(DISTINCT s.product_id) AS products_with_sales
                FROM sales s
                WHERE (%s IS NULL OR s.sale_date >= %s)
                  AND (%s IS NULL OR s.sale_date < %s)
                """,
                (plan.start_date, plan.start_date, plan.end_date, plan.end_date),
            )
            rows = [serialize_value(dict(cursor.fetchone() or {}))]
    return {
        "rows": rows[:MAX_ROWS],
        "source": "LIVE_DATABASE",
        "product_specific": bool(entities),
        "product_found": bool(products) if entities else None,
        "missing_entities": missing,
    }


def _planned_document_evidence(question: str, plan: QueryPlan) -> dict[str, Any]:
    return _document_evidence(question)


def _plan_category(plan: QueryPlan) -> str:
    sources = set(plan.evidence_sources)
    if sources == {"live_sql", "vector_docs"}:
        return "combined"
    if "live_sql" in sources:
        return "live_business_analytics"
    return "documentation_semantic_knowledge"


def answer_question(question: str) -> dict[str, Any]:
    started = time.perf_counter()
    plan, planning_fallback = _validated_plan(question)
    logger.info(
        "AI Analyst query plan ready fallback=%s tasks=%s duration_ms=%.1f",
        planning_fallback,
        len(plan.retrieval_tasks),
        (time.perf_counter() - started) * 1000,
    )
    if plan.clarification and not plan.retrieval_tasks:
        return {
            "answer": plan.clarification,
            "category": _plan_category(plan),
            "sources": [],
            "provenance": {
                "liveData": False,
                "documentation": False,
                "planningFallback": planning_fallback,
            },
            "plan": plan.model_dump(mode="json"),
        }
    retrieval_started = time.perf_counter()
    live = (
        _live_evidence(question)
        if planning_fallback and "live_sql" in plan.evidence_sources
        else _planned_live_evidence(plan)
        if "live_sql" in plan.evidence_sources
        else {"rows": []}
    )
    docs = (
        _planned_document_evidence(question, plan)
        if "vector_docs" in plan.evidence_sources
        else {"rows": []}
    )
    logger.info(
        "AI Analyst retrieval complete live_rows=%s doc_rows=%s duration_ms=%.1f",
        len(live.get("rows", [])),
        len(docs.get("rows", [])),
        (time.perf_counter() - retrieval_started) * 1000,
    )
    category = _plan_category(plan)
    if live.get("product_specific") and not live.get("product_found"):
        product_term = live.get("product_term", "that product")
        return {
            "answer": (
                f"No matching product was found for '{product_term}'. "
                "Please provide the product name as it appears in OpsPulse."
            ),
            "category": category,
            "sources": [],
            "provenance": {
                "liveData": False,
                "documentation": bool(docs.get("rows")),
                "documentRetrievalAvailable": docs.get("available", True),
            },
            "plan": plan.model_dump(mode="json"),
        }
    if live.get("product_specific") and live.get("product_found") and not docs.get("rows"):
        row = live.get("rows", [{}])[0]
        has_activity = bool(
            row.get("sales_rows")
            or row.get("latest_prediction")
            or row.get("alerts")
            or row.get("sales", {}).get("sales_rows")
            or row.get("sales", {}).get("total_sales")
            or row.get("latest_prediction")
        )
        if not has_activity:
            product_term = live.get("product_term") or row.get("name", "that product")
            return {
                "answer": (
                    f"'{product_term}' exists in OpsPulse, but no sales, prediction, "
                    "or alert history is available. Product timestamps are available "
                    "only where recorded; no change history can be inferred."
                ),
                "category": category,
                "sources": [{"type": "live_database", "label": "PostgreSQL product record"}],
                "provenance": {
                    "liveData": True,
                    "documentation": False,
                },
                "plan": plan.model_dump(mode="json"),
            }
    evidence_context = _context(live, docs)
    if not evidence_context:
        raise ProviderUnavailable(
            "No retrieval evidence is available; configure pgvector/document embeddings "
            "or ask a question about live database metrics"
        )
    context = (
        "QUERY_PLAN:\n"
        + str(plan.model_dump(mode="json"))
        + "\n\n"
        + evidence_context
    )[:MAX_CONTEXT_CHARS]
    answer_started = time.perf_counter()
    answer = generate_grounded_answer(question, context)
    logger.info(
        "AI Analyst answer generated duration_ms=%.1f",
        (time.perf_counter() - answer_started) * 1000,
    )
    sources = []
    if live.get("rows"):
        for row in live["rows"][:MAX_ROWS]:
            sources.append(
                {
                    "type": "live_database",
                    "label": "PostgreSQL analytics",
                    "recordId": row.get("id"),
                    "productSpecific": bool(live.get("product_specific")),
                    "productTerm": row.get("name") or live.get("product_term"),
                }
            )
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
        "plan": plan.model_dump(mode="json"),
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
