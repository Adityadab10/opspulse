import { getInventoryHealthData } from "../config/postgres.js";
import { sendBackendError } from "../helpers/errorResponse.js";
import { calculateInventoryHealth, DEFAULT_HORIZON_DAYS, MAX_HORIZON_DAYS, OVERSTOCK_RATIO, normalizeHorizon } from "../services/inventoryIntelligence.js";

export const getInventoryIntelligence = async (req, res) => {
  const horizonDays = normalizeHorizon(req.query?.horizon);
  if (!horizonDays) return res.status(400).json({ message: `horizon must be an integer between 1 and ${MAX_HORIZON_DAYS}` });
  try {
    const result = calculateInventoryHealth(await getInventoryHealthData(req.authContext.tenantId), { horizonDays });
    return res.status(200).json({ ...result, horizonDays, overstockRatio: OVERSTOCK_RATIO, supplierLeadTimeAvailable: false, calculationPolicy: `Low stock uses each product's reorder threshold (default ${10} units). Demand is scaled from the persisted forecast horizon. Reorder quantities cover the selected horizon only; supplier lead time is unavailable.` });
  } catch (error) {
    return sendBackendError(res, "Failed to load inventory intelligence", error);
  }
};

export { DEFAULT_HORIZON_DAYS };
