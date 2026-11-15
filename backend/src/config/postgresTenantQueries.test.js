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
    if (sql.startsWith("SELECT id, name, category, legacy_mongo_id") && sql.includes("legacy_mongo_id =")) {
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
