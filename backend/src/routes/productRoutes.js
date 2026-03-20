import express from "express";
import { createProduct, getAllProducts } from "../controllers/productController.js";
import { getProductAnalysis } from "../controllers/dashboardController.js";

const router = express.Router();

router.route("/").post(createProduct).get(getAllProducts);
router.get("/analysis", getProductAnalysis);

export default router;