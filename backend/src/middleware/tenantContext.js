import { updateRequestContext } from "../services/requestContext.js";

const TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const asTenantId = (value) => {
  if (typeof value !== "string") return null;
  const tenantId = value.trim();
  return TENANT_ID_PATTERN.test(tenantId) ? tenantId : null;
};

const membershipTenantId = (membership) => {
  if (typeof membership === "string") return membership;
  if (!membership || typeof membership !== "object") return null;
  return membership.tenantId || membership.tenant_id || membership.id;
};

const uniqueTenantIds = (values) => [
  ...new Set(values.map(membershipTenantId).map(asTenantId).filter(Boolean)),
];

const tenantIdsFromClaim = (claim) => {
  if (typeof claim === "string") return [claim];
  if (!Array.isArray(claim)) return [];

  return claim.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (!entry || typeof entry !== "object") return [];
    return [entry.tenantId, entry.tenant_id, entry.id].filter(Boolean);
  });
};

export const extractTrustedTenantIds = (user) => {
  if (!user || typeof user !== "object") return [];

  return uniqueTenantIds([
    user.tenantId,
    user.tenant_id,
    ...tenantIdsFromClaim(user.tenantIds),
    ...tenantIdsFromClaim(user.tenant_ids),
    ...tenantIdsFromClaim(user.tenants),
  ]);
};

const requestedTenantValues = (req) => [
  req?.headers?.["x-tenant-id"],
  req?.body?.tenantId,
  req?.body?.tenant_id,
  req?.query?.tenantId,
  req?.query?.tenant_id,
].filter((value) => value !== undefined && value !== null && value !== "");

const getRequestedTenantId = (req) => {
  const requested = requestedTenantValues(req);
  if (requested.length === 0) return null;

  const normalized = requested.map(asTenantId);
  if (normalized.some((tenantId) => !tenantId)) {
    const error = new Error("Invalid tenant context");
    error.code = "INVALID_TENANT_CONTEXT";
    throw error;
  }

  const unique = [...new Set(normalized)];
  if (unique.length > 1) {
    const error = new Error("Conflicting tenant context");
    error.code = "CONFLICTING_TENANT_CONTEXT";
    throw error;
  }
  return unique[0];
};

const defaultResolveMemberships = async ({ user }) => extractTrustedTenantIds(user);

export const resolveTenantContext = async ({ user, requestedTenantId, resolveMemberships = defaultResolveMemberships }) => {
  const userId = typeof user?.uid === "string" ? user.uid.trim() : "";
  if (!userId) {
    const error = new Error("Authenticated user identity is missing");
    error.code = "MISSING_USER_ID";
    throw error;
  }

  const memberships = await resolveMemberships({ user });
  const trustedTenantIds = uniqueTenantIds(Array.isArray(memberships) ? memberships : []);
  if (trustedTenantIds.length === 0) {
    const error = new Error("Tenant context is required");
    error.code = "MISSING_TENANT_CONTEXT";
    throw error;
  }

  if (requestedTenantId && !trustedTenantIds.includes(requestedTenantId)) {
    const error = new Error("Tenant access denied");
    error.code = "UNAUTHORIZED_TENANT";
    throw error;
  }

  if (!requestedTenantId && trustedTenantIds.length > 1) {
    const error = new Error("Tenant context is required");
    error.code = "MISSING_TENANT_CONTEXT";
    throw error;
  }

  return {
    userId,
    tenantId: requestedTenantId || trustedTenantIds[0],
  };
};

const sendTenantError = (res, error) => {
  if (error.code === "MISSING_USER_ID") {
    return res.status(401).json({ message: "Authenticated user identity is required" });
  }
  if (error.code === "UNAUTHORIZED_TENANT") {
    return res.status(403).json({ message: "Tenant access denied" });
  }
  if (error.code === "INVALID_TENANT_CONTEXT" || error.code === "CONFLICTING_TENANT_CONTEXT") {
    return res.status(400).json({ message: "Invalid tenant context" });
  }
  if (error.code === "MISSING_TENANT_CONTEXT") {
    return res.status(400).json({ message: "Tenant context is required" });
  }
  return res.status(503).json({ message: "Tenant authorization is unavailable" });
};

export const createTenantContextMiddleware = ({ resolveMemberships = defaultResolveMemberships } = {}) =>
  async (req, res, next) => {
    if (req.clerkUserId && !req.memberships?.length) {
      return res.status(403).json({ message: "Tenant membership is required" });
    }
    try {
      const context = await resolveTenantContext({
        user: req.user,
        requestedTenantId: getRequestedTenantId(req),
        resolveMemberships,
      });
      req.authContext = Object.freeze(context);
      req.tenantId = context.tenantId;
      updateRequestContext(context);
      return next();
    } catch (error) {
      return sendTenantError(res, error);
    }
  };

export const requireTenantContext = createTenantContextMiddleware();
