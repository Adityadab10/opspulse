import express from "express";
import { getProductAnalysis } from "../controllers/productAnalysisController.js";
import { getAllProducts, createProduct } from "../controllers/productController.js";

const router = express.Router();

router.get("/analysis", getProductAnalysis); // 🔥 FIRST
router.get("/", getAllProducts);
router.post("/", createProduct);

export default router;