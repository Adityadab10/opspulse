import "dotenv/config";
import express from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";

import pool, { activateFreshDatabase } from "./config/database.js";
import productRoutes from "./routes/productRoutes.js";
import salesRoutes from "./routes/salesRoutes.js";
import forecastRoutes from "./routes/forecastRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import alertRoutes from "./routes/alertRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import predictionRoutes from "./routes/predictionRoutes.js";
import newsRoutes from "./routes/newsRoutes.js";
import aiAnalystRoutes from "./routes/aiAnalystRoutes.js";
import inventoryRoutes from "./routes/inventoryRoutes.js";
import inventoryAgentRoutes from "./routes/inventoryAgentRoutes.js";
import { correlationIdMiddleware } from "./middleware/correlationId.js";
import { requireSessionMembership } from "./middleware/clerkAuth.js";
import { requireTenantContext } from "./middleware/tenantContext.js";
import { requireMlServiceToken } from "./middleware/mlServiceAuth.js";
import { predictAllProducts, predictByProduct, comparePredictions } from "./controllers/predictionController.js";
import { getProductIntelligence } from "./controllers/productIntelligenceController.js";

const app = express();


// Middleware
app.use(cors());
app.use(express.json());
app.use(correlationIdMiddleware);
const authorizedParties = (process.env.CLERK_AUTHORIZED_PARTIES || "http://localhost:5173").split(",").map(value => value.trim()).filter(Boolean);
app.use("/api", clerkMiddleware({ authorizedParties }));
app.get("/api/session/memberships", requireSessionMembership, (req, res) => {
  res.json({ memberships: req.memberships });
});

// Routes
app.get("/", (req, res) => {
  res.send("API is running...");
});
app.use("/api/products", productRoutes);
app.use("/api/products/analysis",productRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/forecast", forecastRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/predictions", predictionRoutes);
app.use("/api/news", newsRoutes);
app.use("/api/ai-analyst", aiAnalystRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/inventory-agent", inventoryAgentRoutes);
app.post("/api/predict-all", requireSessionMembership, requireTenantContext, requireMlServiceToken, predictAllProducts);
app.get("/api/compare-predictions", requireSessionMembership, requireTenantContext, requireMlServiceToken, comparePredictions);

// Backward-compatible aliases for legacy clients still calling old endpoints.
app.post("/api/predict/:productId", requireSessionMembership, requireTenantContext, requireMlServiceToken, predictByProduct);
app.get("/api/predict/:productId", requireSessionMembership, requireTenantContext, requireMlServiceToken, predictByProduct);

// Product intelligence endpoint
app.get("/api/products/:productId/intelligence", requireSessionMembership, requireTenantContext, getProductIntelligence);

const startServer = async () => {
  try {
    activateFreshDatabase();
    const { rows: [role] } = await pool.query(
      "SELECT rolsuper OR rolbypassrls AS bypasses_rls FROM pg_roles WHERE rolname = current_user",
    );
    if (!role || role.bypasses_rls) throw new Error("PostgreSQL runtime role must enforce RLS");
    const { rows } = await pool.query("SELECT version FROM public.opspulse_schema_migrations WHERE version = $1", ["001_fresh_opspulse"]);
    if (!rows.length) throw new Error("Fresh schema is not initialized");
    console.log("PostgreSQL connected...");
    const server = app.listen(process.env.PORT);
    server.once("listening", () => console.log(`Server running on port ${process.env.PORT}`));
    server.once("error", (error) => {
      console.error("HTTP listener failed:", error.code || error.name);
      process.exitCode = 1;
      void pool.end();
    });
  } catch (error) {
    console.error("Failed to connect to PostgreSQL:", error?.code || error?.name || "unknown");
    process.exit(1);
  }
};

startServer();
