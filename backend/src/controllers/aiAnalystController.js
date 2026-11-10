import { getMlAnalystConfig, requestMlAnalyst } from "../services/mlAnalystClient.js";

export const askAiAnalyst = async (req, res) => {
  const { internalToken } = getMlAnalystConfig();
  if (!internalToken) {
    return res.status(503).json({ message: "AI Analyst authorization is not configured" });
  }

  const { userId, tenantId } = req.authContext || {};
  if (!userId || !tenantId) {
    return res.status(403).json({ message: "Trusted identity context is required" });
  }

  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!question) {
    return res.status(400).json({ message: "question is required" });
  }

  try {
    const response = await requestMlAnalyst({
      question,
      userId,
      tenantId,
      correlationId: req.correlationId,
    });
    if (!response.ok) {
      return res.status(response.status).json(response.payload);
    }
    return res.status(200).json(response.payload);
  } catch (error) {
    console.error("[ai-analyst]", JSON.stringify({
      level: "error",
      event: "upstream_request_failed",
      correlationId: req.correlationId,
      errorType: error.name === "AbortError" ? "timeout" : "unavailable",
    }));
    return res.status(503).json({
      message: error.name === "AbortError" ? "AI Analyst timed out" : "AI Analyst unavailable",
    });
  }
};
