import mongoose from "mongoose";
import Product from "../models/Product.js";
import Prediction from "../models/Prediction.js";
import { generatePredictionForProduct } from "../services/predictionService.js";

export const predictByProduct = async (req, res) => {
  try {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: "Invalid productId" });
    }

    const product = await Product.findById(productId).lean();
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const predictionPayload = await generatePredictionForProduct(productId);

    const prediction = await Prediction.findOneAndUpdate(
      { productId },
      { $set: { productId, ...predictionPayload } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).populate("productId", "name category");

    return res.status(200).json(prediction);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to generate prediction for product",
      error: error.message,
    });
  }
};

export const predictAllProducts = async (req, res) => {
  try {
    const products = await Product.find({}, "_id name category").lean();
    if (!products.length) {
      return res.status(200).json({
        processed: 0,
        saved: 0,
        failed: 0,
        predictions: [],
      });
    }

    const settled = await Promise.allSettled(
      products.map(async (product) => {
        const predictionPayload = await generatePredictionForProduct(product._id);

        const saved = await Prediction.findOneAndUpdate(
          { productId: product._id },
          { $set: { productId: product._id, ...predictionPayload } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        ).populate("productId", "name category");

        return saved;
      })
    );

    const predictions = settled
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);

    const failed = settled
      .filter((r) => r.status === "rejected")
      .map((r) => r.reason?.message || "Unknown error");

    return res.status(200).json({
      processed: products.length,
      saved: predictions.length,
      failed: failed.length,
      predictions,
      errors: failed,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to run bulk predictions",
      error: error.message,
    });
  }
};