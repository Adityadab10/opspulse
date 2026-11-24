# OpsPulse PostgreSQL Schema Baseline

## Snapshot metadata

- Snapshot date: 2026-11-15
- Source: existing OpsPulse Supabase PostgreSQL database
- Database: `postgres`
- PostgreSQL: 17.6 on aarch64, 64-bit
- Endpoint class: Supabase pooler endpoint on port 5432
- Export mode: schema-only; no row data included. The export was taken without `--schema=public`, so it includes the public application schema plus Supabase-managed schemas (`auth`, `storage`, `realtime`, etc.); this preserves the complete server-side schema rather than only the application namespace.
- SSL observation: the export connection was requested with `PGSSLMODE=require`; the independent live inspection connection reported `pg_stat_ssl.ssl = false`. The application connection configuration does not currently enforce SSL, so this should be reviewed separately.
- SQL export: [database-schema-baseline.sql](./database-schema-baseline.sql)

Credentials and complete connection strings are intentionally omitted.

## Existing extensions

The live database reports:

- `pg_stat_statements` 1.11
- `pgcrypto` 1.3
- `plpgsql` 1.0
- `supabase_vault` 0.3.1
- `uuid-ossp` 1.1
- `vector` 0.8.2

## Application tables and columns

### `products`

| Column | Type | Nullable | Default |
|---|---|---:|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `name` | varchar | no | — |
| `category` | varchar | no | — |
| `created_at` | timestamptz | yes | `now()` |
| `updated_at` | timestamptz | yes | `now()` |
| `legacy_mongo_id` | varchar | yes | — |

### `sales`

| Column | Type | Nullable | Default |
|---|---|---:|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `product_id` | uuid | no | — |
| `sale_date` | timestamptz | no | — |
| `quantity` | integer | no | — |
| `created_at` | timestamptz | yes | `now()` |

### `predictions`

| Column | Type | Nullable | Default |
|---|---|---:|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `product_id` | uuid | no | — |
| `predicted_demand` | numeric | no | — |
| `rule_prediction` | numeric | no | — |
| `ml_prediction` | numeric | no | — |
| `adjusted_prediction` | numeric | no | — |
| `avg_sales` | numeric | no | — |
| `percent_change` | numeric | no | — |
| `confidence` | varchar | no | — |
| `season_tag` | varchar | no | — |
| `decision` | varchar | no | — |
| `impact` | varchar | no | — |
| `keyword` | varchar | yes | — |
| `score` | numeric | yes | `0` |
| `source_headline` | varchar | yes | — |
| `source_headlines` | jsonb | yes | `'[]'` |
| `matched_keywords` | jsonb | yes | `'[]'` |
| `reason` | text | yes | `'No explanation available'` |
| `contributing_factors` | jsonb | yes | `'[]'` |
| `prediction_source` | varchar | no | — |
| `predicted_at` | timestamptz | yes | `now()` |

### `alerts`

| Column | Type | Nullable | Default |
|---|---|---:|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `product_id` | uuid | no | — |
| `type` | varchar | no | — |
| `message` | text | no | — |
| `severity` | varchar | no | — |
| `percent_change` | numeric | yes | — |
| `is_active` | boolean | no | `true` |
| `created_at` | timestamptz | yes | `now()` |
| `legacy_mongo_id` | varchar | yes | — |

### `data_imports`

| Column | Type | Nullable | Default |
|---|---|---:|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `filename` | varchar | no | — |
| `records_processed` | integer | yes | `0` |
| `records_valid` | integer | yes | `0` |
| `records_invalid` | integer | yes | `0` |
| `status` | varchar | yes | `'completed'` |
| `created_at` | timestamptz | yes | `now()` |

### `ai_document_chunks`

The RAG table exists and includes `id` (uuid), `document_key` (varchar), `title` (varchar), `section` (varchar nullable), `content` (text), `content_hash` (char), `embedding` (`vector`, nullable), `version` (varchar, default `'v1'`), `metadata` (jsonb), `created_at` (timestamptz), and `updated_at` (timestamptz). No `tenant_id` column is currently present.

### LangGraph checkpointer tables

The database also contains `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`, and `checkpoint_migrations`. These are LangGraph/Postgres checkpointer objects, not OpsPulse forward-migration history. `checkpoint_migrations` contains versions 0 through 9.

