"""Idempotently seed versioned OpsPulse documentation into pgvector storage."""

from __future__ import annotations

import os

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
            for row, embedding in zip(rows, embeddings):
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


if __name__ == "__main__":
    print(f"Seeded {seed_documents()} AI Analyst documents")
