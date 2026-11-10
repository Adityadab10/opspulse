import test from "node:test";
import assert from "node:assert/strict";

import { requireMlServiceToken } from "./mlServiceAuth.js";

test("rejects prediction and news proxy requests when the internal token is not configured", async () => {
  const originalToken = process.env.ML_ANALYST_INTERNAL_TOKEN;
  delete process.env.ML_ANALYST_INTERNAL_TOKEN;
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

  try {
    await requireMlServiceToken({}, res, () => {
      nextCalled = true;
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.body, { message: "ML service authorization is not configured" });
    assert.equal(nextCalled, false);
  } finally {
    if (originalToken === undefined) delete process.env.ML_ANALYST_INTERNAL_TOKEN;
    else process.env.ML_ANALYST_INTERNAL_TOKEN = originalToken;
  }
});
