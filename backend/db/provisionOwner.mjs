import "dotenv/config";
import pg from "pg";
import { clerkClient } from "@clerk/express";
import { newDatabaseOptions } from "../src/config/newDatabase.js";

const [clerkId, tenantId, name, confirmation] = process.argv.slice(2);
if (!/^user_[A-Za-z0-9]+$/.test(clerkId || "") ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenantId || "") ||
    !name?.trim() || confirmation !== "--assign-owner") {
  console.error("Usage: node db/provisionOwner.mjs <clerk-user-id> <tenant-slug> <tenant-name> --assign-owner");
  process.exit(1);
}

let client;
try {
  client = new pg.Client(newDatabaseOptions());
  const clerkUser = await clerkClient.users.getUser(clerkId);
  if (clerkUser.id !== clerkId || clerkUser.banned || clerkUser.locked) throw new Error("Clerk user is unavailable");

  await client.connect();
  await client.query("BEGIN");
  const { rows: [version] } = await client.query(
    "SELECT version FROM public.opspulse_schema_migrations WHERE version = $1", ["001_fresh_opspulse"],
  );
  if (!version) throw new Error("Fresh database is not initialized");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [tenantId]);
  const { rows: [tenant] } = await client.query("SELECT name FROM public.tenants WHERE id = $1", [tenantId]);
  if (tenant && tenant.name !== name.trim()) throw new Error("Tenant already exists with a different name");

  if (tenant) {
    const previous = await client.query(`
      SELECT 1 FROM public.tenant_memberships m JOIN public.app_users u ON u.id = m.user_id
      WHERE m.tenant_id = $1 AND u.clerk_user_id = $2 AND m.role = 'owner' AND m.revoked_at IS NULL
    `, [tenantId, clerkId]);
    if (!previous.rowCount) throw new Error("An existing tenant requires a separate ownership operation");
  } else {
    const { rows: [user] } = await client.query(`
      INSERT INTO public.app_users(clerk_user_id) VALUES ($1)
      ON CONFLICT (clerk_user_id) DO UPDATE SET clerk_user_id = EXCLUDED.clerk_user_id RETURNING id
    `, [clerkId]);
    await client.query("INSERT INTO public.tenants(id, name) VALUES ($1, $2)", [tenantId, name.trim()]);
    await client.query("INSERT INTO public.tenant_memberships(tenant_id, user_id, role) VALUES ($1, $2, 'owner')", [tenantId, user.id]);
  }
  await client.query("COMMIT");
  console.log("Tenant owner provisioned");
} catch (error) {
  if (client) await client.query("ROLLBACK").catch(() => {});
  console.error("Owner provisioning failed:", error.code || error.name);
  process.exitCode = 1;
} finally {
  await client?.end();
}
