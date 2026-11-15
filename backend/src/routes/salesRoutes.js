import express from "express";
import { addSales, getSalesByProduct, getSalesHistoryController } from "../controllers/salesController.js";
import { requireFirebaseAuth } from "../middleware/firebaseAuth.js";
import { requireTenantContext } from "../middleware/tenantContext.js";

export const createSalesRouter = ({
  authMiddleware = requireFirebaseAuth,
  tenantMiddleware = requireTenantContext,
} = {}) => {
  const router = express.Router();

  router.use(authMiddleware, tenantMiddleware);

  router.post("/", addSales);
  router.get("/", getSalesHistoryController);
  router.get("/:productId", getSalesByProduct);

  return router;
};

export default createSalesRouter();
