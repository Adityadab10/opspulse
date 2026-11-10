import {
  createMlServiceError,
  getMlAnalystConfig,
  requestMlService,
} from "./mlAnalystClient.js";

const getPredictionConfig = () => ({
  predictionUrl: process.env.ML_PREDICT_URL || "http://localhost:5002/predict",
  comparisonUrl: process.env.ML_COMPARE_URL || "http://localhost:5002/compare-models",
  timeoutMs: Number(process.env.ML_TIMEOUT_MS || 10000),
  comparisonTimeoutMs: Number(process.env.ML_COMPARE_TIMEOUT_MS || 30000),
  internalToken: getMlAnalystConfig().internalToken,
});

const requestPredictionService = async ({ url, timeoutMs, productId }) => {
  const config = getPredictionConfig();
  const response = await requestMlService({
    url,
    timeoutMs,
    internalToken: config.internalToken,
    body: { productId: String(productId) },
  });
  if (!response.ok) throw createMlServiceError(response.status);
  return response.payload;
};

export const requestMlPrediction = (productId) => {
  const config = getPredictionConfig();
  return requestPredictionService({
    url: config.predictionUrl,
    timeoutMs: config.timeoutMs,
    productId,
  });
};

export const requestMlComparison = (productId) => {
  const config = getPredictionConfig();
  return requestPredictionService({
    url: config.comparisonUrl,
    timeoutMs: config.comparisonTimeoutMs,
    productId,
  });
};
