import test from "node:test";
import assert from "node:assert/strict";

import productRoutes from "./productRoutes.js";
import salesRoutes from "./salesRoutes.js";
import dashboardRoutes from "./dashboardRoutes.js";
import alertRoutes from "./alertRoutes.js";
import uploadRoutes from "./uploadRoutes.js";
import predictionRoutes from "./predictionRoutes.js";
import newsRoutes from "./newsRoutes.js";
import aiAnalystRoutes from "./aiAnalystRoutes.js";
import forecastRoutes from "./forecastRoutes.js";

const protectedRoutes = [
  ["products", productRoutes],
  ["sales", salesRoutes],
  ["dashboard", dashboardRoutes],
  ["alerts", alertRoutes],
  ["upload", uploadRoutes],
  ["predictions", predictionRoutes],
  ["news", newsRoutes],
  ["AI Analyst", aiAnalystRoutes],
  ["forecast", forecastRoutes],
];

const invoke = async (router) => {
  const response = { statusCode: 200, body: null };
  let finish;
  const completed = new Promise((resolve) => {
    finish = resolve;
  });
  const req = { method: "POST", url: "/", headers: {} };
  const res = {
    status(code) {
      response.statusCode = code;
      return res;
    },
    json(payload) {
      response.body = payload;
      finish();
      return res;
    },
  };

  router(req, res, () => finish());
  await completed;
  return response;
};

for (const [name, router] of protectedRoutes) {
  test(`${name} router rejects missing Firebase authentication`, async () => {
    const response = await invoke(router);
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.body, { message: "Authorization is required" });
  });
}
