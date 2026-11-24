import { getAuth } from "@clerk/express";
import pool from "../config/database.js";

export function requireClerkAuth(req, res, next) {
  if (!/^Bearer\s+\S+$/i.test(req.headers.authorization || "")) {
    return res.status(401).json({ message: "Authorization is required" });
  }
  const { userId, sessionId } = getAuth(req, { acceptsToken: "session_token" });
  if (!userId || !sessionId) return res.status(401).json({ message: "Invalid or expired authorization token" });
  req.clerkUserId = userId;
  return next();
}

export async function loadMemberships(req, res, next) {
  const client = await pool.connect().catch(() => null);
  if (!client) return res.status(503).json({ message: "Tenant authorization is unavailable" });
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('app.current_clerk_user_id', $1, true)", [req.clerkUserId]);
    const user = (await client.query("SELECT id FROM app_users WHERE clerk_user_id = $1", [req.clerkUserId])).rows[0];
    let memberships = [];
    if (user) {
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [user.id]);
      memberships = (await client.query(`
        SELECT m.tenant_id AS "tenantId", t.name, m.role
        FROM tenant_memberships m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = $1 AND m.revoked_at IS NULL ORDER BY t.name, m.tenant_id
      `, [user.id])).rows;
    }
    await client.query("COMMIT");
    req.memberships = memberships;
    req.user = user ? { uid: user.id, tenants: memberships } : null;
    return next();
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(503).json({ message: "Tenant authorization is unavailable" });
  } finally {
    client.release();
  }
}

export const requireSessionMembership = [requireClerkAuth, loadMemberships];

export function requireTenantOwner(req, res, next) {
  const role = req.memberships?.find((membership) => membership.tenantId === req.authContext?.tenantId)?.role;
  return role === "owner" ? next() : res.status(403).json({ message: "Owner permission is required" });
}
