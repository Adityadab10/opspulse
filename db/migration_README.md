# OpsPulse MongoDB → PostgreSQL Migration

## Migration Objective
Migrate the existing MongoDB data layer to PostgreSQL (Supabase) while preserving all existing functionality, data integrity, and behavioral semantics. The PostgreSQL database will become the primary data store for the Node.js backend, with MongoDB retained as the source of truth during migration and for the ML service.

## Source Database
- **MongoDB** — current production data store
- **Collections**: `products`, `sales`, `predictions`, `alerts`
- **Connection**: `MONGO_URI` from `backend/.env`
- **Note**: MongoDB Atlas DNS resolution may fail in some environments (`ENOTFOUND _mongodb._tcp.inventory-intelligence.obpf9ma.mongodb.net`). This is an environment DNS issue, not a data or schema problem.

## Target Database
- **PostgreSQL** — managed via Supabase
- **Connection**: `DATABASE_URL` from `backend/.env`
- **Tables**: `products`, `sales`, `predictions`, `alerts`, `data_imports`
- **Hosted**: `aws-0-ap-south-1.pooler.supabase.com:5432`

## Table Mapping

| MongoDB Collection | PostgreSQL Table | Key Mapping |
|-------------------|----------------|-------------|
| `products` | `products` | `._id` → `id` (UUID), `name` → `name`, `category` → `category` |
| `sales` | `sales` | `productId` → `product_id` (FK), `date` → `sale_date` (TIMESTAMPTZ), `quantity` → `quantity` |
| `predictions` | `predictions` | `productId` → `product_id` (FK, UNIQUE), all fields mapped snake_case |
| `alerts` | `alerts` | `productId` → `product_id` (FK), `type` → `type`, `severity` → `severity` |
| (not in MongoDB) | `data_imports` | Tracks CSV ingestion history (new table) |

## Transformation Rules

### Products
- **Normalized identity**: `${name.toLowerCase()}__${category.toLowerCase()}`
- **Deduplication**: Same normalized identity → one product record (first capitalization preserved)
- **Legacy mapping**: `legacy_mongo_id` field stores original MongoDB ObjectId as VARCHAR(24)
- **UUID conversion**: MongoDB ObjectId → PostgreSQL UUID via `gen_random_uuid()` for new records; original ObjectId stored in `legacy_mongo_id`

### Sales
- **Uniqueness constraint**: `UNIQUE (product_id, sale_date)` — enforces MongoDB upsert semantics (one record per product per date)
- **Product foreign key**: `product_id` references `products(id) ON DELETE CASCADE`
- **Date**: `sale_date` as TIMESTAMPTZ; JavaScript Date → ISO date portion (`YYYY-MM-DD`) for key generation
- **Quantity**: INTEGER NOT NULL CHECK (quantity > 0)

### Predictions
- **Uniqueness constraint**: `UNIQUE (product_id)` — one prediction per product
- **All fields mapped** from MongoDB camelCase to PostgreSQL snake_case:
  - `predictedDemand` → `predicted_demand` NUMERIC(12,2)
  - `rulePrediction` → `rule_prediction` NUMERIC(12,2)
  - `mlPrediction` → `ml_prediction` NUMERIC(12,2)
  - `adjustedPrediction` → `adjusted_prediction` NUMERIC(12,2)
  - `avgSales` → `avg_sales` NUMERIC(12,2)
  - `percentChange` → `percent_change` NUMERIC(8,2)
  - `confidence` VARCHAR(10) CHECK (IN ('Low','Medium','High'))
  - `seasonTag` VARCHAR(50)
  - `decision` VARCHAR(20) CHECK (IN ('increase','maintain','reduce'))
  - `impact` VARCHAR(20) CHECK (IN ('increase','decrease','neutral'))
  - `keyword` VARCHAR(100)
  - `score` NUMERIC(5,2) DEFAULT 0
  - `sourceHeadline` VARCHAR(255)
  - `sourceHeadlines` JSONB DEFAULT '[]'
  - `matchedKeywords` JSONB DEFAULT '[]'
  - `reason` TEXT DEFAULT 'No explanation available'
  - `contributingFactors` JSONB DEFAULT '[]'
  - `predictionSource` VARCHAR(20) CHECK (IN ('ml','rule-based'))
  - `predictedAt` TIMESTAMPTZ DEFAULT now()

### Alerts
- **Foreign key**: `product_id` references `products(id) ON DELETE CASCADE`
- **type**: VARCHAR(30) CHECK (IN ('HIGH_DEMAND','LOW_DEMAND','TREND_UP','TREND_DOWN'))
- **severity**: VARCHAR(10) CHECK (IN ('LOW','MEDIUM','HIGH'))
- **is_active**: BOOLEAN DEFAULT true

