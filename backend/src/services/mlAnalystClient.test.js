import test from "node:test";
import assert from "node:assert/strict";

import { requestMlService } from "./mlAnalystClient.js";
import { runWithRequestContext } from "./requestContext.js";

test("forwards trusted identity, internal token, and correlation ID to ML services", async () => {
  let request;
  const response = await runWithRequestContext({
    userId: "user-123",
    tenantId: "tenant-456",
    correlationId: "corr-789",
  }, () => requestMlService({
    url: "http://ml.test/predict",
    timeoutMs: 1000,
    internalToken: "internal-test-token",
    body: { productId: "product-1" },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  }));

  assert.equal(response.ok, true);
  assert.equal(request.url, "http://ml.test/predict");
  assert.deepEqual(request.options.headers, {
    "Content-Type": "application/json",
    "X-User-ID": "user-123",
    "X-Tenant-ID": "tenant-456",
    "X-ML-Internal-Token": "internal-test-token",
    "X-Correlation-ID": "corr-789",
  });
  assert.deepEqual(JSON.parse(request.options.body), { productId: "product-1" });
});
