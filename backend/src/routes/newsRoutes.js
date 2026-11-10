import express from "express";
import { getProductNewsInsights } from "../controllers/newsController.js";
import { requireFirebaseAuth } from "../middleware/firebaseAuth.js";
import { requireTenantContext } from "../middleware/tenantContext.js";
import { requireMlServiceToken } from "../middleware/mlServiceAuth.js";

const router = express.Router();

router.use(requireFirebaseAuth, requireTenantContext, requireMlServiceToken);

router.get("/:productId", getProductNewsInsights);

export default router;