### data_imports (new table)
- Tracks CSV ingestion: filename, records_processed, records_valid, records_invalid, status, created_at
- Used for auditability and re-running migrations

## Migration Toolset

### Scripts (`db/scripts/`)
- `migrate.js` — Main orchestration script (dry-run mode by default)
- `validate.js` — Post-migration validation checks
- `tests.js` — Unit tests for transformation logic

### Migration SQL (`db/migrations/`)
- `001_initial_schema.sql` — Initial schema for 5 approved tables

### Key Commands

#### Dry-run migration (RECOMMENDED FIRST STEP)
```bash
cd backend && node db/scripts/migrate.js
```
- Connects to MongoDB and PostgreSQL
- Reads all source data into memory
- Transforms and validates in memory
- Calculates what WOULD be inserted
- Reports: product/sales/prediction/alert counts, duplicates, orphans, invalid records
- Does NOT write to either database
- **This is the safest way to validate migration correctness before actual cutover**

#### Syntax/import validation only (no DB access required)
```bash
cd backend && node -e "import('./db/scripts/migrate.js')" 2>&1 | head -20
```

#### PostgreSQL connectivity validation
```bash
cd backend && node -e "import('pg').then(p => new p.Pool({connectionString: process.env.DATABASE_URL})).then(pool => pool.connect().then(c => {console.log('PG connected'); c.release();}).catch(e => console.error('PG error:', e.message)).finally(() => pool.end()))"
```

#### MongoDB connectivity validation
```bash
cd backend && node -e "import('mongoose').then(m => m.connect(process.env.MONGO_URI)).then(() => {console.log('MongoDB connected'); mongoose.disconnect();}).catch(e => console.error('MongoDB error:', e.message))"
```

#### Post-dry-run validation
```bash
cd backend && node db/scripts/validate.js
```

#### Run the approved PostgreSQL schema migration
```bash
# The SQL migration file is at: db/migrations/001_initial_schema.sql
# It has already been run against the Supabase PostgreSQL database
# Do not run again unless schema needs updating
```

## Safety Rules

1. **MongoDB data is never deleted or dropped** — remains the source of truth
2. **Mongoose models remain intact** — no modifications to existing schemas
3. **PostgreSQL schema is idempotent** — `CREATE TABLE IF NOT EXISTS`; re-running is safe
4. **Dry-run mode** — no data written to either database unless explicitly enabled
5. **Foreign keys enforced** — products migrated before dependent records (sales, predictions, alerts)
6. **Partial failures produce actionable logs** — not silent success
7. **Migration is repeatable** — can safely be re-run; idempotent where practical
8. **DNS issue acknowledged** — MongoDB Atlas connectivity may fail in some environments; dry-run will report this and continue with structural analysis

## Rollback Strategy
- If migration issues are discovered, switch backend MongoDB connection string to re-enable MongoDB
- Keep MongoDB collections intact during and after migration period
- Audit logs track what was migrated and when
- PostgreSQL schema uses `IF NOT EXISTS` for idempotency; data can be cleaned up manually if needed
- Coexistence period: both MongoDB and PostgreSQL can run in parallel with sync status tracking

## Known Limitations
- MongoDB DNS resolution (`ENOTFOUND`) may fail in some execution environments
- Migration tooling is designed for incremental, validated cutover — not one-shot bulk import
- Product deduplication relies on case-insensitive name+category matching; existing MongoDB data with case variations must be deduplicated during migration
- Date format: MongoDB `Date` objects have time components; PostgreSQL `TIMESTAMPTZ` preserves timezone-aware timestamps. Migration converts to date-level keys for uniqueness but preserves full timestamps in the column.

## Migration Order
1. **Products** — migrated first (dependency root)
2. **Sales** — depends on products (FK product_id → products.id)
3. **Predictions** — depends on products (FK product_id → products.id, UNIQUE constraint)
4. **Alerts** — depends on products (FK product_id → products.id)
5. **data_imports** — can be populated anytime after CSV upload functionality is active

## Rollback Procedure
1. If issues discovered during or after migration: switch backend to MongoDB connection only
2. Keep MongoDB collections intact — do not drop or delete
3. Truncate PostgreSQL tables and re-run migration if structural issues found
4. Use audit logs to reconstruct state if needed
5. Coexist with MongoDB until PostgreSQL stability confirmed (2-4 weeks minimum)

## Contact / Support
- Migration tooling located in `db/scripts/` and `db/migrations/`
- Do NOT modify `.env` files containing credentials
- Do NOT commit DATABASE_URL or MONGO_URI to version control