import express from "express";
import { askAiAnalyst } from "../controllers/aiAnalystController.js";
import { requireSessionMembership } from "../middleware/clerkAuth.js";
import { requireTenantContext } from "../middleware/tenantContext.js";

const router = express.Router();

router.post("/", requireSessionMembership, requireTenantContext, askAiAnalyst);

export default router;
