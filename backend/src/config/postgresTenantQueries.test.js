import test from "node:test";
import assert from "node:assert/strict";

import pool from "./database.js";
import {
  createProduct,
  deactivateAlertById,
  getAllSales,
  countProducts,
  getProductById,
  getSalesByProductId,
  importCsvSales,
  getAllProducts,
  getSalesHistory,
  insertSale,
  adjustProductStock,
  updateProduct,
  resolveProduct,
  upsertPrediction,
} from "./postgres.js";

const tenantTables = [
  { table_name: "products" },
  { table_name: "sales" },
  { table_name: "predictions" },
  { table_name: "alerts" },
  { table_name: "data_imports" },
];

test("fails closed when tenant columns are not available", async () => {
  const originalQuery = pool.query;
  pool.query = async () => ({ rows: [] });
  try {
    await assert.rejects(
      () => getProductById("tenant-a", "product-a"),
      (error) => error.code === "TENANT_SCHEMA_UNAVAILABLE" && error.statusCode === 503,
    );
  } finally {
    pool.query = originalQuery;
  }
});

test("scopes product and sales reads by the trusted tenant", async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("information_schema.columns")) return { rows: tenantTables };
    if (sql.includes("pg_constraint")) return {
      rows: [
        { conname: "sales_tenant_product_date_key" },
        { conname: "predictions_tenant_product_key" },
      ],
    };
    if (sql.includes("COUNT(*)")) return { rows: [{ cnt: "0" }] };
    return { rows: [] };
  };

  try {
    await getProductById("tenant-a", "product-a");
    await getSalesByProductId("tenant-a", "product-a");
    await getAllSales("tenant-a");
    await countProducts("tenant-a");
    const dataCalls = calls.filter(({ sql }) =>
      !sql.includes("information_schema.columns") && !sql.includes("pg_constraint"));
    assert.equal(dataCalls.length, 4);
    assert.ok(dataCalls.every(({ sql, params }) => sql.includes("tenant_id") && params[0] === "tenant-a"));
  } finally {
    pool.query = originalQuery;
  }
});

test("tenant-aware inserts and alert updates include the trusted tenant", async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("information_schema.columns")) return { rows: tenantTables };
    if (sql.includes("pg_constraint")) return {
      rows: [
        { conname: "sales_tenant_product_date_key" },
        { conname: "predictions_tenant_product_key" },
      ],
    };
    return { rows: [{ id: "row-a", product_id: "product-a" }] };
  };

  try {
    await createProduct("tenant-a", "Almonds", "Food");
    await deactivateAlertById("tenant-a", "alert-a");
    const dataCalls = calls.filter(({ sql }) =>
      !sql.includes("information_schema.columns") && !sql.includes("pg_constraint"));
    assert.ok(dataCalls.some(({ sql, params }) => sql.includes("INSERT INTO products") && params[0] === "tenant-a"));
    assert.ok(dataCalls.some(({ sql, params }) => sql.includes("UPDATE alerts") && params[0] === "tenant-a"));
  } finally {
    pool.query = originalQuery;
  }
});

test("CSV import rolls back all tenant writes when a batch insert fails", async () => {
  const originalConnect = pool.connect;
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql === "BEGIN" || sql === "ROLLBACK") return {};
      if (sql.includes("information_schema.columns")) return { rows: tenantTables };
      if (sql.includes("pg_constraint")) return {
        rows: [
          { conname: "sales_tenant_product_date_key" },
          { conname: "predictions_tenant_product_key" },
        ],
      };
      if (sql.includes("SELECT id FROM products")) return { rows: [] };
      if (sql.includes("INSERT INTO products")) return { rows: [{ id: "product-a" }] };
      if (sql.includes("INSERT INTO sales")) throw new Error("sale insert failed");
      return { rows: [] };
    },
    release() {},
  };
  pool.connect = async () => client;

  try {
    await assert.rejects(
      () => importCsvSales("tenant-a", [{ key: "almonds__food", name: "Almonds", category: "Food" }], [{
        productKey: "almonds__food",
        date: new Date("2026-01-01"),
        quantity: 1,
        rowIndex: 1,
      }]),
      /sale insert failed/,
    );
    assert.equal(calls[0].sql, "BEGIN");
    assert.ok(calls.some(({ sql, params }) => sql.includes("INSERT INTO products") && params[0] === "tenant-a"));
    assert.ok(calls.some(({ sql }) => sql === "ROLLBACK"));
  } finally {
    pool.connect = originalConnect;
  }
});

