import test from "node:test";
import assert from "node:assert/strict";

import { validateSaleInput } from "./salesSupport.js";

test("sale validation requires a product, date, and positive whole quantity", () => {
  assert.deepEqual(validateSaleInput({ productId: "", date: "", quantity: 0 }), {
    productId: "Product is required",
    date: "Date and time are required",
    quantity: "Quantity must be a positive whole number",
  });
  assert.deepEqual(validateSaleInput({ productId: "product-a", date: "2026-11-15T10:00", quantity: 3 }), {});
});
