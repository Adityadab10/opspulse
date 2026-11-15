import axios from "axios";
import { auth } from "../../firebase.config";
import {
  buildAuthenticatedRequestConfig,
  classifyApiError,
  isTenantContextStale,
} from "./authSupport";
import { getSelectedTenantId, getTenantContextVersion } from "./tenantState";

const api = axios.create({
  baseURL: "http://localhost:5001/api",
  timeout: 15000,
});

let apiErrorHandler = null;

export const setApiErrorHandler = (handler) => {
  apiErrorHandler = typeof handler === "function" ? handler : null;
};

export const createAuthRequestInterceptor = ({
  getCurrentUser = () => auth?.currentUser,
  getTenantId = getSelectedTenantId,
  getTenantVersion = getTenantContextVersion,
} = {}) => async (config) => {
  return buildAuthenticatedRequestConfig({
    config,
    getCurrentUser,
    getTenantId,
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
};

export const salesApi = {
  getHistory: (params = {}) => api.get("/sales", { params }),
  create: (sale) => api.post("/sales", sale),
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
  ask: (question) =>
    api.post("/ai-analyst", { question }, {
      timeout: 30000,
    }),
};

export default api;
