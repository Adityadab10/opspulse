import test from "node:test";
import assert from "node:assert/strict";

import { summarizeHistory, validateHorizon, forecastProduct } from "./forecastController.js";

const responseRecorder = () => {
  const response = { statusCode: 200, body: null };
  const res = { status(code) { response.statusCode = code; return res; }, json(body) { response.body = body; return res; } };
  return { response, res };
};

test("forecast validation limits horizon and aggregates historical sales by UTC day", () => {
  assert.equal(validateHorizon(90), 90);
  assert.equal(validateHorizon(91), null);
  assert.deepEqual(summarizeHistory([
    { sale_date: "2026-01-01T02:00:00Z", quantity: 2 },
    { sale_date: "2026-01-01T18:00:00Z", quantity: 3 },
  ]), [{ date: "2026-01-01", quantity: 5 }]);
});

test("forecast endpoint rejects invalid references and horizon before database access", async () => {
  const invalidReference = responseRecorder();
  await forecastProduct({ params: { productId: "bad" }, query: { horizon: "30" }, authContext: { tenantId: "tenant-a" } }, invalidReference.res);
  assert.equal(invalidReference.response.statusCode, 400);

  const invalidHorizon = responseRecorder();
  await forecastProduct({ params: { productId: "507f1f77bcf86cd799439011" }, query: { horizon: "0" }, authContext: { tenantId: "tenant-a" } }, invalidHorizon.res);
  assert.equal(invalidHorizon.response.statusCode, 400);
});
