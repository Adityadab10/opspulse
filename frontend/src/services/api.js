import axios from "axios";
import {
  buildAuthenticatedRequestConfig,
  classifyApiError,
  isTenantContextStale,
} from "./authSupport";
import { getSelectedTenantId, getTenantContextVersion } from "./tenantState";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5001/api",
  timeout: 15000,
});

let apiErrorHandler = null;
let getSessionToken = async () => null;

export const setSessionTokenProvider = (provider) => {
  getSessionToken = provider || (async () => null);
};

export const setApiErrorHandler = (handler) => {
  apiErrorHandler = typeof handler === "function" ? handler : null;
};

export const createAuthRequestInterceptor = ({
  getCurrentUser = () => ({ getIdToken: () => getSessionToken() }),
  getTenantId = getSelectedTenantId,
  getTenantVersion = getTenantContextVersion,
} = {}) => async (config) => {
  return buildAuthenticatedRequestConfig({
    config,
    getCurrentUser,
    getTenantId: config.ignoreTenant ? () => null : getTenantId,
    getTenantContextVersion: getTenantVersion,
  });
};

api.interceptors.request.use(createAuthRequestInterceptor());
api.interceptors.response.use(
  (response) => {
    const requestVersion = response.config?.metadata?.tenantContextVersion;
    if (isTenantContextStale(requestVersion, getTenantContextVersion())) {
      const error = new Error("Tenant context changed while the request was in flight");
      error.code = "STALE_TENANT_CONTEXT";
      error.config = response.config;
      return Promise.reject(error);
    }
    return response;
  },
  (error) => {
    const requestVersion = error.config?.metadata?.tenantContextVersion;
    if (isTenantContextStale(requestVersion, getTenantContextVersion())) {
      error.code = "STALE_TENANT_CONTEXT";
      return Promise.reject(error);
    }

    const classified = classifyApiError(error);
    if (classified && apiErrorHandler) {
      apiErrorHandler(classified);
    }
    return Promise.reject(error);
  },
);

export const dashboardApi = {
  getSummary: (params = {}) => api.get("/dashboard/summary", { params }),
  getTrends: (params = {}) => api.get("/dashboard/trends", { params }),
};

export const productsApi = {
  getAnalysis: () => api.get("/products/analysis"),
  getAll: (params = {}) => api.get("/products", { params }),
  getById: (productId) => api.get(`/products/${encodeURIComponent(productId)}`),
  create: (product) => api.post("/products", product),
  update: (productId, product) => api.patch(`/products/${encodeURIComponent(productId)}`, product),
  remove: (productId) => api.delete(`/products/${encodeURIComponent(productId)}`),
  adjustStock: (productId, adjustment) => api.post(`/products/${encodeURIComponent(productId)}/stock`, adjustment),
  getStockMovements: (productId) => api.get(`/products/${encodeURIComponent(productId)}/stock/movements`),
};

export const salesApi = {
  getHistory: (params = {}) => api.get("/sales", { params }),
  create: (sale) => api.post("/sales", sale),
};

export const forecastApi = {
  getProductForecast: (productId, params = {}) => api.get(`/forecast/${encodeURIComponent(productId)}`, { params }),
};

export const predictionApi = {
  getPredictions: (params = {}) => api.get("/predictions", { params }),
  runPrediction: (productId, params = {}) =>
    api.post(`/predictions/predict/${encodeURIComponent(productId)}`, {}, { params }),
  runAllPredictions: (params = {}) => api.post("/predict-all", {}, { params }),
};

export const comparisonApi = {
  getComparisons: () => api.get("/compare-predictions", { timeout: 60000 }),
};

export const newsApi = {
  getProductNews: (productId) => api.get(`/news/${encodeURIComponent(productId)}`),
};

export const alertsApi = {
  getAlerts: () => api.get("/alerts"),
};

export const productIntelligenceApi = {
  getProductIntelligence: (productId) => api.get(`/products/${productId}/intelligence`),
};

export const inventoryApi = {
  getIntelligence: (params = {}) => api.get("/inventory/intelligence", { params }),
};

export const inventoryAgentApi = {
  start: (horizonDays = 30) => api.post("/inventory-agent/runs", { horizonDays }, { timeout: 30000 }),
  listRuns: () => api.get("/inventory-agent/runs"),
  decide: (actionId, decision) => api.post(`/inventory-agent/actions/${encodeURIComponent(actionId)}/decision`, { decision }),
  execute: (actionId) => api.post(`/inventory-agent/actions/${encodeURIComponent(actionId)}/execute`),
};

export const uploadApi = {
  uploadCsv: (file) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post("/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
};

export const aiAnalystApi = {
  ask: (question, conversation = []) =>
    api.post("/ai-analyst", { question, conversation }, {
      timeout: 30000,
    }),
};

export default api;
