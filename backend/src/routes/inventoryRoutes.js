import { Router } from "express";
import { getInventoryIntelligence } from "../controllers/inventoryIntelligenceController.js";
import { requireFirebaseAuth } from "../middleware/firebaseAuth.js";
import { requireTenantContext } from "../middleware/tenantContext.js";

const router = Router();
router.use(requireFirebaseAuth, requireTenantContext);
router.get("/intelligence", getInventoryIntelligence);

export default router;
