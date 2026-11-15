import express from "express";
import { forecastProduct } from "../controllers/forecastController.js";
import { requireFirebaseAuth } from "../middleware/firebaseAuth.js";
import { requireTenantContext } from "../middleware/tenantContext.js";
import { requireMlServiceToken } from "../middleware/mlServiceAuth.js";

const router = express.Router();
router.use(requireFirebaseAuth, requireTenantContext, requireMlServiceToken);
router.get("/:productId", forecastProduct);

export default router;
