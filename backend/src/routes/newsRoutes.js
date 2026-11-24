import express from "express";
import { getProductNewsInsights } from "../controllers/newsController.js";
import { requireSessionMembership } from "../middleware/clerkAuth.js";
import { requireTenantContext } from "../middleware/tenantContext.js";
import { requireMlServiceToken } from "../middleware/mlServiceAuth.js";

const router = express.Router();

router.use(requireSessionMembership, requireTenantContext, requireMlServiceToken);

router.get("/:productId", getProductNewsInsights);

export default router;
