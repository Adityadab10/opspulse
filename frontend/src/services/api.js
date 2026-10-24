import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:5001/api",
  timeout: 15000,
});

export const dashboardApi = {
  getSummary: () => api.get("/dashboard/summary"),
  getTrends: () => api.get("/dashboard/trends"),
};

export const productsApi = {
  getAnalysis: () => api.get("/products/analysis"),
  getAll: () => api.get("/products"),
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
  ask: (question, authorization) =>
    api.post("/ai-analyst", { question }, {
      headers: authorization ? { Authorization: authorization } : undefined,
      timeout: 30000,
    }),
};

export default api;