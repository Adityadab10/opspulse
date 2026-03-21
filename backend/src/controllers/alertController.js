import mongoose from "mongoose";
import Alert from "../models/Alert.js";
import Product from "../models/Product.js";

// GET latest active alerts
export const getAlerts = async (req, res) => {
  try {
    const alerts = await Alert.find({ isActive: true })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("productId", "name category")
      .lean();

    return res.status(200).json(alerts);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch alerts",
      error: error.message,
    });
  }
};

// CREATE alert (manual for now)
export const createAlert = async (req, res) => {
  try {
    const { productId, type, message, severity, percentChange } = req.body;

    // Validation
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

    // Create alert
    const created = await Alert.create({
      productId,
      type,
      message: String(message).trim(),
      severity: severity || "MEDIUM",
      percentChange: percentChange || 0,
      isActive: true,
    });

    const populated = await created.populate("productId", "name category");

    return res.status(201).json(populated);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to create alert",
      error: error.message,
    });
  }
};

// OPTIONAL: deactivate alert later
export const deactivateAlert = async (req, res) => {
  try {
    const { alertId } = req.params;

    const alert = await Alert.findByIdAndUpdate(
      alertId,
      { isActive: false },
      { new: true }
    );

    if (!alert) {
      return res.status(404).json({ message: "Alert not found" });
    }

    return res.status(200).json({ message: "Alert deactivated", alert });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to deactivate alert",
      error: error.message,
    });
  }
};