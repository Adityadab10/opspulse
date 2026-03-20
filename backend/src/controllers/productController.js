import Product from "../models/Product.js";

export const createProduct = async (req, res) => {
  try {
    const { name, category } = req.body;

    if (!name || !category) {
      return res.status(400).json({ message: "name and category are required" });
    }

    const product = await Product.create({
      name: String(name).trim(),
      category: String(category).trim(),
    });

    return res.status(201).json(product);
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