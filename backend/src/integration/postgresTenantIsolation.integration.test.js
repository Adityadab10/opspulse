import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Pool } from "pg";

import { createFirebaseAuthMiddleware } from "../middleware/firebaseAuth.js";
import { createTenantContextMiddleware } from "../middleware/tenantContext.js";

const testDatabaseUrl = process.env.OPSPULSE_TEST_DATABASE_URL?.trim();
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const migrationFiles = [
  "001_initial_schema.sql",
  "002_alert_legacy_mongo_id.sql",
  "003_ai_analyst_rag.sql",
  "004_agent_runs_and_steps.sql",
  "005_tenant_isolation.sql",
  "006_inventory_foundation.sql",
];

const isLocalTestDatabase = (value) => {
  if (!value) return false;
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const forbidden = /supabase|pooler|aws|production|prod|staging/;
  return ["127.0.0.1", "localhost", "::1"].includes(hostname)
    && url.port === "5433"
    && !forbidden.test(value.toLowerCase());
};

const databaseUrlFor = (value, databaseName) => {
  const url = new URL(value);
  url.pathname = `/${databaseName}`;
  url.search = "";
  url.hash = "";
  return url.toString();
};

const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;

const integrationUsers = {
  "alpha-token": { uid: "firebase-alpha", tenant_id: "tenant-alpha" },
  "beta-token": { uid: "firebase-beta", tenant_id: "tenant-beta" },
  "multi-token": { uid: "firebase-multi", tenant_ids: ["tenant-alpha", "tenant-beta"] },
};

const verifyIntegrationToken = async (token) => {
  if (!integrationUsers[token]) throw new Error("invalid integration token");
  return integrationUsers[token];
};

const responseRecorder = () => {
  const response = { statusCode: 200, body: undefined };
  const res = {
    status(code) {
      response.statusCode = code;
      return res;
    },
    json(body) {
      response.body = body;
      return res;
    },
  };
  return { response, res };
};

const invokeController = async (handler, {
  tenantId,
  params = {},
  body = {},
  query = {},
} = {}) => {
  const { response, res } = responseRecorder();
  await handler({
    authContext: { userId: `integration-user-${tenantId}`, tenantId },
    params,
    body,
    query,
    headers: {},
  }, res);
  return response;
};

