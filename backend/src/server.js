import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";

import productRoutes from "./routes/productRoutes.js";
import salesRoutes from "./routes/salesRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import alertRoutes from "./routes/alertRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import predictionRoutes from "./routes/predictionRoutes.js";
import newsRoutes from "./routes/newsRoutes.js";
import {
  predictAllProducts,
  predictByProduct,
  comparePredictions,
} from "./controllers/predictionController.js";



dotenv.config();

const app = express();


// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get("/", (req, res) => {
  res.send("API is running...");
});
app.use("/api/products", productRoutes);
app.use("/api/products/analysis",productRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/predictions", predictionRoutes);
app.use("/api/news", newsRoutes);
app.post("/api/predict-all", predictAllProducts);
app.get("/api/compare-predictions", comparePredictions);

// Backward-compatible aliases for legacy clients still calling old endpoints.
app.post("/api/predict/:productId", predictByProduct);
app.get("/api/predict/:productId", predictByProduct);

// DB connection
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    console.log("MongoDB connected...");
    app.listen(process.env.PORT, () => {
      console.log(`Server running on port ${process.env.PORT}`);
    });
  })
  .catch((err) => console.error(err));
