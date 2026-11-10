import express from "express";
import { getSummary, getTrends } from "../controllers/dashboardController.js";
import { requireFirebaseAuth } from "../middleware/firebaseAuth.js";
import { requireTenantContext } from "../middleware/tenantContext.js";

export const createDashboardRouter = ({
  authMiddleware = requireFirebaseAuth,
  tenantMiddleware = requireTenantContext,
} = {}) => {
  const router = express.Router();

  router.use(authMiddleware, tenantMiddleware);

  router.get("/summary", getSummary);
  router.get("/trends", getTrends);

  return router;
};

export default createDashboardRouter();
