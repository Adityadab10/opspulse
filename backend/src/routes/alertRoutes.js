import express from "express";
import { getAlerts, createAlert } from "../controllers/alertController.js";

const router = express.Router();

router.route("/").get(getAlerts).post(createAlert);

export default router;