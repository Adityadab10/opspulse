import { randomUUID } from "node:crypto";
import { runWithRequestContext } from "../services/requestContext.js";

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const isValidCorrelationId = (value) =>
  typeof value === "string" && CORRELATION_ID_PATTERN.test(value);

export const correlationIdMiddleware = (req, res, next) => {
  const supplied = req.headers["x-correlation-id"];
  if (supplied !== undefined && !isValidCorrelationId(supplied)) {
    return res.status(400).json({ message: "Invalid correlation ID" });
  }

  const correlationId = supplied || randomUUID();
  req.correlationId = correlationId;
  res.setHeader("X-Correlation-ID", correlationId);

  return runWithRequestContext({ correlationId }, next);
};
