import express from "express";
import {
  getUnifiedPredictions,
  predictByProduct,
  predictAllProducts,
} from "../controllers/predictionController.js";
import { requireFirebaseAuth } from "../middleware/firebaseAuth.js";
import { requireTenantContext } from "../middleware/tenantContext.js";
import { requireMlServiceToken } from "../middleware/mlServiceAuth.js";

export const createPredictionRouter = ({
  authMiddleware = requireFirebaseAuth,
  tenantMiddleware = requireTenantContext,
  mlServiceMiddleware = requireMlServiceToken,
} = {}) => {
  const router = express.Router();

  router.use(authMiddleware, tenantMiddleware, mlServiceMiddleware);
  router.get("/", getUnifiedPredictions);
  router.post("/predict/:productId", predictByProduct);
  router.post("/predict-all", predictAllProducts);
  return router;
};

export default createPredictionRouter();