## Relationships and constraints

### Primary keys

- `products(id)`
- `sales(id)`
- `predictions(id)`
- `alerts(id)`
- `data_imports(id)`
- `ai_document_chunks(id)`
- Checkpointer tables have their expected composite keys.

### Foreign keys

- `sales.product_id → products.id ON DELETE CASCADE`
- `predictions.product_id → products.id ON DELETE CASCADE`
- `alerts.product_id → products.id ON DELETE CASCADE`

There are no tenant composite foreign keys.

### Unique constraints

- `sales(product_id, sale_date)`
- `predictions(product_id)`
- `ai_document_chunks(document_key, content_hash, version)`

### Check constraints

- `sales.quantity > 0`
- `predictions.confidence IN ('Low', 'Medium', 'High')`
- `predictions.decision IN ('increase', 'maintain', 'reduce')`
- `predictions.impact IN ('increase', 'decrease', 'neutral')`
- `predictions.prediction_source IN ('ml', 'rule-based')`
- `alerts.type IN ('HIGH_DEMAND', 'LOW_DEMAND', 'TREND_UP', 'TREND_DOWN')`
- `alerts.severity IN ('LOW', 'MEDIUM', 'HIGH')`

### Indexes

- Products: primary-key index, `idx_products_name`, `idx_products_legacy_mongo_id`
- Sales: primary-key index, `idx_sales_product_id`, `idx_sales_sale_date`, unique `(product_id, sale_date)` index
- Predictions: primary-key index, `idx_predictions_product_id`, `idx_predictions_predicted_at`, unique `(product_id)` index
- Alerts: primary-key index, `idx_alerts_product_active`, `idx_alerts_severity`, partial unique `idx_alerts_legacy_mongo_id`
- Data imports: primary-key index, `idx_data_imports_created_at`
- AI chunks: primary-key index, `idx_ai_document_chunks_document_key`, global unique document/content/version index, HNSW embedding index
- Checkpointer tables: primary-key and thread lookup indexes as emitted by `pg_dump`

## Tenant isolation

No tenant-related columns or constraints currently exist on the application tables. Specifically absent are:

- `tenant_id` on products, sales, predictions, alerts, data imports, and AI document chunks
- Composite `(tenant_id, id)` product uniqueness
- Tenant-scoped foreign keys
- Tenant-scoped unique constraints and indexes
- Tenant checks or RLS policies
- `agent_runs` and `agent_steps`

This confirms migration 005 has not been applied.

## Baseline row counts

| Table | Rows |
|---|---:|
| `products` | 20 |
| `sales` | 105 |
| `predictions` | 17 |
| `alerts` | 1 |
| `data_imports` | 0 |

The schema export intentionally contains no row data.

## Migration status based on live inspection

| Migration | Assessment | Evidence |
|---|---|---|
| 001 | Appears applied | Base application tables, columns, keys, foreign keys, checks, and indexes exist |
| 002 | Appears applied | `alerts.legacy_mongo_id` and its partial unique index exist |
| 003 | Appears applied | `vector` extension, `ai_document_chunks`, and HNSW index exist |
| 004 | Pending | `agent_runs` and `agent_steps` are absent |
| 005 | Pending | All tenant columns and tenant constraints are absent |
| 006 | Pending | `products.stock_quantity` and `inventory_movements` are absent |
| 007 | Pending | `products.reorder_threshold` and `predictions.prediction_horizon_days` are absent |
| 008 | Pending | `inventory_agent_actions` is absent |

No application migration-history table was found. The first three statuses are schema-based inferences, not records from a migration ledger. `checkpoint_migrations` is unrelated LangGraph metadata.

## Verification and limitations

- The SQL file exists and is non-empty; it was generated with PostgreSQL `pg_dump --schema-only`.
- Live columns, constraints, indexes, extensions, and row counts were queried independently and documented above.
- No migrations, DDL, DML, or database objects were changed.
- SSL was requested for the export process, but the database session inspection reported `ssl = false`; this should be investigated before relying on transport encryption.
- `pg_dump` was run with `--no-owner --no-privileges`, so ownership and grant statements are intentionally excluded from the baseline.
