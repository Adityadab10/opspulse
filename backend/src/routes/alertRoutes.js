import express from "express";
import {
  getAlerts,
  createAlert,
  deactivateAlert,
} from "../controllers/alertController.js";
import { requireFirebaseAuth } from "../middleware/firebaseAuth.js";
import { requireTenantContext } from "../middleware/tenantContext.js";

export const createAlertRouter = ({
  authMiddleware = requireFirebaseAuth,
  tenantMiddleware = requireTenantContext,
} = {}) => {
  const router = express.Router();

  router.use(authMiddleware, tenantMiddleware);

  router.get("/", getAlerts);
  router.post("/", createAlert);
  router.patch("/:alertId/deactivate", deactivateAlert);

  return router;
};

export default createAlertRouter();
