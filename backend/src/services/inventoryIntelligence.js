export const DEFAULT_HORIZON_DAYS = 30;
export const MAX_HORIZON_DAYS = 90;
export const DEFAULT_REORDER_THRESHOLD = 10;
export const OVERSTOCK_RATIO = 2;

export const normalizeHorizon = (value) => {
  const horizon = Number(value ?? DEFAULT_HORIZON_DAYS);
  return Number.isInteger(horizon) && horizon >= 1 && horizon <= MAX_HORIZON_DAYS ? horizon : null;
};

const round = (value) => Math.round(value * 100) / 100;

export const calculateInventoryHealth = (rows, { horizonDays = DEFAULT_HORIZON_DAYS } = {}) => {
  const products = [];
  const alerts = [];
  const seenAlerts = new Set();

  for (const row of rows || []) {
    const currentStock = Math.max(0, Number(row.stock_quantity || 0));
    const reorderThreshold = Math.max(0, Number(row.reorder_threshold ?? DEFAULT_REORDER_THRESHOLD));
    const storedHorizon = Number(row.prediction_horizon_days);
    const predictedDemand = Number(row.predicted_demand);
    const forecastAvailable = Number.isFinite(predictedDemand) && predictedDemand >= 0 && Number.isFinite(storedHorizon) && storedHorizon > 0;
    const expectedDemand = forecastAvailable ? round(predictedDemand * horizonDays / storedHorizon) : null;
    const lowStock = currentStock <= reorderThreshold;
    const stockoutRisk = forecastAvailable && currentStock < expectedDemand;
    const overstock = forecastAvailable && expectedDemand > 0 && currentStock >= expectedDemand * OVERSTOCK_RATIO;
    const recommendedReorderQuantity = forecastAvailable ? Math.max(0, Math.ceil(expectedDemand - currentStock)) : null;
    const daysOfCover = forecastAvailable && expectedDemand > 0 ? round(currentStock / (expectedDemand / horizonDays)) : null;
    const product = {
      id: row.id,
      name: row.name,
      category: row.category,
      currentStock,
      reorderThreshold,
      lowStock,
      forecastStatus: forecastAvailable ? "available" : "missing",
      expectedDemand,
      forecastHorizonDays: forecastAvailable ? horizonDays : null,
      predictionGeneratedAt: row.predicted_at || null,
      recommendedReorderQuantity,
      daysOfCover,
      stockoutRisk,
      overstock,
    };
    products.push(product);

    const addAlert = (type, severity, reason, action) => {
      const key = `${row.id}:${type}`;
      if (seenAlerts.has(key)) return;
      seenAlerts.add(key);
      alerts.push({ key, type, severity, productId: row.id, productName: row.name, currentStock, reorderThreshold, expectedDemand, horizonDays, reason, action });
    };
    if (stockoutRisk) addAlert("STOCKOUT_RISK", currentStock === 0 ? "critical" : "high", `Current stock (${currentStock}) is below expected demand (${expectedDemand}) over the next ${horizonDays} days.`, `Review replenishment; advisory quantity is ${recommendedReorderQuantity} units.`);
    if (lowStock) addAlert("LOW_STOCK", currentStock === 0 ? "high" : "medium", `Current stock (${currentStock}) is at or below the configured reorder threshold (${reorderThreshold}).`, "Review stock and replenish if demand coverage is insufficient.");
    if (overstock) addAlert("OVERSTOCK", "low", `Current stock (${currentStock}) is at least ${OVERSTOCK_RATIO}× expected demand (${expectedDemand}) over the next ${horizonDays} days.`, "Consider slowing replenishment or reviewing sell-through plans.");
  }

  return {
    products,
    alerts: alerts.sort((a, b) => ({ critical: 0, high: 1, medium: 2, low: 3 }[a.severity] - ({ critical: 0, high: 1, medium: 2, low: 3 }[b.severity]) || a.productName.localeCompare(b.productName))),
    summary: {
      totalProducts: products.length,
      lowStockProducts: products.filter((product) => product.lowStock).length,
      stockoutRiskProducts: products.filter((product) => product.stockoutRisk).length,
      overstockedProducts: products.filter((product) => product.overstock).length,
      missingForecastProducts: products.filter((product) => product.forecastStatus === "missing").length,
      alertCount: alerts.length,
    },
  };
};