test("product resolution scopes the client product reference by tenant", async () => {
  const queryCalls = [];
  const queryable = {
    async query(sql, params) {
      queryCalls.push({ sql, params });
      if (sql.includes("information_schema.columns")) return { rows: tenantTables };
      if (sql.includes("pg_constraint")) return {
        rows: [
          { conname: "sales_tenant_product_date_key" },
          { conname: "predictions_tenant_product_key" },
        ],
      };
      return { rows: [{ id: "product-a", name: "Almonds", category: "Food" }] };
    },
  };

  const product = await resolveProduct("tenant-b", "legacy-product", queryable);
  assert.equal(product.id, "product-a");
  const productLookup = queryCalls.find(({ sql }) => sql.includes("FROM products"));
  assert.equal(productLookup.params[0], "tenant-b");
  assert.ok(productLookup.sql.includes("tenant_id = $1"));
});

test("product search and updates keep the trusted tenant predicate", async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("FROM products") && sql.includes("ILIKE")) {
      return { rows: [{ id: "product-a", name: "Almonds", category: "Food" }] };
    }
    if (sql.startsWith("SELECT id, name, category, stock_quantity") && sql.includes("legacy_mongo_id =")) {
      return { rows: [{ id: "product-a", name: "Almonds", category: "Food" }] };
    }
    if (sql.includes("UPDATE products")) {
      return { rows: [{ id: "product-a", name: "Almonds", category: "Snacks" }] };
    }
    return { rows: [] };
  };

  try {
    await getAllProducts("tenant-a", "created_at", "almond");
    await updateProduct("tenant-a", "product-a", "Almonds", "Snacks");
    const dataCalls = calls.filter(({ sql }) => sql.includes("FROM products") || sql.includes("UPDATE products"));
    assert.ok(dataCalls.length >= 3);
    assert.ok(dataCalls.every(({ sql, params }) => sql.includes("tenant_id") && params.includes("tenant-a")));
  } finally {
    pool.query = originalQuery;
  }
});

test("sales history and inserts remain tenant-scoped", async () => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("legacy_mongo_id =")) {
      return { rows: [{ id: "product-a", name: "Almonds", category: "Food", legacy_mongo_id: null }] };
    }
    if (sql.includes("FROM sales s")) {
      return { rows: [{ id: "sale-a", product_id: "product-a", product_name: "Almonds", quantity: 2 }] };
    }
    if (sql.includes("INSERT INTO sales")) {
      return { rows: [{ id: "sale-a", product_id: "product-a", sale_date: new Date("2026-01-01"), quantity: 2 }] };
    }
    return { rows: [] };
  };
  pool.connect = async () => ({
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("legacy_mongo_id =")) return { rows: [{ id: "product-a", name: "Almonds", category: "Food", stock_quantity: 10, legacy_mongo_id: null }] };
      if (sql.includes("FOR UPDATE")) return { rows: [{ id: "product-a", name: "Almonds", category: "Food", stock_quantity: 10, legacy_mongo_id: null }] };
      if (sql.includes("INSERT INTO sales")) return { rows: [{ id: "sale-a", product_id: "product-a", sale_date: new Date("2026-01-02"), quantity: 2 }] };
      if (sql.includes("UPDATE products")) return { rows: [{ stock_quantity: 8 }] };
      if (sql.includes("inventory_movements")) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  });

  try {
    await getSalesHistory("tenant-a", {
      productId: "product-a",
      startDate: new Date("2026-01-01"),
      endDateExclusive: new Date("2026-02-01"),
    });
    await insertSale("tenant-a", "product-a", new Date("2026-01-02"), 2);
    const dataCalls = calls.filter(({ sql }) => sql.includes("FROM sales s") || sql.includes("INSERT INTO sales"));
    assert.ok(dataCalls.length >= 2);
    assert.ok(dataCalls.every(({ sql, params }) => sql.includes("tenant_id") && params.includes("tenant-a")));
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }
});

