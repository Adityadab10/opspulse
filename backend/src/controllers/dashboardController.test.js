import test from "node:test";
import assert from "node:assert/strict";

import { getSummary, getTrends } from "./dashboardController.js";

const responseRecorder = () => {
  const response = { statusCode: 200, body: null };
  const res = {
    status(statusCode) {
      response.statusCode = statusCode;
      return res;
    },
    json(body) {
      response.body = body;
      return res;
    },
  };
  return { response, res };
};

test("dashboard summary rejects an invalid date range before querying data", async () => {
  const { response, res } = responseRecorder();
  await getSummary({ authContext: { tenantId: "tenant-a" }, query: { start: "not-a-date" } }, res);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { message: "start must use YYYY-MM-DD format" });
});

test("dashboard trends rejects a reversed date range before querying data", async () => {
  const { response, res } = responseRecorder();
  await getTrends({ authContext: { tenantId: "tenant-a" }, query: { start: "2026-03-01", end: "2026-02-01" } }, res);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { message: "start must be on or before end" });
});
