import express from "express";
import {
  getAlerts,
  createAlert,
  deactivateAlert,
} from "../controllers/alertController.js";

const router = express.Router();

router.get("/", getAlerts);
router.post("/", createAlert);
router.patch("/:alertId/deactivate", deactivateAlert);

export default router;