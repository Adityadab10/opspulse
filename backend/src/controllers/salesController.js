import mongoose from "mongoose";
import Product from "../models/Product.js";
import Sales from "../models/Sales.js";

export const addSales = async (req, res) => {
  try {
    const { productId, date, quantity } = req.body;

    if (!productId || !date || quantity === undefined) {
      return res.status(400).json({
        message: "productId, date, and quantity are required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: "Invalid productId" });
    }

    if (Number(quantity) <= 0) {
      return res.status(400).json({ message: "quantity must be greater than 0" });
    }

    const productExists = await Product.exists({ _id: productId });
    if (!productExists) {
      return res.status(404).json({ message: "Product not found" });
    }

    const sales = await Sales.create({
      productId,
      date: new Date(date),
      quantity: Number(quantity),
    });

    const populatedSales = await sales.populate("productId", "name category");
    return res.status(201).json(populatedSales);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to add sales",
      error: error.message,
    });
  }
};

export const getSalesByProduct = async (req, res) => {
  try {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: "Invalid productId" });
    }

    const productExists = await Product.exists({ _id: productId });
    if (!productExists) {
      return res.status(404).json({ message: "Product not found" });
    }

    const sales = await Sales.find({ productId })
      .sort({ date: -1 })
      .populate("productId", "name category");

    return res.status(200).json(sales);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch sales by product",
      error: error.message,
    });
  }
};