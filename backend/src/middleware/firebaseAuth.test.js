import test from "node:test";
import assert from "node:assert/strict";

import { createFirebaseAuthMiddleware } from "./firebaseAuth.js";

const invoke = async (verifyIdToken, authorization) => {
  const req = { headers: authorization ? { authorization } : {} };
  const response = { statusCode: 200, body: null };
  const res = {
    status(code) {
      response.statusCode = code;
      return res;
    },
    json(body) {
      response.body = body;
      return res;
    },
  };
  let nextCalled = false;
  await createFirebaseAuthMiddleware({ verifyIdToken })(req, res, () => {
    nextCalled = true;
  });
  return { ...response, nextCalled, user: req.user };
};

test("rejects a missing Firebase token", async () => {
  const response = await invoke(async () => ({ uid: "unused" }));
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { message: "Authorization is required" });
});

test("rejects an invalid or expired Firebase token", async () => {
  const response = await invoke(async () => {
    throw new Error("expired");
  }, "Bearer invalid-token");
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { message: "Invalid or expired authorization token" });
});

test("rejects malformed authorization schemes", async () => {
  const response = await invoke(async () => ({ uid: "unused" }), "Token invalid-token");
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { message: "Invalid authorization token" });
});

test("accepts a verified Firebase token", async () => {
  const response = await invoke(async (token) => {
    assert.equal(token, "verified-token");
    return { uid: "user-123" };
  }, "Bearer verified-token");
  assert.equal(response.statusCode, 200);
  assert.equal(response.nextCalled, true);
  assert.deepEqual(response.user, { uid: "user-123" });
});
