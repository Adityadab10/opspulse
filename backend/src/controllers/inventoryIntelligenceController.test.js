import test from "node:test";
import assert from "node:assert/strict";
import { getInventoryIntelligence } from "./inventoryIntelligenceController.js";

test("inventory intelligence rejects invalid horizons before database access", async () => {
  const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await getInventoryIntelligence({ query: { horizon: "91" }, authContext: { tenantId: "tenant-a" } }, response);
  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /between 1 and 90/);
});
