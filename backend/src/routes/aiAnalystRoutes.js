import express from "express";
import { askAiAnalyst } from "../controllers/aiAnalystController.js";
import { requireFirebaseAuth } from "../middleware/firebaseAuth.js";
import { requireTenantContext } from "../middleware/tenantContext.js";

const router = express.Router();

router.post("/", requireFirebaseAuth, requireTenantContext, askAiAnalyst);

export default router;
