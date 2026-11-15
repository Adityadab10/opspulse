import { adjustProductStock, getInventoryMovements, isProductReference } from "../config/postgres.js";
import { sendBackendError } from "../helpers/errorResponse.js";

const toProduct = (product) => ({
  _id: product.id,
  id: product.id,
  name: product.name,
  category: product.category,
  stockQuantity: Number(product.stock_quantity),
});

export const adjustStock = async (req, res) => {
  try {
    const { productId } = req.params;
    const { mode = "adjust", quantity, reason } = req.body || {};
    if (!isProductReference(productId)) return res.status(400).json({ message: "Invalid productId" });
    if (!(["set", "adjust"].includes(mode))) return res.status(400).json({ message: "mode must be set or adjust" });
    const numericQuantity = Number(quantity);
    const validQuantity = Number.isInteger(numericQuantity)
      && (mode === "set" ? numericQuantity >= 0 : numericQuantity !== 0);
    const errors = {};
    if (!validQuantity) errors.quantity = mode === "set"
      ? "quantity must be a non-negative integer"
      : "quantity must be a non-zero integer adjustment";
    if (typeof reason !== "string" || !reason.trim()) errors.reason = "reason is required";
    if (typeof reason === "string" && reason.trim().length > 255) errors.reason = "reason must be 255 characters or fewer";
    if (Object.keys(errors).length) return res.status(400).json({ message: "Stock adjustment validation failed", errors });

    const result = await adjustProductStock(req.authContext.tenantId, productId, {
      mode,
      quantity: numericQuantity,
      reason: reason.trim(),
    });
    if (!result) return res.status(404).json({ message: "Product not found" });
    if (result.insufficientStock) {
      return res.status(409).json({ message: "Stock cannot become negative", availableStock: result.availableStock });
    }
    return res.status(200).json({ product: toProduct(result.product), movement: result.movement });
  } catch (error) {
    return sendBackendError(res, "Failed to adjust stock", error);
  }
};

export const getStockMovements = async (req, res) => {
  try {
    if (!isProductReference(req.params.productId)) return res.status(400).json({ message: "Invalid productId" });
    const result = await getInventoryMovements(req.authContext.tenantId, req.params.productId);
    if (!result) return res.status(404).json({ message: "Product not found" });
    return res.status(200).json({ product: toProduct(result.product), movements: result.movements });
  } catch (error) {
    return sendBackendError(res, "Failed to fetch stock movements", error);
  }
};
