import express from "express";
import { getProductAnalysis } from "../controllers/productAnalysisController.js";
import { getAllProducts, createProduct } from "../controllers/productController.js";
import { getProductIntelligence } from "../controllers/productIntelligenceController.js";
import { requireFirebaseAuth } from "../middleware/firebaseAuth.js";
import { requireTenantContext } from "../middleware/tenantContext.js";

export const createProductRouter = ({
  authMiddleware = requireFirebaseAuth,
  tenantMiddleware = requireTenantContext,
} = {}) => {
  const router = express.Router();

  router.use(authMiddleware, tenantMiddleware);

  router.get("/analysis", getProductAnalysis); // 🔥 FIRST
  router.get("/analysis/:productId", getProductIntelligence);
  router.get("/", getAllProducts);
  router.post("/", createProduct);

  return router;
};

export default createProductRouter();
