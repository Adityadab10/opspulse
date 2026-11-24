import express from "express";
import { getSummary, getTrends } from "../controllers/dashboardController.js";
import { requireSessionMembership } from "../middleware/clerkAuth.js";
import { requireTenantContext } from "../middleware/tenantContext.js";

export const createDashboardRouter = ({
  authMiddleware = requireSessionMembership,
  tenantMiddleware = requireTenantContext,
} = {}) => {
  const router = express.Router();

  router.use(authMiddleware, tenantMiddleware);

  router.get("/summary", getSummary);
  router.get("/trends", getTrends);

  return router;
};

export default createDashboardRouter();
