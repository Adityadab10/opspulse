import mongoose from "mongoose";
import Alert from "../models/Alert.js";
import Product from "../models/Product.js";

export const getAlerts = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 5, 10);

    const alerts = await Alert.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("productId", "name category");

    return res.status(200).json(alerts);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch alerts",
      error: error.message,
    });
  }
};

export const createAlert = async (req, res) => {
  try {
    const { productId, type, message } = req.body;

    if (!productId || !type || !message) {
      return res.status(400).json({
        message: "productId, type, and message are required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: "Invalid productId" });
    }

    const productExists = await Product.exists({ _id: productId });
    if (!productExists) {
      return res.status(404).json({ message: "Product not found" });
    }

    const alert = await Alert.create({
      productId,
      type,
      message: String(message).trim(),
    });

    const populatedAlert = await alert.populate("productId", "name category");
    return res.status(201).json(populatedAlert);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to create alert",
      error: error.message,
    });
  }
};