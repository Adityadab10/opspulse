# OpsPulse Database Migration Integration Tests

This directory and `ml-service/tests/test_migration_005_pgvector.py` provide a permanent, automated integration test suite for OpsPulse database migrations (`001` through `005`).

---

## Key Guarantees

1. **Unchanged Migration Execution**:
   Executes `001_initial_schema.sql`, `002_alert_legacy_mongo_id.sql`, `003_ai_analyst_rag.sql`, `004_agent_runs_and_steps.sql`, and `005_tenant_isolation.sql` completely unchanged and in sequential order. Never substitutes migration SQL or data types.
2. **Actual pgvector & HNSW Validation**:
   Tests run against a real PostgreSQL 16/17 engine running the official `pgvector/pgvector:pg16` image. Confirms that `ai_document_chunks.embedding` is type `vector(384)` and the HNSW cosine index `idx_ai_document_chunks_embedding_hnsw` is established.
3. **Strict Safety Guardrails**:
   Rejects connection targets outside explicitly permitted local test environments (`127.0.0.1`, `localhost`, `::1`, `docker`, `postgres`). Rejects any URL containing remote or production keywords (`supabase`, `pooler`, `aws`, `prod`, `staging`). Never reads application `.env` credentials.
4. **Deterministic Isolation**:
   Each test fixture provisions an isolated database (e.g. `test_fixture_1_clean`), executes assertions, and drops the database cleanly on completion using `DROP DATABASE ... WITH (FORCE)`.

---

## Local Execution Guide

### 1. Start the Isolated pgvector Container
```bash
docker run -d --name opspulse-pgvector -p 5433:5432 -e POSTGRES_HOST_AUTH_METHOD=trust pgvector/pgvector:pg16
```

### 2. Run the Migration Integration Tests
Using Python:
```bash
python ml-service/tests/test_migration_005_pgvector.py
```

Using Pytest:
```bash
pytest ml-service/tests/test_migration_005_pgvector.py -v
```

Or run as part of the complete ML test suite:
```bash
pytest ml-service
```

### 3. Teardown
```bash
docker rm -f opspulse-pgvector
```

---

## Continuous Integration (CI) Configuration

In GitHub Actions, configure the test runner with a PostgreSQL service container:

```yaml
jobs:
  test-migrations:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_HOST_AUTH_METHOD: trust
        ports:
          - 5433:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'

      - name: Install dependencies
        run: |
          pip install -r ml-service/requirements.txt pytest

      - name: Run Migration Integration Tests
        env:
          OPSPULSE_TEST_DATABASE_URL: postgresql://postgres@127.0.0.1:5433/postgres
        run: |
          pytest ml-service/tests/test_migration_005_pgvector.py -v
```

---

## Covered Fixtures

1. **Clean Empty Database**:
   Applies 001–005 in order on an empty database. Verifies vector embedding dimensions (`vector(384)`), HNSW index existence, composite foreign keys (`sales`, `predictions`, `alerts` referencing `products(tenant_id, id)`), `tenant_id NOT NULL` constraints, unique keys, and agent tracking defaults removal.
2. **Single-Tenant Historical Backfill**:
   Applies 001–004, seeds unpartitioned historical records with 384-dimensional vector embeddings, sets `opspulse.authoritative_tenant_id`, and applies 005. Verifies all records backfilled and shared RAG documents remain `tenant_id IS NULL`.
3. **Multi-Tenant Mapping Table with Inheritance**:
   Applies 001–004, seeds distinct products and child records, populates `opspulse_tenant_mapping`, and applies 005. Verifies parent products and child sales/predictions inherit respective tenant IDs without cross-tenant bleed.
4. **Missing Mapping Preflight Halt**:
   Applies 001–004, seeds unpartitioned records without mapping source. Verifies migration 005 halts with `PREFLIGHT HALT` and rolls back 100%.
5. **Cross-Tenant Anomaly Halt**:
   Applies 001–004, seeds parent and child records mapped to different tenants. Verifies migration 005 halts with `CROSS-TENANT INTEGRITY VIOLATION` and rolls back 100%.
6. **Duplicate Key Anomaly Halt**:
   Applies 001–004, seeds duplicate daily sales records. Verifies migration 005 halts with `UNIQUE CONSTRAINT INTEGRITY VIOLATION` and rolls back 100%.
7. **Dry-Run Inspection**:
   Applies 001–004, seeds records with `opspulse.dry_run = 'true'`. Verifies migration 005 executes all validations and rolls back without committing changes.
8. **Re-Execution Idempotency**:
   Applies 001–005 on a database with data, then re-applies migration 005 a second time. Verifies second run succeeds with zero errors, preserving composite foreign keys and data.
