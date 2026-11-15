import test from "node:test";
import assert from "node:assert/strict";

import { buildForecastSeries, validateForecastOptions } from "./forecastSupport.js";

test("forecast support validates horizon and separates historical and predicted points", () => {
  assert.deepEqual(validateForecastOptions({ productId: "", horizon: 0 }), {
    productId: "Product is required",
    horizon: "Horizon must be a whole number from 1 to 90 days",
  });
  assert.deepEqual(buildForecastSeries([{ date: "2026-01-01", quantity: 4 }], [{ date: "2026-01-02", value: 5 }]), [
    { date: "2026-01-01", historical: 4, forecast: null },
    { date: "2026-01-02", historical: null, forecast: 5 },
  ]);
});
