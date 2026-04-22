import express from "express";
import { getProductNewsInsights } from "../controllers/newsController.js";

const router = express.Router();

router.get("/:productId", getProductNewsInsights);

export default router;
