import "dotenv/config";
import { Pool } from "pg";
import { newDatabaseOptions } from "./newDatabase.js";
import { getRequestContext } from "../services/requestContext.js";

const legacyTestUrl = process.env.DATABASE_URL;
let pool = new Pool({
  connectionString: legacyTestUrl && !legacyTestUrl.includes("pcefxrhnzqlgpscnkypg")
    ? legacyTestUrl : "postgresql://unused:unused@127.0.0.1:1/unused",
  connectionTimeoutMillis: 1000,
});

async function setTenant(client, tenantId) {
  await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
}

export function activateFreshDatabase() {
  if (!process.env.OPSPULSE_RUNTIME_DATABASE_URL) throw new Error("OPSPULSE_RUNTIME_DATABASE_URL is required");
  const fresh = new Pool(newDatabaseOptions({
    ...process.env,
    OPSPULSE_NEW_DATABASE_URL: process.env.OPSPULSE_RUNTIME_DATABASE_URL,
  }));
  fresh.on("error", (error) => console.error("PostgreSQL pool error:", error.code || error.name));

  pool = {
    end: () => fresh.end(),
    async query(...args) {
      const { tenantId } = getRequestContext();
      if (!tenantId) return fresh.query(...args);
      const client = await fresh.connect();
      try {
        await client.query("BEGIN");
        await setTenant(client, tenantId);
        const result = await client.query(...args);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async connect() {
      const client = await fresh.connect();
      const { tenantId } = getRequestContext();
      return {
        async query(...args) {
          const result = await client.query(...args);
          if (tenantId && args[0] === "BEGIN") await setTenant(client, tenantId);
          return result;
        },
        release: () => client.release(),
      };
    },
  };
}

export { pool as default };
