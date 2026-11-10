import test from "node:test";
import assert from "node:assert/strict";

import { createTenantContextMiddleware } from "./tenantContext.js";

const invoke = async ({ user, headers = {}, body = {}, query = {}, resolveMemberships } = {}) => {
  const req = { user, headers, body, query };
  const response = { statusCode: 200, body: null };
  const res = {
    status(code) {
      response.statusCode = code;
      return res;
    },
    json(payload) {
      response.body = payload;
      return res;
    },
  };
  let nextCalled = false;

  await createTenantContextMiddleware({ resolveMemberships })(req, res, () => {
    nextCalled = true;
  });
  return { ...response, nextCalled, req };
};

test("resolves a tenant from verified Firebase membership claims", async () => {
  const response = await invoke({
    user: { uid: "user-123", tenant_id: "tenant-a" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.nextCalled, true);
  assert.deepEqual(response.req.authContext, { userId: "user-123", tenantId: "tenant-a" });
});

test("rejects missing tenant context", async () => {
  const response = await invoke({ user: { uid: "user-123" } });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { message: "Tenant context is required" });
  assert.equal(response.nextCalled, false);
});

test("rejects multiple memberships without an explicit tenant selection", async () => {
  const response = await invoke({
    user: { uid: "user-123", tenant_ids: ["tenant-a", "tenant-b"] },
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { message: "Tenant context is required" });
  assert.equal(response.nextCalled, false);
});

test("rejects an unauthorized client-supplied tenant", async () => {
  const response = await invoke({
    user: { uid: "user-123", tenant_id: "tenant-a" },
    headers: { "x-tenant-id": "tenant-b" },
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { message: "Tenant access denied" });
  assert.equal(response.nextCalled, false);
});

test("validates client tenant selection against server-side membership", async () => {
  const response = await invoke({
    user: { uid: "user-123" },
    headers: { "x-tenant-id": "tenant-b" },
    resolveMemberships: async ({ user }) => {
      assert.equal(user.uid, "user-123");
      return ["tenant-a", "tenant-b"];
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.nextCalled, true);
  assert.equal(response.req.tenantId, "tenant-b");
});

test("rejects conflicting tenant values instead of choosing one", async () => {
  const response = await invoke({
    user: { uid: "user-123", tenant_id: "tenant-a" },
    headers: { "x-tenant-id": "tenant-a" },
    body: { tenantId: "tenant-b" },
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { message: "Invalid tenant context" });
  assert.equal(response.nextCalled, false);
});
