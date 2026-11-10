"""Idempotently seed versioned OpsPulse documentation into pgvector storage."""

from __future__ import annotations

import hashlib
import os
from typing import Any

from postgresService import _connection
from rag_service import documentation_seed_rows


def seed_documents() -> int:
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

    with _connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'ai_document_chunks' AND column_name = 'tenant_id'
                LIMIT 1
                """
            )
            has_tenant_col = bool(cursor.fetchone())

            for row, embedding in zip(rows, embeddings):
                if has_tenant_col:
                    cursor.execute(
                        """
                        INSERT INTO ai_document_chunks
                          (document_key, title, content, content_hash, embedding, version, tenant_id)
                        VALUES (%s, %s, %s, %s, %s::vector, %s, NULL)
                        ON CONFLICT (document_key, content_hash, version)
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
                else:
                    cursor.execute(
                        """
                        INSERT INTO ai_document_chunks
                          (document_key, title, content, content_hash, embedding, version)
                        VALUES (%s, %s, %s, %s, %s::vector, %s)
                        ON CONFLICT (document_key, content_hash, version)
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

    with _connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'ai_document_chunks' AND column_name = 'tenant_id'
                LIMIT 1
                """
            )
            if not cursor.fetchone():
                raise RuntimeError(
                    "Tenant isolation schema not established: 'ai_document_chunks' table lacks 'tenant_id'. "
                    "Apply migration 005_tenant_isolation.sql."
                )
            cursor.execute(
                """
                INSERT INTO ai_document_chunks
                  (document_key, title, content, content_hash, embedding, version, tenant_id)
                VALUES (%s, %s, %s, %s, %s::vector, %s, %s)
                RETURNING id
                """,
                (document_key, title, content, content_hash, str(embedding), version, tenant_id),
            )
            inserted_id = cursor.fetchone()["id"]
        connection.commit()
    return {"id": inserted_id, "document_key": document_key, "tenant_id": tenant_id}


if __name__ == "__main__":
    print(f"Seeded {seed_documents()} AI Analyst documents")
