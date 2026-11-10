import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthenticatedRequestConfig,
  classifyApiError,
  createAuthorizationHeaders,
  extractTenantMemberships,
  getSafeApiErrorLog,
  getSafeApiErrorMessage,
  isTenantContextStale,
  selectTenantId,
} from "./authSupport.js";
import { clearSelectedTenantId, getSelectedTenantId, setSelectedTenantId } from "./tenantState.js";

test("extracts supported Firebase tenant claim shapes", () => {
  assert.deepEqual(extractTenantMemberships({
    tenantId: "tenant-a",
    tenant_ids: ["tenant-b", { tenant_id: "tenant-c" }, { id: "tenant-d" }],
    tenants: [{ tenantId: "tenant-a" }],
  }), ["tenant-a", "tenant-b", "tenant-c", "tenant-d"]);
});

test("automatically selects the only tenant membership", () => {
  assert.equal(selectTenantId({ tenantIds: ["tenant-a"] }), "tenant-a");
});

test("requires explicit selection for multiple memberships", () => {
  assert.equal(selectTenantId({ tenantIds: ["tenant-a", "tenant-b"] }), null);
});

test("preserves a valid selection during token refresh and clears it after account switching", () => {
  assert.equal(selectTenantId({ tenantIds: ["tenant-a", "tenant-b"], previousTenantId: "tenant-b" }), "tenant-b");
  assert.equal(selectTenantId({ tenantIds: ["tenant-c"], previousTenantId: "tenant-b" }), "tenant-c");
  assert.equal(selectTenantId({ tenantIds: ["tenant-a", "tenant-b"], previousTenantId: null }), null);
});

test("attaches bearer and selected tenant headers without storing tokens", () => {
  assert.deepEqual(createAuthorizationHeaders({
    headers: { "Content-Type": "application/json" },
    token: "firebase-token",
    tenantId: "tenant-a",
  }), {
    "Content-Type": "application/json",
    Authorization: "Bearer firebase-token",
    "X-Tenant-ID": "tenant-a",
  });
});

test("rejects an API request when no Firebase user is available", async () => {
  await assert.rejects(
    () => buildAuthenticatedRequestConfig({
      config: {},
      getCurrentUser: () => null,
      getTenantId: () => null,
      getTenantContextVersion: () => 1,
    }),
    (error) => error.code === "AUTHENTICATION_REQUIRED",
  );
});

test("request interceptor obtains a Firebase token and attaches the selected tenant", async () => {
  const config = await buildAuthenticatedRequestConfig({
    config: { headers: { "Content-Type": "application/json" } },
    getCurrentUser: () => ({ getIdToken: async () => "fresh-firebase-token" }),
    getTenantId: () => "tenant-a",
    getTenantContextVersion: () => 7,
  });

  assert.equal(config.headers.Authorization, "Bearer fresh-firebase-token");
  assert.equal(config.headers["X-Tenant-ID"], "tenant-a");
  assert.equal(config.metadata.tenantContextVersion, 7);
});

test("clears tenant selection on logout", () => {
  setSelectedTenantId("tenant-a");
  clearSelectedTenantId();
  assert.equal(getSelectedTenantId(), null);
});

test("classifies 401, 403, and 503 responses without retrying", () => {
  assert.equal(classifyApiError({ response: { status: 401 } }).code, "UNAUTHENTICATED");
  assert.equal(classifyApiError({ response: { status: 403 } }).code, "FORBIDDEN");
  assert.equal(classifyApiError({ response: { status: 503 } }).code, "SERVICE_UNAVAILABLE");
  assert.equal(classifyApiError({ response: { status: 500 } }), null);
});

test("marks responses from an older tenant context as stale", () => {
  assert.equal(isTenantContextStale(2, 3), true);
  assert.equal(isTenantContextStale(3, 3), false);
  assert.equal(isTenantContextStale(undefined, 3), false);
});

test("does not expose backend details or request credentials in UI errors and logs", () => {
  const error = {
    code: "ERR_BAD_RESPONSE",
    config: { headers: { Authorization: "Bearer secret-token" } },
    response: {
      status: 500,
      data: { error: "postgres password=super-secret" },
    },
  };

  assert.equal(getSafeApiErrorMessage(error, "Request failed."), "Request failed.");
  assert.deepEqual(getSafeApiErrorLog(error), { status: 500, code: "ERR_BAD_RESPONSE" });
});

test("preserves safe backend validation messages across supported response shapes", () => {
  assert.equal(
    getSafeApiErrorMessage({ response: { status: 400, data: { message: "Invalid productId" } } }, "Fallback"),
    "Invalid productId",
  );
  assert.equal(
    getSafeApiErrorMessage({ response: { status: 400, data: { error: { message: "question is required" } } } }, "Fallback"),
    "question is required",
  );
});
