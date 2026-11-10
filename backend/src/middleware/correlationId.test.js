import test from "node:test";
import assert from "node:assert/strict";

import { correlationIdMiddleware } from "./correlationId.js";
import { getRequestContext } from "../services/requestContext.js";

const invoke = async (headers = {}) => {
  const req = { headers };
  const response = { statusCode: 200, body: null, headers: {} };
  const res = {
    status(code) {
      response.statusCode = code;
      return res;
    },
    json(payload) {
      response.body = payload;
      return res;
    },
    setHeader(name, value) {
      response.headers[name] = value;
    },
  };
  let nextCalled = false;
  let nextContext;

  await correlationIdMiddleware(req, res, () => {
    nextCalled = true;
    nextContext = getRequestContext();
  });
  return { ...response, nextCalled, nextContext, req };
};

test("generates and attaches a correlation ID when none is supplied", async () => {
  const response = await invoke();

  assert.equal(response.statusCode, 200);
  assert.equal(response.nextCalled, true);
  assert.match(response.req.correlationId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(response.headers["X-Correlation-ID"], response.req.correlationId);
  assert.equal(response.nextContext.correlationId, response.req.correlationId);
});

test("forwards a valid correlation ID unchanged", async () => {
  const response = await invoke({ "x-correlation-id": "ingress-123:abc" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.req.correlationId, "ingress-123:abc");
  assert.equal(response.headers["X-Correlation-ID"], "ingress-123:abc");
});

test("rejects malformed or oversized correlation IDs", async () => {
  const response = await invoke({ "x-correlation-id": `${"a".repeat(128)}!` });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { message: "Invalid correlation ID" });
  assert.equal(response.nextCalled, false);
});
