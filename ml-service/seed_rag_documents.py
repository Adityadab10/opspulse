"""Idempotently seed versioned OpsPulse documentation into pgvector storage."""

from __future__ import annotations

import hashlib
import os
from contextlib import closing
from typing import Any

import psycopg2

from new_database import new_database_connection
from rag_service import documentation_seed_rows


def seed_documents() -> int:
    database_url, options = new_database_connection()
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:
        raise RuntimeError(
            "sentence-transformers is required to seed AI Analyst embeddings"
        ) from exc

    model = SentenceTransformer(
        os.getenv("AI_ANALYST_EMBEDDING_MODEL", "all-MiniLM-L6-v2")
    )
    rows = documentation_seed_rows()
    embeddings = model.encode([row["content"] for row in rows])

    with closing(psycopg2.connect(database_url, **options)) as connection:
        with connection.cursor() as cursor:
            for row, embedding in zip(rows, embeddings, strict=True):
                cursor.execute(
                    """
                    INSERT INTO ai_document_chunks
                      (document_key, title, content, content_hash, embedding, version, tenant_id)
                    VALUES (%s, %s, %s, %s, %s::vector, %s, NULL)
                    ON CONFLICT (document_key, content_hash, version) WHERE tenant_id IS NULL
                    DO UPDATE SET title = EXCLUDED.title,
                                  content = EXCLUDED.content,
                                  embedding = EXCLUDED.embedding,
                                  updated_at = now()
                    """,
                    (
                        row["document_key"],
                        row["title"],
                        row["content"],
                        row["content_hash"],
                        str(embedding.tolist()),
                        row["version"],
                    ),
                )
        connection.commit()
    return len(rows)


def ingest_customer_document(
    *,
    tenant_id: str,
    document_key: str,
    title: str,
    content: str,
    version: str = "v1",
) -> dict[str, Any]:
    """Ingest a customer-specific document chunk with mandatory non-null tenant_id."""
    if not tenant_id or not isinstance(tenant_id, str) or not tenant_id.strip():
        raise ValueError("Customer document ingestion requires an explicit non-empty tenant_id")
    tenant_id = tenant_id.strip()
    database_url, options = new_database_connection()
    if not document_key or not title or not content:
        raise ValueError("document_key, title, and content are required")

    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:
        raise RuntimeError(
            "sentence-transformers is required for customer document ingestion"
        ) from exc

    model = SentenceTransformer(
        os.getenv("AI_ANALYST_EMBEDDING_MODEL", "all-MiniLM-L6-v2")
    )
    embedding = model.encode(content).tolist()
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

    with closing(psycopg2.connect(database_url, **options)) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant_id', %s, true)", (tenant_id,))
            cursor.execute(
                """
                INSERT INTO ai_document_chunks
                  (document_key, title, content, content_hash, embedding, version, tenant_id)
                VALUES (%s, %s, %s, %s, %s::vector, %s, %s)
                ON CONFLICT (tenant_id, document_key, content_hash, version) WHERE tenant_id IS NOT NULL
                DO UPDATE SET title = EXCLUDED.title, embedding = EXCLUDED.embedding, updated_at = now()
                RETURNING id
                """,
                (document_key, title, content, content_hash, str(embedding), version, tenant_id),
            )
            inserted_id = cursor.fetchone()[0]
        connection.commit()
    return {"id": inserted_id, "document_key": document_key, "tenant_id": tenant_id}


if __name__ == "__main__":
    print(f"Seeded {seed_documents()} AI Analyst documents")
