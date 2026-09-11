import Product from "../models/Product.js";
import { createProduct as createPostgresProduct } from "../config/postgres.js";

const toProductResponse = (product) => ({
  _id: product.id,
  id: product.id,
  name: product.name,
  category: product.category,
  legacy_mongo_id: product.legacy_mongo_id,
  createdAt: product.created_at,
  updatedAt: product.updated_at,
});

export const createProduct = async (req, res) => {
  try {
    const { name, category } = req.body;

    if (!String(name || "").trim() || !String(category || "").trim()) {
      return res.status(400).json({ message: "name and category are required" });
    }

    const product = await createPostgresProduct(name, category);

    return res.status(201).json(toProductResponse(product));
  } catch (error) {
    return res.status(500).json({
      message: "Failed to create product",
      error: error.message,
    });
  }
};

export const getAllProducts = async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    return res.status(200).json(products);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch products",
      error: error.message,
    });
  }
};
