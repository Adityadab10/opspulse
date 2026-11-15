import test from "node:test";
import assert from "node:assert/strict";

import {
  DashboardDateRangeError,
  buildMonthlySalesSeries,
  filterSalesByDateRange,
  getDashboardDateRange,
  summarizeSales,
} from "./dashboardMetrics.js";

const sales = [
  { sale_date: "2026-01-31T23:59:59.000Z", quantity: 2 },
  { sale_date: "2026-02-01T00:00:00.000Z", quantity: 3 },
  { sale_date: "2026-02-15T12:00:00.000Z", quantity: 5 },
];

test("filters dashboard sales inclusively by calendar date", () => {
  const range = getDashboardDateRange({ start: "2026-02-01", end: "2026-02-15" });
  const filtered = filterSalesByDateRange(sales, range);

  assert.deepEqual(filtered.map((sale) => sale.quantity), [3, 5]);
  assert.deepEqual(summarizeSales(filtered), { totalSalesVolume: 8, transactionCount: 2 });
});

test("rejects malformed and reversed dashboard date ranges", () => {
  assert.throws(
    () => getDashboardDateRange({ start: "2026-02-30" }),
    DashboardDateRangeError,
  );
  assert.throws(
    () => getDashboardDateRange({ start: "2026-03-01", end: "2026-02-01" }),
    DashboardDateRangeError,
  );
});

test("builds a deterministic monthly sales series", () => {
  assert.deepEqual(buildMonthlySalesSeries(sales), [
    { month: "2026-01", quantity: 2 },
    { month: "2026-02", quantity: 8 },
  ]);
});
