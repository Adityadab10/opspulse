import "dotenv/config";
import express from "express";
import cors from "cors";

import pool from "./config/database.js";
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
import { correlationIdMiddleware } from "./middleware/correlationId.js";
import { requireFirebaseAuth } from "./middleware/firebaseAuth.js";
import { requireTenantContext } from "./middleware/tenantContext.js";
import { requireMlServiceToken } from "./middleware/mlServiceAuth.js";
import { predictAllProducts, predictByProduct, comparePredictions } from "./controllers/predictionController.js";
import { getProductIntelligence } from "./controllers/productIntelligenceController.js";

const app = express();


// Middleware
app.use(cors());
app.use(express.json());
app.use(correlationIdMiddleware);

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
app.post("/api/predict-all", requireFirebaseAuth, requireTenantContext, requireMlServiceToken, predictAllProducts);
app.get("/api/compare-predictions", requireFirebaseAuth, requireTenantContext, requireMlServiceToken, comparePredictions);

// Backward-compatible aliases for legacy clients still calling old endpoints.
app.post("/api/predict/:productId", requireFirebaseAuth, requireTenantContext, requireMlServiceToken, predictByProduct);
app.get("/api/predict/:productId", requireFirebaseAuth, requireTenantContext, requireMlServiceToken, predictByProduct);

// Product intelligence endpoint
app.get("/api/products/:productId/intelligence", requireFirebaseAuth, requireTenantContext, getProductIntelligence);

const startServer = async () => {
  try {
    await pool.query("SELECT 1");
    console.log("PostgreSQL connected...");
    app.listen(process.env.PORT, () => {
      console.log(`Server running on port ${process.env.PORT}`);
    });
  } catch (error) {
    console.error("Failed to connect to PostgreSQL:", error?.code || error?.name || "unknown");
    process.exit(1);
  }
};

startServer();
