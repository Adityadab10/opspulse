import { getMlAnalystConfig } from "../services/mlAnalystClient.js";

export const requireMlServiceToken = (req, res, next) => {
  if (!getMlAnalystConfig().internalToken) {
    return res.status(503).json({ message: "ML service authorization is not configured" });
  }
  return next();
};
