export const sendBackendError = (res, message, error) => {
  if (error?.code === "TENANT_SCHEMA_UNAVAILABLE") {
    return res.status(503).json({
      message: "Tenant isolation schema is unavailable",
      error: "Migration 005 must be applied before tenant-scoped data access is enabled",
    });
  }

  if (error?.code === "MISSING_TENANT_CONTEXT") {
    return res.status(401).json({ message: "Trusted tenant context is required" });
  }

  if (
    error?.code === "MISSING_INTERNAL_TOKEN"
    || (error?.code === "ML_SERVICE_REJECTED" && [401, 403].includes(error.status))
  ) {
    return res.status(503).json({
      message: "ML service authorization failed",
      error: "Upstream service authorization failed",
    });
  }

  return res.status(500).json({
    message,
    error: "Internal server error",
  });
};
