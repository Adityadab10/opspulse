import { insertSale, isProductReference, resolveProduct, getSalesByProductId } from "../config/postgres.js";

const toSalesResponse = ({ sale, product }) => ({
  _id: sale.id,
  id: sale.id,
  productId: {
    _id: product.id,
    id: product.id,
    name: product.name,
    category: product.category,
    legacyMongoId: product.legacy_mongo_id,
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

    if (!isProductReference(productId)) {
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

    if (!isProductReference(productId)) {
      return res.status(400).json({ message: "Invalid productId" });
    }

    const product = await resolveProduct(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const sales = await getSalesByProductId(product.id);
    const response = sales.map((sale) => ({
      _id: sale.id,
      id: sale.id,
      productId: {
        _id: product.id,
        id: product.id,
        name: product.name,
        category: product.category,
        legacyMongoId: product.legacy_mongo_id,
      },
      date: sale.sale_date,
      quantity: sale.quantity,
      createdAt: sale.created_at,
    }));

    return res.status(200).json(response);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch sales by product",
      error: error.message,
    });
  }
};
