import { randomUUID } from "node:crypto";
import { getRequestContext } from "./requestContext.js";

const SENSITIVE_KEYS = /^(authorization|x-ml-internal-token|internal[-_]?token|access[-_]?token|refresh[-_]?token|api[-_]?key|secret|password|credential|private[-_]?key)$/i;
const REDACTED = "[REDACTED]";

const redactString = (value, sensitiveValues) => sensitiveValues.reduce(
  (result, sensitiveValue) => sensitiveValue ? result.split(sensitiveValue).join(REDACTED) : result,
  value,
);

export const sanitizeUpstreamPayload = (payload, sensitiveValues = []) => {
  const secrets = sensitiveValues.filter((value) => typeof value === "string" && value.length > 0);
  const sanitize = (value) => {
    if (typeof value === "string") return redactString(value, secrets);
    if (Array.isArray(value)) return value.map(sanitize);
    if (!value || typeof value !== "object") return value;

    return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [
      key,
      SENSITIVE_KEYS.test(key) ? REDACTED : sanitize(nestedValue),
    ]));
  };

  return sanitize(payload);
};

export const getMlAnalystConfig = () => ({
  url: process.env.ML_ANALYST_URL || "http://localhost:5002/ai-analyst",
  timeoutMs: Number(process.env.ML_ANALYST_TIMEOUT_MS || 25000),
  internalToken: process.env.ML_ANALYST_INTERNAL_TOKEN?.trim(),
});

const getTrustedRequestContext = ({ userId, tenantId, correlationId } = {}) => {
  const requestContext = getRequestContext();
  const resolvedUserId = userId || requestContext.userId;
  const resolvedTenantId = tenantId || requestContext.tenantId;
  if (!resolvedUserId || !resolvedTenantId) {
    const error = new Error("Trusted identity context is required");
    error.code = "MISSING_TRUSTED_CONTEXT";
    throw error;
  }

  return {
    userId: resolvedUserId,
    tenantId: resolvedTenantId,
    correlationId: correlationId || requestContext.correlationId || randomUUID(),
  };
};

export const createMlServiceError = (status) => {
  const error = new Error(`ML service responded with status ${status}`);
  error.code = "ML_SERVICE_REJECTED";
  error.status = status;
  return error;
};

export const requestMlService = async ({
  url,
  body,
  timeoutMs,
  internalToken,
  userId,
  tenantId,
  correlationId,
  fetchImpl = globalThis.fetch,
}) => {
  if (!internalToken) {
    const error = new Error("ML service authorization is not configured");
    error.code = "MISSING_INTERNAL_TOKEN";
    throw error;
  }

  const context = getTrustedRequestContext({ userId, tenantId, correlationId });
  const controller = new AbortController();
  const configuredTimeout = Number(timeoutMs);
  const safeTimeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : 25000;
  const timeoutId = setTimeout(() => controller.abort(), safeTimeout);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-ID": context.userId,
        "X-Tenant-ID": context.tenantId,
        "X-ML-Internal-Token": internalToken,
        "X-Correlation-ID": context.correlationId,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({ error: "Invalid ML response" }));
    return {
      status: response.status,
      ok: response.ok,
      payload: sanitizeUpstreamPayload(payload, [internalToken]),
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

export const requestMlAnalyst = async ({ question, conversation = [], userId, tenantId, correlationId }) => {
  const config = getMlAnalystConfig();
  return requestMlService({
    url: config.url,
    timeoutMs: config.timeoutMs,
    internalToken: config.internalToken,
    body: { question, conversation },
    userId,
    tenantId,
    correlationId,
  });
};