test("stock initialization writes balance and ledger atomically for the trusted tenant", async () => {
  const originalConnect = pool.connect;
  const calls = [];
  pool.connect = async () => ({
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("legacy_mongo_id =")) return { rows: [{ id: "product-a", name: "Almonds", category: "Food", stock_quantity: 0, legacy_mongo_id: null }] };
      if (sql.includes("FOR UPDATE")) return { rows: [{ id: "product-a", name: "Almonds", category: "Food", stock_quantity: 0, legacy_mongo_id: null }] };
      if (sql.includes("COUNT(*)")) return { rows: [{ count: 0 }] };
      if (sql.includes("UPDATE products")) return { rows: [{ id: "product-a", name: "Almonds", category: "Food", stock_quantity: 12 }] };
      if (sql.includes("INSERT INTO inventory_movements")) return { rows: [{ id: "movement-a", movement_type: "INITIAL", quantity: 12 }] };
      return { rows: [] };
    },
    release() {},
  });
  try {
    const result = await adjustProductStock("tenant-a", "product-a", { mode: "set", quantity: 12, reason: "opening count" });
    assert.equal(result.movement.movement_type, "INITIAL");
    assert.ok(calls.some(({ sql, params }) => sql.includes("UPDATE products") && params.includes("tenant-a")));
    assert.ok(calls.some(({ sql, params }) => sql.includes("INSERT INTO inventory_movements") && params.includes("tenant-a")));
    assert.ok(calls.some(({ sql }) => sql.includes("FOR UPDATE")));
    assert.equal(calls.at(-1).sql, "COMMIT");
  } finally {
    pool.connect = originalConnect;
  }
});

test("stock adjustments fail without a partial write when the balance would go negative", async () => {
  const originalConnect = pool.connect;
  const calls = [];
  pool.connect = async () => ({
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("legacy_mongo_id =")) return { rows: [{ id: "product-a", name: "Almonds", category: "Food", stock_quantity: 2, legacy_mongo_id: null }] };
      if (sql.includes("FOR UPDATE")) return { rows: [{ id: "product-a", name: "Almonds", category: "Food", stock_quantity: 2, legacy_mongo_id: null }] };
      if (sql.includes("COUNT(*)")) return { rows: [{ count: 1 }] };
      return { rows: [] };
    },
    release() {},
  });
  try {
    const result = await adjustProductStock("tenant-a", "product-a", { mode: "adjust", quantity: -3, reason: "correction" });
    assert.equal(result.insufficientStock, true);
    assert.ok(calls.some(({ sql }) => sql === "ROLLBACK"));
    assert.ok(!calls.some(({ sql }) => sql.includes("INSERT INTO inventory_movements")));
  } finally {
    pool.connect = originalConnect;
  }
});

test("prediction upserts use tenant-aware uniqueness", async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("information_schema.columns")) return { rows: tenantTables };
    if (sql.includes("pg_constraint")) return {
      rows: [
        { conname: "sales_tenant_product_date_key" },
        { conname: "predictions_tenant_product_key" },
      ],
    };
    return { rows: [{ id: "prediction-a", product_id: "product-a" }] };
  };

  try {
    await upsertPrediction("tenant-a", "product-a", {
      predictedDemand: 10,
      avgSales: 8,
      percentChange: 25,
      confidence: "Medium",
      seasonTag: "Normal",
      rulePrediction: 9,
      mlPrediction: 10,
      adjustedPrediction: 10,
      decision: "increase",
      impact: "increase",
      keyword: null,
      score: 0,
      sourceHeadline: null,
      sourceHeadlines: [],
      matchedKeywords: [],
      reason: "test",
      contributingFactors: [],
      predictionSource: "ml",
    });
    const upsert = calls.find(({ sql }) => sql.includes("INSERT INTO predictions"));
    assert.equal(upsert.params[0], "tenant-a");
    assert.ok(upsert.sql.includes("ON CONFLICT (tenant_id, product_id)"));
  } finally {
    pool.query = originalQuery;
  }
});
