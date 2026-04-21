import express from "express";
import {
  getUnifiedPredictions,
  predictByProduct,
  predictAllProducts,
} from "../controllers/predictionController.js";

const router = express.Router();

router.get("/", getUnifiedPredictions);
router.post("/predict/:productId", predictByProduct);
router.post("/predict-all", predictAllProducts);

export default router;