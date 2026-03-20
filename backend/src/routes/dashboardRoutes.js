import express from "express";
import {
  getSummary,
  getTrends,
  getDistribution,
} from "../controllers/dashboardController.js";

const router = express.Router();

router.get("/summary", getSummary);
router.get("/trends", getTrends);
router.get("/distribution", getDistribution);

export default router;