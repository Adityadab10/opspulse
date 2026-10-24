const getMlAnalystConfig = () => ({
  url: process.env.ML_ANALYST_URL || "http://localhost:5002/ai-analyst",
  timeoutMs: Number(process.env.ML_ANALYST_TIMEOUT_MS || 25000),
  internalToken: process.env.ML_ANALYST_INTERNAL_TOKEN?.trim(),
});

export const askAiAnalyst = async (req, res) => {
  const { url, timeoutMs, internalToken } = getMlAnalystConfig();
  if (!internalToken) {
    return res.status(503).json({ message: "AI Analyst authorization is not configured" });
  }

  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!question) {
    return res.status(400).json({ message: "question is required" });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ML-Internal-Token": internalToken,
      },
      body: JSON.stringify({ question }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({ error: "Invalid ML response" }));
    if (!response.ok) {
      return res.status(response.status).json(payload);
    }
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(503).json({
      message: error.name === "AbortError" ? "AI Analyst timed out" : "AI Analyst unavailable",
    });
  } finally {
    clearTimeout(timeoutId);
  }
};
