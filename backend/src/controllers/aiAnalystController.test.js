import test from "node:test";
import assert from "node:assert/strict";

import { askAiAnalyst } from "./aiAnalystController.js";

const invoke = async (body) => {
  const response = { statusCode: 200, body: null };
  const res = {
    status(code) {
      response.statusCode = code;
      return res;
    },
    json(payload) {
      response.body = payload;
      return res;
    },
  };
  await askAiAnalyst({ body }, res);
  return response;
};

test("proxies grounded AI Analyst responses with only the internal credential", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.ML_ANALYST_URL;
  const originalToken = process.env.ML_ANALYST_INTERNAL_TOKEN;
  let request;

  process.env.ML_ANALYST_URL = "http://local-ml.test/ai-analyst";
  process.env.ML_ANALYST_INTERNAL_TOKEN = "internal-test-token";
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(
      JSON.stringify({
        answer: "Grounded answer",
        sources: [{ type: "documentation", label: "OpsPulse documentation" }],
        provenance: { liveData: false, documentation: true },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const response = await invoke({ question: "Explain inventory recommendations" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.provenance.documentation, true);
    assert.equal(request.url, "http://local-ml.test/ai-analyst");
    assert.equal(request.options.headers["X-ML-Internal-Token"], "internal-test-token");
    assert.equal(request.options.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(request.options.body), {
      question: "Explain inventory recommendations",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.ML_ANALYST_URL;
    else process.env.ML_ANALYST_URL = originalUrl;
    if (originalToken === undefined) delete process.env.ML_ANALYST_INTERNAL_TOKEN;
    else process.env.ML_ANALYST_INTERNAL_TOKEN = originalToken;
  }
});

test("fails safely when the internal credential is missing", async () => {
  const originalToken = process.env.ML_ANALYST_INTERNAL_TOKEN;
  delete process.env.ML_ANALYST_INTERNAL_TOKEN;
  try {
    const response = await invoke({ question: "How many products exist?" });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.body, { message: "AI Analyst authorization is not configured" });
  } finally {
    if (originalToken === undefined) delete process.env.ML_ANALYST_INTERNAL_TOKEN;
    else process.env.ML_ANALYST_INTERNAL_TOKEN = originalToken;
  }
});

test("sanitizes upstream provider errors without rewriting the response", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.ML_ANALYST_INTERNAL_TOKEN;
  process.env.ML_ANALYST_INTERNAL_TOKEN = "internal-test-token";
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "AI Analyst provider is unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });

  try {
    const response = await invoke({ question: "How many products exist?" });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.body, { error: "AI Analyst provider is unavailable" });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.ML_ANALYST_INTERNAL_TOKEN;
    else process.env.ML_ANALYST_INTERNAL_TOKEN = originalToken;
  }
});

test("returns a sanitized error when ML service times out", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.ML_ANALYST_INTERNAL_TOKEN;
  process.env.ML_ANALYST_INTERNAL_TOKEN = "internal-test-token";
  globalThis.fetch = async () => {
    const error = new Error("request timed out");
    error.name = "AbortError";
    throw error;
  };

  try {
    const response = await invoke({ question: "How many products exist?" });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.body, { message: "AI Analyst timed out" });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.ML_ANALYST_INTERNAL_TOKEN;
    else process.env.ML_ANALYST_INTERNAL_TOKEN = originalToken;
  }
});
