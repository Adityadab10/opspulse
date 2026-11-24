import "dotenv/config";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { newDatabaseOptions } from "../src/config/newDatabase.js";

const version = "001_fresh_opspulse";
const apply = process.argv.includes("--apply");
let client;
try {
  client = new pg.Client(newDatabaseOptions());
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const { rows: [identity] } = await client.query(
    "SELECT current_database() AS db, current_setting('transaction_read_only') AS read_only",
  );
  if (identity.db !== "postgres" || identity.read_only !== "on") throw new Error("Target identity check failed");
  await client.query("ROLLBACK");
  console.log("Verified TLS and PostgreSQL identity for the fresh OpsPulse project");
  if (apply) {
    const source = await readFile(new URL("../../docs/opspulse-fresh-schema.proposed.sql", import.meta.url), "utf8");
    const match = source.match(/^(?:--[^\r\n]*\r?\n)*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/);
    if (!match) throw new Error("Unexpected consolidated schema transaction format");

    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [version]);
    const { rows: [state] } = await client.query(`
      SELECT to_regclass('public.opspulse_schema_migrations') IS NOT NULL AS initialized,
             to_regnamespace('opspulse_checkpoints') IS NOT NULL AS checkpoint_schema,
             EXISTS (
               SELECT 1 FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               LEFT JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = c.oid
                 AND d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e'
               WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f','S') AND d.objid IS NULL
             ) AS has_objects
    `);
    if (state.initialized) throw new Error("Migration history exists; inspect deployed state before applying");
    if (state.has_objects || state.checkpoint_schema) throw new Error("Fresh database already has application objects");

    await client.query(match[1]);
    await client.query(`
      CREATE TABLE public.opspulse_schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      REVOKE ALL ON public.opspulse_schema_migrations FROM PUBLIC, anon, authenticated, service_role;
      ALTER TABLE public.opspulse_schema_migrations ENABLE ROW LEVEL SECURITY;
    `);
    await client.query("INSERT INTO public.opspulse_schema_migrations(version) VALUES ($1)", [version]);
    await client.query(`
      CREATE ROLE opspulse_express NOLOGIN NOBYPASSRLS;
      CREATE ROLE opspulse_ml NOLOGIN NOBYPASSRLS;
      CREATE ROLE opspulse_checkpointer NOLOGIN NOBYPASSRLS;
      GRANT USAGE ON SCHEMA public, extensions TO opspulse_express, opspulse_ml;
      GRANT SELECT ON public.opspulse_schema_migrations TO opspulse_express, opspulse_ml;
      CREATE POLICY schema_version_read ON public.opspulse_schema_migrations
        FOR SELECT TO opspulse_express, opspulse_ml USING (true);
      GRANT SELECT ON public.app_users, public.tenants, public.tenant_memberships TO opspulse_express;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.products, public.sales,
        public.predictions, public.alerts, public.data_imports, public.inventory_movements TO opspulse_express;
      GRANT SELECT ON public.agent_runs TO opspulse_express;
      GRANT SELECT, INSERT, UPDATE ON public.inventory_agent_actions TO opspulse_express;
      GRANT SELECT ON public.products, public.sales, public.predictions, public.alerts,
        public.inventory_movements, public.ai_document_chunks TO opspulse_ml;
      GRANT SELECT, INSERT, UPDATE ON public.agent_runs, public.agent_steps TO opspulse_ml;
      GRANT USAGE ON SCHEMA opspulse_checkpoints TO opspulse_checkpointer;
      DO $operator$
      DECLARE relation text;
      BEGIN
        FOREACH relation IN ARRAY ARRAY['opspulse_schema_migrations', 'app_users', 'tenants',
          'tenant_memberships', 'products', 'sales', 'predictions', 'inventory_movements', 'ai_document_chunks']
        LOOP
          EXECUTE format('CREATE POLICY trusted_operator ON public.%I TO %I USING (true) WITH CHECK (true)',
            relation, current_user);
        END LOOP;
      END
      $operator$;
    `);

    const expected = ["app_users", "tenants", "tenant_memberships", "products", "sales", "predictions",
      "alerts", "data_imports", "inventory_movements", "ai_document_chunks", "agent_runs", "agent_steps",
      "inventory_agent_actions"];
    const { rows } = await client.query(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1) AND c.relrowsecurity AND c.relforcerowsecurity
    `, [expected]);
    if (rows.length !== expected.length) throw new Error("Expected application tables or RLS flags missing");
    await client.query("COMMIT");
    console.log("Applied consolidated schema and recorded its version");
  }
} catch (error) {
  if (client) await client.query("ROLLBACK").catch(() => {});
  const safeMessage = error.code
    ? error.code
    : error.message.startsWith("OPSPULSE_") ? error.message : "Preflight or bootstrap failed";
  console.error(safeMessage);
  process.exitCode = 1;
} finally {
  await client?.end();
}
