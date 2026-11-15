import test from "node:test";
import assert from "node:assert/strict";

import { adjustStock, getStockMovements } from "./inventoryController.js";

const responseRecorder = () => {
  const response = { statusCode: 200, body: null };
  const res = { status(code) { response.statusCode = code; return res; }, json(body) { response.body = body; return res; } };
  return { response, res };
};

test("stock initialization validates non-negative quantity and reason", async () => {
  const { response, res } = responseRecorder();
  await adjustStock({ params: { productId: "507f1f77bcf86cd799439011" }, body: { mode: "set", quantity: -1, reason: "" }, authContext: { tenantId: "tenant-a" } }, res);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body.errors, {
    quantity: "quantity must be a non-negative integer",
    reason: "reason is required",
  });
});

test("stock adjustment rejects malformed references and zero adjustments", async () => {
  const invalidReference = responseRecorder();
  await getStockMovements({ params: { productId: "bad" }, authContext: { tenantId: "tenant-a" } }, invalidReference.res);
  assert.equal(invalidReference.response.statusCode, 400);

  const zero = responseRecorder();
  await adjustStock({ params: { productId: "507f1f77bcf86cd799439011" }, body: { mode: "adjust", quantity: 0, reason: "cycle count" }, authContext: { tenantId: "tenant-a" } }, zero.res);
  assert.equal(zero.response.statusCode, 400);
});
