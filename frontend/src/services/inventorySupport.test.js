import test from "node:test";
import assert from "node:assert/strict";
import { getInventoryStateMessage } from "./inventorySupport.js";

test("inventory state helper covers loading, error, and empty states", () => {
  assert.equal(getInventoryStateMessage({ loading: true }), "Loading inventory intelligence…");
  assert.equal(getInventoryStateMessage({ error: "Retry" }), "Retry");
  assert.match(getInventoryStateMessage({ productCount: 0 }), /No products/);
});
