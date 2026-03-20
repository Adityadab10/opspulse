import express from "express";
import {
  predictByProduct,
  predictAllProducts,
} from "../controllers/predictionController.js";

const router = express.Router();

router.post("/predict/:productId", predictByProduct);
router.post("/predict-all", predictAllProducts);

export default router;