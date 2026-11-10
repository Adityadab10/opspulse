import test from "node:test";
import assert from "node:assert/strict";
import { createFirebaseAuthMiddleware } from "../middleware/firebaseAuth.js";
import { createTenantContextMiddleware } from "../middleware/tenantContext.js";
import { createPredictionRouter } from "./predictionRoutes.js";

const requestRouter = async ({ authorization, tenantId, user }) => {
  const authMiddleware = createFirebaseAuthMiddleware({
    verifyIdToken: async () => user,
  });
  const tenantMiddleware = createTenantContextMiddleware();
  const router = createPredictionRouter({
    authMiddleware,
    tenantMiddleware,
    mlServiceMiddleware: (_req, _res, next) => next(),
  });
  const req = {
    method: "GET",
    url: "/",
    originalUrl: "/api/predictions/",
    headers: {
      ...(authorization ? { authorization } : {}),
      ...(tenantId ? { "x-tenant-id": tenantId } : {}),
    },
  };
  const response = { statusCode: 200, body: null };
  let finish;
  const completed = new Promise((resolve) => {
    finish = resolve;
  });
  const res = {
    status(code) {
      response.statusCode = code;
      return res;
    },
    json(payload) {
      response.body = payload;
      finish();
      return res;
    },
    setHeader() {},
    end() {},
  };

  router(req, res, () => finish());
  await completed;
  return response;
};

test("prediction endpoint rejects missing Firebase authentication", async () => {
  const response = await requestRouter({ user: { uid: "user-123", tenant_id: "tenant-a" } });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { message: "Authorization is required" });
});

test("prediction endpoint rejects missing tenant context", async () => {
  const response = await requestRouter({
    authorization: "Bearer verified-token",
    user: { uid: "user-123" },
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { message: "Tenant context is required" });
});

test("prediction endpoint rejects unauthorized tenant selection", async () => {
  const response = await requestRouter({
    authorization: "Bearer verified-token",
    tenantId: "tenant-b",
    user: { uid: "user-123", tenant_id: "tenant-a" },
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { message: "Tenant access denied" });
});
