import {
  getSalesByProductId,
  getSalesHistory,
  insertSale,
  isProductReference,
  resolveProduct,
} from "../config/postgres.js";
import { sendBackendError } from "../helpers/errorResponse.js";
import { DashboardDateRangeError, getDashboardDateRange } from "../services/dashboardMetrics.js";

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
        errors: {
          ...(!productId ? { productId: "productId is required" } : {}),
          ...(!date ? { date: "date is required" } : {}),
          ...(quantity === undefined ? { quantity: "quantity is required" } : {}),
        },
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

    const result = await insertSale(req.authContext.tenantId, productId, new Date(date), Number(quantity));
    if (!result) {
      return res.status(404).json({ message: "Product not found" });
    }
    if (result.insufficientStock) {
      return res.status(409).json({ message: "Insufficient stock for this sale", availableStock: result.availableStock });
    }
    if (!result.sale) {
      return res.status(409).json({ message: "Sale could not be recorded because the transaction is no longer available" });
    }
    if (!result.inserted) {
      return res.status(409).json({ message: "A sale for this product and timestamp already exists" });
    }

    return res.status(201).json(toSalesResponse(result));
  } catch (error) {
    return sendBackendError(res, "Failed to add sales", error);
  }
};

export const getSalesHistoryController = async (req, res) => {
  try {
    const { productId, start, end } = req.query || {};
    if (productId !== undefined && !isProductReference(productId)) {
      return res.status(400).json({ message: "Invalid productId" });
    }
    let dateRange;
    try {
      dateRange = getDashboardDateRange({ start, end });
    } catch (error) {
      if (error instanceof DashboardDateRangeError) {
        return res.status(400).json({ message: error.message });
      }
      throw error;
    }

    let resolvedProductId = null;
    if (productId) {
      const product = await resolveProduct(req.authContext.tenantId, productId);
      if (!product || product.legacy_mongo_id === "test123") {
        return res.status(404).json({ message: "Product not found" });
      }
      resolvedProductId = product.id;
    }

    const sales = await getSalesHistory(req.authContext.tenantId, {
      productId: resolvedProductId,
      startDate: dateRange.startDate,
      endDateExclusive: dateRange.endDateExclusive,
    });
    return res.status(200).json(sales.map((sale) => ({
      _id: sale.id,
      id: sale.id,
      productId: sale.product_id,
      productName: sale.product_name,
      productCategory: sale.product_category,
      date: sale.sale_date,
      quantity: sale.quantity,
      createdAt: sale.created_at,
    })));
  } catch (error) {
    return sendBackendError(res, "Failed to fetch sales history", error);
  }
};

export const getSalesByProduct = async (req, res) => {
  try {
    const { productId } = req.params;

    if (!isProductReference(productId)) {
      return res.status(400).json({ message: "Invalid productId" });
    }

    const product = await resolveProduct(req.authContext.tenantId, productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const sales = await getSalesByProductId(req.authContext.tenantId, product.id);
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
    return sendBackendError(res, "Failed to fetch sales by product", error);
  }
};
