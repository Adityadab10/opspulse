import express from "express";
import { getSummary, getTrends } from "../controllers/dashboardController.js";

const router = express.Router();

router.get("/summary", getSummary);
router.get("/trends", getTrends);

export default router;