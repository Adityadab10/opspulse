/**
 * Standalone Node.js Express server for cross-service end-to-end integration tests.
 *
 * Runs Express backend routing with test-only Firebase verification while exercising
 * the exact production middleware, request context, and ML service clients.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

const toUrl = (relPath) => pathToFileURL(path.join(projectRoot, relPath)).href;

const express = (await import(toUrl("backend/node_modules/express/index.js"))).default;
const cors = (await import(toUrl("backend/node_modules/cors/lib/index.js"))).default;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

// Test-only identity verification mapping (replaces remote Firebase network calls without weakening production logic)
const integrationUsers = {
  "alpha-token": { uid: "firebase-user-alpha", tenant_id: "tenant-alpha" },
  "beta-token": { uid: "firebase-user-beta", tenant_id: "tenant-beta" },
  "multi-token": { uid: "firebase-user-multi", tenant_ids: ["tenant-alpha", "tenant-beta"] },
};

const verifyIntegrationToken = async (token) => {
  if (!integrationUsers[token]) {
    const error = new Error("Invalid or expired authorization token");
    error.code = "AUTH_INVALID_TOKEN";
    throw error;
  }
  return integrationUsers[token];
};

// Import backend modules dynamically using file:// URLs
const { createFirebaseAuthMiddleware } = await import(toUrl("backend/src/middleware/firebaseAuth.js"));
const { createTenantContextMiddleware } = await import(toUrl("backend/src/middleware/tenantContext.js"));
const { correlationIdMiddleware } = await import(toUrl("backend/src/middleware/correlationId.js"));
const { requireMlServiceToken } = await import(toUrl("backend/src/middleware/mlServiceAuth.js"));

const { createProductRouter } = await import(toUrl("backend/src/routes/productRoutes.js"));
const { createSalesRouter } = await import(toUrl("backend/src/routes/salesRoutes.js"));
const { createDashboardRouter } = await import(toUrl("backend/src/routes/dashboardRoutes.js"));
const { createAlertRouter } = await import(toUrl("backend/src/routes/alertRoutes.js"));
const { createPredictionRouter } = await import(toUrl("backend/src/routes/predictionRoutes.js"));
const { askAiAnalyst } = await import(toUrl("backend/src/controllers/aiAnalystController.js"));
const dbPool = (await import(toUrl("backend/src/config/database.js"))).default;

const app = express();
app.use(cors());
app.use(express.json());
app.use(correlationIdMiddleware);

const authMiddleware = createFirebaseAuthMiddleware({ verifyIdToken: verifyIntegrationToken });
const tenantMiddleware = createTenantContextMiddleware();
const routeOptions = { authMiddleware, tenantMiddleware, mlServiceMiddleware: requireMlServiceToken };

app.get("/health", (req, res) => res.json({ status: "ok", service: "backend" }));
app.use("/api/products", createProductRouter(routeOptions));
app.use("/api/sales", createSalesRouter(routeOptions));
app.use("/api/dashboard", createDashboardRouter(routeOptions));
app.use("/api/alerts", createAlertRouter(routeOptions));
app.use("/api/predictions", createPredictionRouter(routeOptions));
app.post("/api/ai-analyst", authMiddleware, tenantMiddleware, askAiAnalyst);

const port = Number(process.env.PORT || 5008);
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`NODE_BACKEND_READY ${server.address().port}`);
});

const cleanup = async () => {
  server.close();
  try {
    await dbPool.end();
  } catch {}
  process.exit(0);
};

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);
