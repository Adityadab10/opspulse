const TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const asTenantId = (value) => {
  if (typeof value !== "string") return null;
  const tenantId = value.trim();
  return TENANT_ID_PATTERN.test(tenantId) ? tenantId : null;
};

const tenantIdFromMembership = (membership) => {
  if (typeof membership === "string") return membership;
  if (!membership || typeof membership !== "object") return null;
  return membership.tenantId || membership.tenant_id || membership.id;
};

const tenantIdsFromClaim = (claim) => {
  if (typeof claim === "string") return [claim];
  if (!Array.isArray(claim)) return [];

  return claim.map(tenantIdFromMembership);
};

export const extractTenantMemberships = (claims = {}) => {
  const candidates = [
    claims.tenantId,
    claims.tenant_id,
    ...tenantIdsFromClaim(claims.tenantIds),
    ...tenantIdsFromClaim(claims.tenant_ids),
    ...tenantIdsFromClaim(claims.tenants),
  ];

  return [...new Set(candidates.map(asTenantId).filter(Boolean))];
};

export const selectTenantId = ({ tenantIds = [], previousTenantId = null }) => {
  if (previousTenantId && tenantIds.includes(previousTenantId)) {
    return previousTenantId;
  }

  return tenantIds.length === 1 ? tenantIds[0] : null;
};

export const createAuthorizationHeaders = ({ headers = {}, token, tenantId }) => {
  const nextHeaders = { ...headers };

  if (token) {
    nextHeaders.Authorization = `Bearer ${token}`;
  } else {
    delete nextHeaders.Authorization;
  }

  if (tenantId) {
    nextHeaders["X-Tenant-ID"] = tenantId;
  } else {
    delete nextHeaders["X-Tenant-ID"];
  }

  return nextHeaders;
};

export const buildAuthenticatedRequestConfig = async ({
  config = {},
  getCurrentUser,
  getTenantId,
  getTenantContextVersion = () => 0,
}) => {
  const user = getCurrentUser();
  if (!user) {
    const error = new Error("Authentication is required");
    error.code = "AUTHENTICATION_REQUIRED";
    throw error;
  }

  const token = await user.getIdToken();
  return {
    ...config,
    metadata: {
      ...config.metadata,
      tenantContextVersion: getTenantContextVersion(),
    },
    headers: createAuthorizationHeaders({
      headers: config.headers,
      token,
      tenantId: getTenantId(),
    }),
  };
};

export const classifyApiError = (error) => {
  const status = error?.response?.status;
  if (status === 401) {
    return { status, code: "UNAUTHENTICATED", message: "Your session has expired. Please sign in again." };
  }
  if (status === 403) {
    return { status, code: "FORBIDDEN", message: "You are not authorized for this tenant." };
  }
  if (status === 503) {
    return { status, code: "SERVICE_UNAVAILABLE", message: "The service is temporarily unavailable. Please try again later." };
  }
  return null;
};

export const isTenantContextStale = (requestVersion, currentVersion) =>
  Number.isInteger(requestVersion) && requestVersion !== currentVersion;

export const isStaleTenantContextError = (error) => error?.code === "STALE_TENANT_CONTEXT";

export const getSafeApiErrorMessage = (error, fallback) => {
  const classified = classifyApiError(error);
  if (classified) return classified.message;
  if (isStaleTenantContextError(error)) return null;

  const status = error?.response?.status;
  const payload = error?.response?.data;
  const serverMessage = payload?.message || payload?.error?.message || payload?.error;
  if (status && status < 500 && typeof serverMessage === "string" && serverMessage.length <= 200) {
    return serverMessage;
  }

  return fallback;
};

export const getSafeApiErrorLog = (error) => ({
  status: error?.response?.status || null,
  code: error?.code || null,
});
