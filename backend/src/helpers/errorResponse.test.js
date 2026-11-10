import test from "node:test";
import assert from "node:assert/strict";

import { sendBackendError } from "./errorResponse.js";

const responseRecorder = () => {
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
  return { response, res };
};

test("generic backend errors do not expose raw database details", () => {
  const { response, res } = responseRecorder();
  sendBackendError(res, "Request failed", new Error("password=secret connection string and SQL details"));

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    message: "Request failed",
    error: "Internal server error",
  });
});

test("ML authorization failures fail closed without exposing internal credentials", () => {
  const { response, res } = responseRecorder();
  const error = new Error("ML service responded with status 401");
  error.code = "ML_SERVICE_REJECTED";
  error.status = 401;

  sendBackendError(res, "Prediction failed", error);

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    message: "ML service authorization failed",
    error: "Upstream service authorization failed",
  });
});
