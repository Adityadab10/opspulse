import express from "express";
import { getProductAnalysis } from "../controllers/productAnalysisController.js";
import {
  createProduct,
  deleteProduct,
  getAllProducts,
  getProduct,
  updateProduct,
} from "../controllers/productController.js";
import { getProductIntelligence } from "../controllers/productIntelligenceController.js";
import { adjustStock, getStockMovements } from "../controllers/inventoryController.js";
import { requireSessionMembership } from "../middleware/clerkAuth.js";
import { requireTenantContext } from "../middleware/tenantContext.js";

export const createProductRouter = ({
  authMiddleware = requireSessionMembership,
  tenantMiddleware = requireTenantContext,
} = {}) => {
  const router = express.Router();

  router.use(authMiddleware, tenantMiddleware);

  router.get("/analysis", getProductAnalysis); // 🔥 FIRST
  router.get("/analysis/:productId", getProductIntelligence);
  router.post("/:productId/stock", adjustStock);
  router.get("/:productId/stock/movements", getStockMovements);
  router.get("/:productId", getProduct);
  router.patch("/:productId", updateProduct);
  router.delete("/:productId", deleteProduct);
  router.get("/", getAllProducts);
  router.post("/", createProduct);

  return router;
};

export default createProductRouter();
