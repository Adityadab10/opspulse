import { Router } from "express";
import { requireSessionMembership, requireTenantOwner } from "../middleware/clerkAuth.js";
import { requireTenantContext } from "../middleware/tenantContext.js";
import { decideInventoryAgentAction, executeInventoryAgentAction, listInventoryAgentRuns, startInventoryAgent } from "../controllers/inventoryAgentController.js";
const router = Router(); router.use(requireSessionMembership, requireTenantContext);
router.post('/runs', startInventoryAgent); router.get('/runs', listInventoryAgentRuns);
router.post('/actions/:actionId/decision', requireTenantOwner, decideInventoryAgentAction); router.post('/actions/:actionId/execute', requireTenantOwner, executeInventoryAgentAction);
export default router;
