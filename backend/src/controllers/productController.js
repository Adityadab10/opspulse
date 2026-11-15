import {
  createProduct as createPostgresProduct,
  deleteProduct as deletePostgresProduct,
  findProductByNameAndCategory,
  getAllProducts as getPostgresProducts,
  getProductDependencies,
  isProductReference,
  resolveProduct,
  updateProduct as updatePostgresProduct,
} from "../config/postgres.js";
import { sendBackendError } from "../helpers/errorResponse.js";
import { normalizeProductInput, validateProductInput } from "../services/productValidation.js";

const toProductResponse = (product) => ({
  _id: product.id,
  id: product.id,
  name: product.name,
  category: product.category,
  stockQuantity: product.stock_quantity === undefined ? null : Number(product.stock_quantity),
  legacy_mongo_id: product.legacy_mongo_id,
  createdAt: product.created_at,
  updatedAt: product.updated_at,
});

const sendValidationError = (res, errors) => res.status(400).json({
  message: "Product validation failed",
  errors,
});

const validateReference = (productId, res) => {
  if (!isProductReference(productId)) {
    res.status(400).json({ message: "Invalid productId" });
    return false;
  }
  return true;
};

export const createProduct = async (req, res) => {
  try {
    const input = normalizeProductInput(req.body);
    const errors = validateProductInput(input);
    if (Object.keys(errors).length) return sendValidationError(res, errors);

    const duplicate = await findProductByNameAndCategory(req.authContext.tenantId, input.name, input.category);
    if (duplicate) return res.status(409).json({ message: "A product with this name and category already exists" });

    const product = await createPostgresProduct(req.authContext.tenantId, input.name, input.category);

    return res.status(201).json(toProductResponse(product));
  } catch (error) {
    return sendBackendError(res, "Failed to create product", error);
  }
};

export const getAllProducts = async (req, res) => {
  try {
    const search = typeof req.query?.search === "string" ? req.query.search.trim() : "";
    if (search.length > 100) return res.status(400).json({ message: "search must be 100 characters or fewer" });
    const products = await getPostgresProducts(req.authContext.tenantId, "created_at", search);
    return res.status(200).json(products.map(toProductResponse));
  } catch (error) {
    return sendBackendError(res, "Failed to fetch products", error);
  }
};

export const getProduct = async (req, res) => {
  try {
    if (!validateReference(req.params.productId, res)) return;
    const product = await resolveProduct(req.authContext.tenantId, req.params.productId);
    if (!product || product.legacy_mongo_id === "test123") {
      return res.status(404).json({ message: "Product not found" });
    }
    return res.status(200).json(toProductResponse(product));
  } catch (error) {
    return sendBackendError(res, "Failed to fetch product", error);
  }
};

export const updateProduct = async (req, res) => {
  try {
    if (!validateReference(req.params.productId, res)) return;
    const input = normalizeProductInput(req.body);
    const errors = validateProductInput(input);
    if (Object.keys(errors).length) return sendValidationError(res, errors);

    const current = await resolveProduct(req.authContext.tenantId, req.params.productId);
    if (!current || current.legacy_mongo_id === "test123") {
      return res.status(404).json({ message: "Product not found" });
    }
    const duplicate = await findProductByNameAndCategory(
      req.authContext.tenantId,
      input.name,
      input.category,
      current.id,
    );
    if (duplicate) return res.status(409).json({ message: "A product with this name and category already exists" });

    const product = await updatePostgresProduct(req.authContext.tenantId, current.id, input.name, input.category);
    return res.status(200).json(toProductResponse(product));
  } catch (error) {
    return sendBackendError(res, "Failed to update product", error);
  }
};

export const deleteProduct = async (req, res) => {
  try {
    if (!validateReference(req.params.productId, res)) return;
    const dependencyState = await getProductDependencies(req.authContext.tenantId, req.params.productId);
    if (!dependencyState || dependencyState.product.legacy_mongo_id === "test123") {
      return res.status(404).json({ message: "Product not found" });
    }
    const dependencies = {
      sales: Number(dependencyState.sales_count),
      predictions: Number(dependencyState.predictions_count),
      alerts: Number(dependencyState.alerts_count),
      inventoryMovements: Number(dependencyState.inventory_movements_count),
    };
    if (Object.values(dependencies).some((count) => count > 0)) {
      return res.status(409).json({
        message: "Product cannot be deleted while related records exist",
        dependencies,
      });
    }

    const result = await deletePostgresProduct(req.authContext.tenantId, dependencyState.product.id);
    if (!result?.deleted) {
      return res.status(409).json({ message: "Product cannot be deleted while related records exist" });
    }
    return res.status(204).send();
  } catch (error) {
    return sendBackendError(res, "Failed to delete product", error);
  }
};
