import { Router } from "express";
import { requireFirebaseAuth } from "../middleware/firebaseAuth.js";
import { requireTenantContext } from "../middleware/tenantContext.js";
import { decideInventoryAgentAction, executeInventoryAgentAction, listInventoryAgentRuns, startInventoryAgent } from "../controllers/inventoryAgentController.js";
const router = Router(); router.use(requireFirebaseAuth, requireTenantContext);
router.post('/runs', startInventoryAgent); router.get('/runs', listInventoryAgentRuns);
router.post('/actions/:actionId/decision', decideInventoryAgentAction); router.post('/actions/:actionId/execute', executeInventoryAgentAction);
export default router;
