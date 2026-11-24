import { Router } from "express";
import { getInventoryIntelligence } from "../controllers/inventoryIntelligenceController.js";
import { requireSessionMembership } from "../middleware/clerkAuth.js";
import { requireTenantContext } from "../middleware/tenantContext.js";

const router = Router();
router.use(requireSessionMembership, requireTenantContext);
router.get("/intelligence", getInventoryIntelligence);

export default router;
