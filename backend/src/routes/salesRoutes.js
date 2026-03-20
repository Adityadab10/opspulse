import express from "express";
import { addSales, getSalesByProduct } from "../controllers/salesController.js";

const router = express.Router();

router.post("/", addSales);
router.get("/:productId", getSalesByProduct);

export default router;