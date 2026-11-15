import test from "node:test";
import assert from "node:assert/strict";

import { normalizeProductInput, validateProductInput } from "./productValidation.js";

test("validates and normalizes product fields", () => {
  assert.deepEqual(validateProductInput({ name: " Almonds ", category: " Food " }), {});
  assert.deepEqual(normalizeProductInput({ name: " Almonds ", category: " Food " }), {
    name: "Almonds",
    category: "Food",
  });
});

test("returns field-level errors for missing, invalid, and oversized fields", () => {
  assert.deepEqual(validateProductInput({ name: "", category: 12 }), {
    name: "name is required",
    category: "category is required",
  });
  assert.equal(validateProductInput({ name: "x".repeat(256), category: "Food" }).name,
    "name must be 255 characters or fewer");
});