const requestApi = async (pathName, { token, tenantId, method = "GET", body } = {}) => {
  const response = await fetch(`${apiBaseUrl}${pathName}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(tenantId ? { "X-Tenant-ID": tenantId } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
};

const invokeTrustedContext = async ({ authorization, tenantId } = {}) => {
  const authMiddleware = createFirebaseAuthMiddleware({
    verifyIdToken: verifyIntegrationToken,
  });
  const tenantMiddleware = createTenantContextMiddleware();
  const { response, res } = responseRecorder();
  const req = {
    headers: {
      ...(authorization ? { authorization } : {}),
      ...(tenantId ? { "x-tenant-id": tenantId } : {}),
    },
    body: {},
    query: {},
  };
  let context;

  await authMiddleware(req, res, async () => {
    await tenantMiddleware(req, res, () => {
      context = req.authContext;
    });
  });

  return { response, context };
};

const prediction = (demand) => ({
  predictedDemand: demand,
  avgSales: demand - 2,
  percentChange: 25,
  confidence: "Medium",
  seasonTag: "Normal",
  rulePrediction: demand - 1,
  mlPrediction: demand,
  adjustedPrediction: demand,
  decision: "increase",
  impact: "increase",
  keyword: null,
  score: 0,
  sourceHeadline: null,
  sourceHeadlines: [],
  matchedKeywords: [],
  reason: "integration fixture",
  contributingFactors: [],
  predictionSource: "ml",
});

const provisionDatabase = async () => {
  if (!isLocalTestDatabase(testDatabaseUrl)) {
    throw new Error(
      "OPSPULSE_TEST_DATABASE_URL must target the isolated local pgvector fixture at 127.0.0.1:5433; refusing non-local or production databases",
    );
  }

  const databaseName = `opspulse_node_tenant_${process.pid}_${Date.now()}`;
  const adminUrl = databaseUrlFor(testDatabaseUrl, "postgres");
  const fixtureUrl = databaseUrlFor(testDatabaseUrl, databaseName);
  const adminPool = new Pool({ connectionString: adminUrl, max: 1 });
  let databaseCreated = false;

  try {
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    databaseCreated = true;
    const fixturePool = new Pool({ connectionString: fixtureUrl, max: 2 });
    const client = await fixturePool.connect();

    try {
      for (const migrationFile of migrationFiles) {
        const sql = await readFile(path.join(projectRoot, "db", "migrations", migrationFile), "utf8");
        await client.query(sql);
      }
    } finally {
      client.release();
    }

    return {
      databaseName,
      fixtureUrl,
      adminPool,
      fixturePool,
      async close() {
        await fixturePool.end();
        await adminPool.query(`DROP DATABASE ${quoteIdentifier(databaseName)} WITH (FORCE)`);
        await adminPool.end();
      },
    };
  } catch (error) {
    if (databaseCreated) {
      await adminPool.query(`DROP DATABASE ${quoteIdentifier(databaseName)} WITH (FORCE)`).catch(() => {});
    }
    await adminPool.end();
    throw error;
  }
};

let fixture;
let db;
let controllers;
let createProduct;
let insertSale;
let adjustProductStock;
let upsertPrediction;
let createAlert;
let deactivateAlertById;
let deleteActiveAlertsForProduct;
let getAllProducts;
let getProductById;
let getSalesByProductId;
let getAllSales;
let getPredictionByProductId;
let getActiveAlertsByProductId;
let countProducts;
let countAllSales;
let countAllPredictions;
let countAllActiveAlerts;
let importCsvSales;
let apiServer;
let apiBaseUrl;

const seedTenant = async (tenantId, label, demand) => {
  const product = await createProduct(tenantId, `${label} Product`, "Grocery");
  await adjustProductStock(tenantId, product.id, { mode: "set", quantity: 100, reason: "integration fixture" });
  const sale = await insertSale(tenantId, product.id, new Date("2026-01-01T00:00:00.000Z"), 10);
  const predictionRow = await upsertPrediction(tenantId, product.id, prediction(demand));
  const alert = await createAlert(tenantId, product.id, {
    type: "HIGH_DEMAND",
    message: `${label} alert`,
    severity: "HIGH",
    percentChange: 25,
    isActive: true,
  });
  const importResult = await importCsvSales(
    tenantId,
    [{ key: `${label}-import`, name: `${label} Imported`, category: "Grocery" }],
    [{
      productKey: `${label}-import`,
      date: new Date("2026-01-02T00:00:00.000Z"),
      quantity: 3,
      rowIndex: 1,
    }],
    {
      filename: `${label.toLowerCase()}-fixture.csv`,
      recordsProcessed: 1,
      recordsValid: 1,
      recordsInvalid: 0,
    },
  );

  return { product, sale, prediction: predictionRow, alert, importResult };
};

if (!testDatabaseUrl) {
  test("PostgreSQL integration requires OPSPULSE_TEST_DATABASE_URL", () => {
    throw new Error("Set OPSPULSE_TEST_DATABASE_URL to the isolated local pgvector database, for example postgresql://postgres@127.0.0.1:5433/postgres");
  });
} else {
  test.before(async () => {
    fixture = await provisionDatabase();
    process.env.DATABASE_URL = fixture.fixtureUrl;
    db = (await import("../config/database.js")).default;
    const postgres = await import("../config/postgres.js");
    ({
      createProduct,
      insertSale,
      adjustProductStock,
      upsertPrediction,
      createAlert,
      deactivateAlertById,
      deleteActiveAlertsForProduct,
      getAllProducts,
      getProductById,
      getSalesByProductId,
      getAllSales,
      getPredictionByProductId,
      getActiveAlertsByProductId,
      countProducts,
      countAllSales,
      countAllPredictions,
      countAllActiveAlerts,
      importCsvSales,
    } = postgres);
    controllers = {
      products: await import("../controllers/productController.js"),
      sales: await import("../controllers/salesController.js"),
      alerts: await import("../controllers/alertController.js"),
      intelligence: await import("../controllers/productIntelligenceController.js"),
      predictions: await import("../controllers/predictionController.js"),
      dashboard: await import("../controllers/dashboardController.js"),
    };

    const [
      { createProductRouter },
      { createSalesRouter },
      { createDashboardRouter },
      { createAlertRouter },
    ] = await Promise.all([
      import("../routes/productRoutes.js"),
      import("../routes/salesRoutes.js"),
      import("../routes/dashboardRoutes.js"),
      import("../routes/alertRoutes.js"),
    ]);
    const routeOptions = {
      authMiddleware: createFirebaseAuthMiddleware({ verifyIdToken: verifyIntegrationToken }),
      tenantMiddleware: createTenantContextMiddleware(),
    };
    const app = express();
    app.use(express.json());
    app.use("/products", createProductRouter(routeOptions));
    app.use("/sales", createSalesRouter(routeOptions));
    app.use("/dashboard", createDashboardRouter(routeOptions));
    app.use("/alerts", createAlertRouter(routeOptions));
    apiServer = await new Promise((resolve) => {
      const server = app.listen(0, () => resolve(server));
    });
    apiBaseUrl = `http://127.0.0.1:${apiServer.address().port}`;

  });

  test.after(async () => {
    await new Promise((resolve, reject) => {
      if (!apiServer) return resolve();
      apiServer.close((error) => (error ? reject(error) : resolve()));
    });
    await db?.end();
    await fixture?.close();
  });

  let alpha;
  let beta;

  test.beforeEach(async () => {
    await db.query("TRUNCATE products, sales, predictions, alerts, data_imports CASCADE");
    alpha = await seedTenant("tenant-alpha", "Alpha", 20);
    beta = await seedTenant("tenant-beta", "Beta", 30);
  });

  test("tenant alpha reads only its products, sales, prediction, and alerts", async () => {
    const products = await getAllProducts("tenant-alpha");
    const sales = await getAllSales("tenant-alpha");
    const predictionRow = await getPredictionByProductId("tenant-alpha", alpha.product.id);
    const alerts = await getActiveAlertsByProductId("tenant-alpha", alpha.product.id);

    assert.equal(products.length, 2);
    assert.ok(products.every((row) => row.name.startsWith("Alpha")));
    assert.equal(sales.length, 2);
    assert.ok(sales.every((row) => products.some((product) => product.id === row.product_id)));
    assert.equal(predictionRow.predicted_demand, "20.00");
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].message, "Alpha alert");
  });

  test("tenant beta reads only its own records", async () => {
    const products = await getAllProducts("tenant-beta");
    const sales = await getAllSales("tenant-beta");
    const predictionRow = await getPredictionByProductId("tenant-beta", beta.product.id);
    const alerts = await getActiveAlertsByProductId("tenant-beta", beta.product.id);

    assert.equal(products.length, 2);
    assert.ok(products.every((row) => row.name.startsWith("Beta")));
    assert.equal(sales.length, 2);
    assert.equal(predictionRow.predicted_demand, "30.00");
    assert.equal(alerts[0].message, "Beta alert");
  });

  test("tenant alpha cannot retrieve beta product, sales, alerts, or intelligence", async () => {
    assert.equal(await getProductById("tenant-alpha", beta.product.id), null);
    assert.deepEqual(await getSalesByProductId("tenant-alpha", beta.product.id), []);
    assert.deepEqual(await getActiveAlertsByProductId("tenant-alpha", beta.product.id), []);

    const salesResponse = await invokeController(controllers.sales.getSalesByProduct, {
      tenantId: "tenant-alpha",
      params: { productId: beta.product.id },
    });
    const intelligenceResponse = await invokeController(controllers.intelligence.getProductIntelligence, {
      tenantId: "tenant-alpha",
      params: { productId: beta.product.id },
    });

    assert.equal(salesResponse.statusCode, 404);
    assert.equal(intelligenceResponse.statusCode, 404);
  });

  test("tenant alpha cannot modify beta alerts", async () => {
    assert.equal(await deactivateAlertById("tenant-alpha", beta.alert.alert.id), null);
    assert.deepEqual(await deleteActiveAlertsForProduct("tenant-alpha", beta.product.id), {
      product: null,
      deleted: 0,
    });

    const betaAlerts = await getActiveAlertsByProductId("tenant-beta", beta.product.id);
    assert.equal(betaAlerts.length, 1);
    assert.equal(betaAlerts[0].is_active, true);

    const response = await invokeController(controllers.alerts.deactivateAlert, {
      tenantId: "tenant-alpha",
      params: { alertId: beta.alert.alert.id },
    });
    assert.equal(response.statusCode, 404);
  });

  test("creates products and sales under the authenticated tenant", async () => {
    const product = await createProduct("tenant-alpha", "Alpha Write", "Grocery");
    await insertSale("tenant-alpha", product.id, new Date("2026-02-01T00:00:00.000Z"), 7);

    const row = await db.query(
      "SELECT p.tenant_id, s.tenant_id AS sale_tenant FROM products p JOIN sales s ON s.product_id = p.id WHERE p.id = $1",
      [product.id],
    );
    assert.deepEqual(row.rows[0], { tenant_id: "tenant-alpha", sale_tenant: "tenant-alpha" });
  });

  test("CSV imports do not reuse another tenant's product", async () => {
    const alphaProduct = await createProduct("tenant-alpha", "Shared CSV Product", "Food");
    await importCsvSales(
      "tenant-beta",
      [{ key: "shared", name: "Shared CSV Product", category: "Food" }],
      [{ productKey: "shared", date: new Date("2026-03-01T00:00:00.000Z"), quantity: 4, rowIndex: 1 }],
    );

    const rows = await db.query(
      `SELECT p.tenant_id, p.id, s.tenant_id AS sale_tenant
       FROM products p
       LEFT JOIN sales s ON s.product_id = p.id AND s.tenant_id = p.tenant_id
       WHERE p.name = 'Shared CSV Product'
       ORDER BY p.tenant_id`,
    );
    assert.equal(rows.rows.length, 2, JSON.stringify(rows.rows));
    const alphaRow = rows.rows.find((row) => row.tenant_id === "tenant-alpha");
    const betaRow = rows.rows.find((row) => row.tenant_id === "tenant-beta");
    assert.equal(alphaRow.id, alphaProduct.id);
    assert.notEqual(betaRow.id, alphaProduct.id);
    assert.equal(alphaRow.sale_tenant, null);
    assert.equal(betaRow.sale_tenant, "tenant-beta");
  });

  test("duplicate sales and prediction upserts remain tenant-scoped", async () => {
    const duplicateSale = await insertSale(
      "tenant-alpha",
      alpha.product.id,
      new Date("2026-01-01T00:00:00.000Z"),
      99,
    );
    assert.equal(duplicateSale.inserted, false);
    assert.equal((await getSalesByProductId("tenant-alpha", alpha.product.id)).length, 1);

    await upsertPrediction("tenant-alpha", alpha.product.id, prediction(42));
    await upsertPrediction("tenant-beta", beta.product.id, prediction(52));
    assert.equal((await getPredictionByProductId("tenant-alpha", alpha.product.id)).predicted_demand, "42.00");
    assert.equal((await getPredictionByProductId("tenant-beta", beta.product.id)).predicted_demand, "52.00");
    assert.equal((await db.query("SELECT COUNT(*) AS count FROM predictions")).rows[0].count, "2");
  });

  test("dashboard aggregations remain isolated by tenant", async () => {
    assert.equal(await countProducts("tenant-alpha"), "2");
    assert.equal(await countProducts("tenant-beta"), "2");
    assert.equal(await countAllSales("tenant-alpha"), "2");
    assert.equal(await countAllSales("tenant-beta"), "2");
    assert.equal(await countAllPredictions("tenant-alpha"), "1");
    assert.equal(await countAllPredictions("tenant-beta"), "1");
    assert.equal(await countAllActiveAlerts("tenant-alpha"), "1");
    assert.equal(await countAllActiveAlerts("tenant-beta"), "1");

    const alphaSummary = await invokeController(controllers.dashboard.getSummary, { tenantId: "tenant-alpha" });
    assert.equal(alphaSummary.statusCode, 200);
    assert.equal(Number(alphaSummary.body.totalProducts), 2);
    assert.equal(alphaSummary.body.totalSalesVolume, 13);
    assert.equal(Number(alphaSummary.body.activeAlerts), 1);
  });

  test("failed CSV imports roll back all writes", async () => {
    const before = await db.query(
      "SELECT (SELECT COUNT(*) FROM products WHERE tenant_id = 'tenant-alpha') AS products, (SELECT COUNT(*) FROM sales WHERE tenant_id = 'tenant-alpha') AS sales, (SELECT COUNT(*) FROM data_imports WHERE tenant_id = 'tenant-alpha') AS imports",
    );
    await assert.rejects(
      () => importCsvSales(
        "tenant-alpha",
        [{ key: "rollback-product", name: "Rollback Product", category: "Food" }],
        [
          { productKey: "rollback-product", date: new Date("2026-04-01T00:00:00.000Z"), quantity: 2, rowIndex: 1 },
          { productKey: "missing-product", date: new Date("2026-04-02T00:00:00.000Z"), quantity: 2, rowIndex: 2 },
        ],
      ),
      /Product resolution failed/,
    );
    const after = await db.query(
      "SELECT (SELECT COUNT(*) FROM products WHERE tenant_id = 'tenant-alpha') AS products, (SELECT COUNT(*) FROM sales WHERE tenant_id = 'tenant-alpha') AS sales, (SELECT COUNT(*) FROM data_imports WHERE tenant_id = 'tenant-alpha') AS imports",
    );
    assert.deepEqual(after.rows[0], before.rows[0]);
    assert.equal((await db.query("SELECT COUNT(*) AS count FROM products WHERE name = 'Rollback Product'")).rows[0].count, "0");
  });

  test("trusted Firebase identity rejects missing, invalid, and spoofed tenant context", async () => {
    const missingToken = await invokeTrustedContext();
    assert.equal(missingToken.response.statusCode, 401);

    const invalidToken = await invokeTrustedContext({ authorization: "Bearer invalid-token" });
    assert.equal(invalidToken.response.statusCode, 401);

    const missingTenant = await invokeTrustedContext({ authorization: "Bearer alpha-token" });
    assert.equal(missingTenant.response.statusCode, 200);
    assert.equal(missingTenant.context.tenantId, "tenant-alpha");

    const spoofedTenant = await invokeTrustedContext({
      authorization: "Bearer alpha-token",
      tenantId: "tenant-beta",
    });
    assert.equal(spoofedTenant.response.statusCode, 403);

    const multipleWithoutSelection = await invokeTrustedContext({ authorization: "Bearer multi-token" });
    assert.equal(multipleWithoutSelection.response.statusCode, 400);

    const selectedMembership = await invokeTrustedContext({
      authorization: "Bearer multi-token",
      tenantId: "tenant-beta",
    });
    assert.equal(selectedMembership.response.statusCode, 200);
    assert.equal(selectedMembership.context.tenantId, "tenant-beta");
  });

  test("actual Express routes enforce tenant isolation against PostgreSQL", async () => {
    const products = await requestApi("/products", { token: "alpha-token" });
    assert.equal(products.status, 200);
    assert.equal(products.body.length, 2);
    assert.ok(products.body.every((product) => product.name.startsWith("Alpha")));

    const crossTenantSales = await requestApi(`/sales/${beta.product.id}`, { token: "alpha-token" });
    assert.equal(crossTenantSales.status, 404);
    assert.deepEqual(crossTenantSales.body, { message: "Product not found" });

    const alerts = await requestApi("/alerts", { token: "alpha-token" });
    assert.equal(alerts.status, 200);
    assert.equal(alerts.body.length, 1);
    assert.equal(alerts.body[0].message, "Alpha alert");

    const summary = await requestApi("/dashboard/summary", { token: "alpha-token" });
    assert.equal(summary.status, 200);
    assert.equal(Number(summary.body.totalProducts), 2);
    assert.equal(summary.body.totalSalesVolume, 13);

    const missingToken = await requestApi("/products");
    assert.equal(missingToken.status, 401);

    const spoofedTenant = await requestApi("/products", {
      token: "alpha-token",
      tenantId: "tenant-beta",
    });
    assert.equal(spoofedTenant.status, 403);
  });
}
