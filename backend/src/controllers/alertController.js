import {
  createAlert as createPostgresAlert,
  deactivateAlertById,
  getRecentActiveAlerts,
  isProductReference,
} from "../config/postgres.js";
import { sendBackendError } from "../helpers/errorResponse.js";

const mapCreatedAlert = ({ alert, product }) => ({
  _id: alert.id,
  productId: {
    _id: product.id,
    id: product.id,
    name: product.name,
    category: product.category,
  },
  type: alert.type,
  message: alert.message,
  severity: alert.severity,
  percentChange: alert.percent_change || 0,
  isActive: alert.is_active,
  createdAt: alert.created_at,
});

// GET latest active alerts
export const getAlerts = async (req, res) => {
  try {
    const alerts = await getRecentActiveAlerts(req.authContext.tenantId);

    const mappedAlerts = alerts.map((a) => ({
      _id: a.id,
      productId: {
        name: a.productName || "Unknown Product",
        category: a.productCategory || "Uncategorized",
      },
      type: a.type,
      message: a.message,
      severity: a.severity,
      percentChange: a.percent_change || 0,
      isActive: a.is_active,
      createdAt: a.created_at,
    }));

    return res.status(200).json(mappedAlerts);
  } catch (error) {
    return sendBackendError(res, "Failed to fetch alerts", error);
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

    if (!isProductReference(productId)) {
      return res.status(400).json({ message: "Invalid productId" });
    }

    const created = await createPostgresAlert(req.authContext.tenantId, productId, {
      type,
      message: String(message).trim(),
      severity: severity || "MEDIUM",
      percentChange: percentChange || 0,
      isActive: true,
    });

    if (!created) {
      return res.status(404).json({ message: "Product not found" });
    }

    return res.status(201).json(mapCreatedAlert(created));
  } catch (error) {
    return sendBackendError(res, "Failed to create alert", error);
  }
};

// OPTIONAL: deactivate alert later
export const deactivateAlert = async (req, res) => {
  try {
    const { alertId } = req.params;

    const alert = await deactivateAlertById(req.authContext.tenantId, alertId);

    if (!alert) {
      return res.status(404).json({ message: "Alert not found" });
    }

    return res.status(200).json({
      message: "Alert deactivated",
      alert: {
        _id: alert.id,
        productId: alert.product_id,
        type: alert.type,
        message: alert.message,
        severity: alert.severity,
        percentChange: alert.percent_change || 0,
        isActive: alert.is_active,
        createdAt: alert.created_at,
      },
    });
  } catch (error) {
    return sendBackendError(res, "Failed to deactivate alert", error);
  }
};
