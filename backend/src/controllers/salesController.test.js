import test from "node:test";
import assert from "node:assert/strict";

import { addSales, getSalesHistoryController } from "./salesController.js";

const responseRecorder = () => {
  const response = { statusCode: 200, body: null };
  const res = {
    status(statusCode) { response.statusCode = statusCode; return res; },
    json(body) { response.body = body; return res; },
  };
  return { response, res };
};

test("sale creation returns field-level errors before database access", async () => {
  const { response, res } = responseRecorder();
  await addSales({ body: { quantity: 0 }, authContext: { tenantId: "tenant-a" } }, res);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body.errors, {
    productId: "productId is required",
    date: "date is required",
  });
});

test("sale creation rejects malformed references, quantities, and dates", async () => {
  const invalidProduct = responseRecorder();
  await addSales({ body: { productId: "bad", date: "2026-01-01", quantity: 1 }, authContext: { tenantId: "tenant-a" } }, invalidProduct.res);
  assert.equal(invalidProduct.response.statusCode, 400);

  const invalidQuantity = responseRecorder();
  await addSales({ body: { productId: "507f1f77bcf86cd799439011", date: "2026-01-01", quantity: 1.5 }, authContext: { tenantId: "tenant-a" } }, invalidQuantity.res);
  assert.equal(invalidQuantity.response.statusCode, 400);
  assert.equal(invalidQuantity.response.body.message, "quantity must be a positive integer");

  const invalidDate = responseRecorder();
  await addSales({ body: { productId: "507f1f77bcf86cd799439011", date: "not-a-date", quantity: 1 }, authContext: { tenantId: "tenant-a" } }, invalidDate.res);
  assert.equal(invalidDate.response.statusCode, 400);
});

test("sales history validates tenant-safe product and date filters", async () => {
  const invalidProduct = responseRecorder();
  await getSalesHistoryController({ query: { productId: "bad" }, authContext: { tenantId: "tenant-a" } }, invalidProduct.res);
  assert.equal(invalidProduct.response.statusCode, 400);

  const invalidRange = responseRecorder();
  await getSalesHistoryController({ query: { start: "2026-03-02", end: "2026-03-01" }, authContext: { tenantId: "tenant-a" } }, invalidRange.res);
  assert.equal(invalidRange.response.statusCode, 400);
});
