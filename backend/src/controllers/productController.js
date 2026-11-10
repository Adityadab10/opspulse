import { createProduct as createPostgresProduct, getAllProducts as getPostgresProducts } from "../config/postgres.js";
import { sendBackendError } from "../helpers/errorResponse.js";

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

    const product = await createPostgresProduct(req.authContext.tenantId, name, category);

    return res.status(201).json(toProductResponse(product));
  } catch (error) {
    return sendBackendError(res, "Failed to create product", error);
  }
};

export const getAllProducts = async (req, res) => {
  try {
    const products = await getPostgresProducts(req.authContext.tenantId, "created_at");
    return res.status(200).json(products.map(toProductResponse));
  } catch (error) {
    return sendBackendError(res, "Failed to fetch products", error);
  }
};
