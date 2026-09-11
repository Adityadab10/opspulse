import mongoose from "mongoose";
import Product from "../models/Product.js";
import Sales from "../models/Sales.js";
import { insertSale } from "../config/postgres.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toSalesResponse = ({ sale, product }) => ({
  _id: sale.id,
  id: sale.id,
  productId: {
    _id: product.legacy_mongo_id || product.id,
    id: product.id,
    name: product.name,
    category: product.category,
  },
  date: sale.sale_date,
  quantity: sale.quantity,
  createdAt: sale.created_at,
});

export const addSales = async (req, res) => {
  try {
    const { productId, date, quantity } = req.body;

    if (!productId || !date || quantity === undefined) {
      return res.status(400).json({
        message: "productId, date, and quantity are required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(productId) && !UUID_PATTERN.test(String(productId))) {
      return res.status(400).json({ message: "Invalid productId" });
    }

    if (!Number.isInteger(Number(quantity)) || Number(quantity) <= 0) {
      return res.status(400).json({ message: "quantity must be a positive integer" });
    }

    if (Number.isNaN(new Date(date).getTime())) {
      return res.status(400).json({ message: "Invalid date" });
    }

    const result = await insertSale(productId, new Date(date), Number(quantity));
    if (!result) {
      return res.status(404).json({ message: "Product not found" });
    }

    return res.status(201).json(toSalesResponse(result));
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
