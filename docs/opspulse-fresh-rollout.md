# Fresh OpsPulse rollout

The fresh project is `gobvtqiwtgmbjkxtaiuq`. Both services use the Session Pooler `aws-1-ap-northeast-1.pooler.supabase.com:5432`. The archived project remains outside this workflow.

## Verified TLS and schema setup

1. In the fresh Supabase dashboard, download the database CA under **Database Settings → SSL Configuration**. Save it under the ignored `.opspulse-local/` directory and set `OPSPULSE_DATABASE_CA_FILE` to its absolute path in both service environment files. The files may retain `sslmode=require` in the URL. Node enforces certificate validation with the supplied CA and Python uses `verify-full`.
2. Set `OPSPULSE_NEW_DATABASE_URL` to the operator connection for the fresh project. From `backend/`, run `node db/bootstrapFresh.mjs` for the read-only preflight. Once the reported target is verified, run `node db/bootstrapFresh.mjs --apply`. The bootstrap checks for existing application objects, locks the initial migration, and records its version transactionally.
3. Provision separate PostgreSQL login roles with strong credentials in Supabase. Give each login only its corresponding group membership from the bootstrap: `opspulse_express`, `opspulse_ml`, or `opspulse_checkpointer`. Use inheriting logins with no ownership, superuser, or bypass-RLS attributes. Configure the first two service-local `OPSPULSE_RUNTIME_DATABASE_URL` values and the ML-only `OPSPULSE_CHECKPOINT_DATABASE_URL` using their respective login credentials. Keep operator credentials outside the deployed app processes.
4. From `ml-service/`, run `python setup_checkpoints.py` using the verified operator connection. This uses LangGraph's own versioned setup in `opspulse_checkpoints`. Then start FastAPI with the checkpoint role and `LANGGRAPH_CHECKPOINTER=postgres`.

Supabase publishes the certificate download and endpoint instructions in its [database connection documentation](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Tenant provisioning and demo data

From `backend/`, provision an existing verified Clerk user:

```sh
node db/provisionOwner.mjs <clerk-user-id> <tenant-slug> "<Tenant Name>" --assign-owner
```

The command verifies the subject through Clerk, creates the tenant and owner in one transaction, and is safe to repeat for the same active owner. A Clerk signup alone does not grant tenant access. Membership changes are an operator task until an owner administration interface is supplied.

Owners and members can use the normal business and AI routes within their own active memberships. Owners can approve, reject and execute Inventory Agent actions. These decisions require a human Clerk session. An owner who requested the recommendation can decide it under the current policy. The agent proposes actions through the internal FastAPI call and has no approval route or write privileges on the action table.

To seed a dedicated demo environment, provision `synthetic-demo` with display name `OpsPulse Synthetic Demo` and an existing Clerk owner. Run `node db/seedDemo.mjs --seed-synthetic-demo`. It adds three synthetic products, opening movements, 150 days of sales per product and deterministic forecast fixtures. Resuming an already seeded tenant preserves subsequent changes.

Publish shared RAG documents with `python seed_rag_documents.py` from the ML service using the operator configuration and embedding dependencies. Retrieval uses authenticated tenant scope and permits intentionally shared documentation. Set the LLM base URL, model and API key using the ML environment example. OpenRouter can retire free model IDs. If the provider returns 404, compare the exact configured ID with its models catalog and smoke-test an available replacement before changing the local configuration.

## Local and live verification

Run `node db/verifyFresh.mjs` from `backend/` after setting both restricted runtime URLs. It uses the actual Express and ML logins to check RLS, membership visibility, tenant-preserving foreign keys, vector retrieval, and shared/private RAG upserts. It also sends simultaneous execution requests through the inventory controller and verifies the stock and ledger result. The test creates isolated synthetic fixtures and removes only those fixtures.

Client-side TLS is verified before database setup. If the pooler session reports `pg_stat_ssl.ssl = false`, the pooler-to-database hop is unencrypted even though clients verify the pooler certificate. Enable Supabase's incoming SSL enforcement during an approved deployment window and recheck both connection legs. Supabase documents a database restart for that setting.

Run `npm test` in the backend and `npm run lint`, `npm test` and `npm run build` in the frontend. Run the ML test suite from `ml-service/` with its development dependencies. Use an isolated fixture database for suites that create or reset schemas. Keep the archive and the fresh deployment out of reset-style test fixtures.

Before deployment, verify freshly applied constraints, policies and grants using each actual login. Exercise a two-tenant Clerk sign-in and revocation, production Express-to-FastAPI and API-to-Postgres flows, cross-tenant RAG retrieval, concurrent inventory execution and checkpoint resume after restart. Check that direct requests to FastAPI fail without the internal token. Live provider validation and Firebase dependency removal follow successful Clerk cutover verification.

## Verified rollout state

- TLS identity checks passed against project `gobvtqiwtgmbjkxtaiuq` with Node pg, psycopg and psycopg2. The client verified the pooler hostname and the Supabase CA. PostgreSQL reported that the separate pooler-to-database hop was unencrypted.
- The fresh schema is recorded as `001_fresh_opspulse`. It contains 13 application tables, one migration history table and four private LangGraph tables. The restricted Express, ML and checkpoint logins connected successfully. Runtime logins have no RLS bypass.
- The provisioned Clerk owner loaded the protected `synthetic-demo` dashboard. Repeated demo seeding preserved three products, 450 sales, three opening stock movements and three prediction fixtures.
- Live checks covered RLS and composite foreign keys, shared/private vector retrieval, repeat RAG publication, concurrent inventory execution, seven-day Prophet forecasting, checkpoint persistence across reconnection, and a supervisor run that persisted two specialist steps.
- AI Analyst returned HTTP 200 using tenant data after replacing the retired OpenRouter model ID with `liquid/lfm-3-1.7b:free`. The shared RAG publisher ran twice and left five embedded chunks.
- Backend tests passed 96/96. Frontend tests passed 16/16, and lint and the production build passed. ML tests passed 117 with 23 fixture-dependent skips. The legacy backend integration suite still requires an isolated fixture database.
- Before a production release, separately verify new Clerk sign-up and sign-out, remove the retained Firebase test dependencies after that verification, and confirm SSL on the pooler-to-database hop in a deployment window.
