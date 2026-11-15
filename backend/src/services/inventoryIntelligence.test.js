import test from "node:test";
import assert from "node:assert/strict";
import { calculateInventoryHealth, normalizeHorizon } from "./inventoryIntelligence.js";

const row = (overrides = {}) => ({ id: "p1", name: "Widget", stock_quantity: 5, reorder_threshold: 10, predicted_demand: 20, prediction_horizon_days: 30, ...overrides });

test("inventory intelligence flags threshold breaches and calculates reorder quantity", () => {
  const result = calculateInventoryHealth([row()]);
  assert.equal(result.products[0].lowStock, true);
  assert.equal(result.products[0].stockoutRisk, true);
  assert.equal(result.products[0].recommendedReorderQuantity, 15);
});

test("inventory intelligence applies explicit overstock ratio", () => {
  const result = calculateInventoryHealth([row({ stock_quantity: 50, reorder_threshold: 2, predicted_demand: 20 })]);
  assert.equal(result.products[0].overstock, true);
  assert.equal(result.summary.overstockedProducts, 1);
});

test("missing forecasts remain unknown instead of fabricating demand", () => {
  const result = calculateInventoryHealth([row({ predicted_demand: null, prediction_horizon_days: null })]);
  assert.equal(result.products[0].forecastStatus, "missing");
  assert.equal(result.products[0].expectedDemand, null);
  assert.equal(result.products[0].recommendedReorderQuantity, null);
});

test("alerts are deduplicated by product and finding type", () => {
  const result = calculateInventoryHealth([row()]);
  assert.equal(new Set(result.alerts.map((alert) => alert.key)).size, result.alerts.length);
  assert.equal(result.alerts.length, 2);
});

test("horizon validation is bounded", () => {
  assert.equal(normalizeHorizon("30"), 30);
  assert.equal(normalizeHorizon("0"), null);
  assert.equal(normalizeHorizon("91"), null);
});
