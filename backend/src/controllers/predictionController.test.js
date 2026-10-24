import test from "node:test";
import assert from "node:assert/strict";

import { settleWithConcurrency } from "./predictionController.js";

test("settleWithConcurrency does not exceed the configured worker limit", async () => {
  let active = 0;
  let maximumActive = 0;

  const results = await settleWithConcurrency(
    Array.from({ length: 9 }, (_, index) => index),
    async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    },
    4,
  );

  assert.equal(maximumActive, 4);
  assert.deepEqual(
    results.map((result) => result.value),
    [0, 2, 4, 6, 8, 10, 12, 14, 16],
  );
  assert.ok(results.every((result) => result.status === "fulfilled"));
});
