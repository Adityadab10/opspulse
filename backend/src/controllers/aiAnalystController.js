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
  if (question.length > 1000) return res.status(400).json({ message: "question must be 1000 characters or fewer" });
  const rawConversation = Array.isArray(req.body?.conversation) ? req.body.conversation : [];
  if (rawConversation.length > 8 || rawConversation.some((entry) => !entry || typeof entry.question !== "string" || typeof entry.answer !== "string" || entry.question.length > 1000 || entry.answer.length > 4000)) {
    return res.status(400).json({ message: "conversation must contain up to 8 question and answer pairs" });
  }

  try {
    const response = await requestMlAnalyst({
      question,
      conversation: rawConversation.map(({ question: priorQuestion, answer }) => ({ question: priorQuestion, answer })),
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
