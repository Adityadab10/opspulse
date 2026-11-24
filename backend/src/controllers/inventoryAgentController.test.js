import assert from "node:assert/strict";
import test from "node:test";
import pool from "../config/database.js";
import { executeInventoryAgentAction } from "./inventoryAgentController.js";

const actionId = "ab603070-4c3b-4a59-a5c6-bc34254ac031";
const productId = "e87eed88-ac83-47db-9135-d158fe6af93e";

for (const scenario of ["success", "duplicate", "stale", "finalization failure"]) {
  test(`inventory execution keeps stock and action consistent on ${scenario}`, async (t) => {
    const statements = [];
    const action = {
      id: actionId,
      product_id: productId,
      status: scenario === "duplicate" ? "executed" : "approved",
      recommendation: {
        currentStock: 4,
        proposedAction: { type: "record_replenishment", quantity: 6 },
      },
    };
    const product = { id: productId, stock_quantity: scenario === "stale" ? 5 : 4 };
    const rows = (value) => ({ rows: [value] });
    const client = {
      release() {},
      async query(sql, params) {
        statements.push(sql);
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return {};
        if (sql.includes("FROM inventory_agent_actions")) {
          assert.deepEqual(params, [actionId, "tenant-a"]);
          return rows(action);
        }
        if (sql.includes("information_schema.columns")) {
          return { rows: ["products", "sales", "predictions", "alerts", "data_imports"].map((table_name) => ({ table_name })) };
        }
        if (sql.includes("pg_constraint")) {
          return { rows: ["sales_tenant_product_date_key", "predictions_tenant_product_key"].map((conname) => ({ conname })) };
        }
        if (sql.includes("FROM products")) return rows(product);
        if (sql.includes("COUNT(*)")) return rows({ count: 0 });
        if (sql.includes("UPDATE products")) return rows({ ...product, stock_quantity: 10 });
        if (sql.includes("INSERT INTO inventory_movements")) return rows({ id: "movement-a" });
        if (sql.includes("SET status=$1")) return rows({ ...action, status: params[0] });
        if (sql.includes("SET status='executed'")) {
          return scenario === "finalization failure" ? { rows: [] } : rows({ ...action, status: "executed" });
        }
        throw new Error("Unexpected query");
      },
    };
    t.mock.method(pool, "connect", async () => client);
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return this; },
    };

    await executeInventoryAgentAction({
      params: { actionId }, authContext: { tenantId: "tenant-a", userId: "user-a" },
    }, response);

    const stockWrite = statements.findIndex((sql) => sql.includes("UPDATE products"));
    const movementWrite = statements.findIndex((sql) => sql.includes("INSERT INTO inventory_movements"));
    const finalization = statements.findIndex((sql) => sql.includes("SET status='executed'"));
    if (scenario === "duplicate" || scenario === "stale") {
      assert.equal(stockWrite, -1);
      assert.equal(movementWrite, -1);
      assert.equal(response.statusCode, scenario === "stale" ? 409 : 200);
      assert.equal(statements.at(-1), "COMMIT");
      if (scenario === "duplicate") assert.equal(response.payload.duplicate, true);
      return;
    }
    assert.ok(stockWrite > 0 && movementWrite > stockWrite && finalization > movementWrite);
    assert.deepEqual(statements.slice(finalization + 1), [scenario === "success" ? "COMMIT" : "ROLLBACK"]);
    assert.equal(response.statusCode, scenario === "success" ? 200 : 500);
  });
}
