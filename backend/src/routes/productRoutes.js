import express from "express";
import { getProductAnalysis } from "../controllers/productAnalysisController.js";
import { getAllProducts, createProduct } from "../controllers/productController.js";
import { getProductIntelligence } from "../controllers/productIntelligenceController.js";

const router = express.Router();

router.get("/analysis", getProductAnalysis); // 🔥 FIRST
router.get("/analysis/:productId", getProductIntelligence);
router.get("/", getAllProducts);
router.post("/", createProduct);

export default router;