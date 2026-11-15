import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const migrationPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../db/migrations/006_inventory_foundation.sql");

test("inventory migration defines zero-based stock and tenant-safe movement constraints", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /stock_quantity INTEGER NOT NULL DEFAULT 0/);
  assert.match(sql, /CHECK \(stock_quantity >= 0\)/);
  assert.match(sql, /movement_type VARCHAR\(20\).*INITIAL.*SALE/s);
  assert.match(sql, /quantity INTEGER NOT NULL CHECK \(quantity > 0\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, product_id\)\s+REFERENCES products\(tenant_id, id\)/);
});
