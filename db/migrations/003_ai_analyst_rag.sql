-- AI Analyst document chunks and pgvector embeddings.
-- This migration is intentionally additive and safe to re-run.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS ai_document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_key VARCHAR(160) NOT NULL,
  title VARCHAR(255) NOT NULL,
  section VARCHAR(255),
  content TEXT NOT NULL,
  content_hash CHAR(64) NOT NULL,
  embedding vector(384),
  version VARCHAR(32) NOT NULL DEFAULT 'v1',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_key, content_hash, version)
);

CREATE INDEX IF NOT EXISTS idx_ai_document_chunks_document_key
  ON ai_document_chunks(document_key);

CREATE INDEX IF NOT EXISTS idx_ai_document_chunks_embedding_hnsw
  ON ai_document_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
