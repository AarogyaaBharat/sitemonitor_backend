const { getTenantConnection } = require("../../config/mongooseTenant");

/**
 * Middleware to:
 * - Read tenant id from header: tenant_id
 * - Open/reuse tenant-specific Mongo connection via Mongoose
 * - Attach tenant info to req for downstream handlers
 *
 * Usage:
 *   app.use("/api", tenantConnectionMiddleware);
 *   // inside a route: req.tenantId, req.tenantConnection
 */
async function tenantConnectionMiddleware(req, res, next) {
  let tenantId = req.header("tenant_id");
  
  if (!tenantId && req.query.state && (req.path.includes("google/callback") || req.originalUrl.includes("google/callback"))) {
    try {
      const stateObj = JSON.parse(Buffer.from(req.query.state, "base64").toString("utf8"));
      tenantId = stateObj.tenantId;
    } catch (err) {
      console.error("Failed to parse tenantId from state query:", err);
    }
  }

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "tenant_id header is required",
    });
  }

  try {
    const connection = await getTenantConnection(tenantId);
    req.tenantId = tenantId;
    req.tenantConnection = connection;

    next();
  } catch (err) {
    if (err.code === "INVALID_TENANT") {
      // Known validation error: don't log full stack, just return custom message
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Account not found. Please try again.",
      });
    }

    if (err.code === "TENANT_NOT_CONFIGURED") {
      // Known configuration error: avoid noisy stack trace
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Tenant not found or not configured",
      });
    }

    // For unexpected errors, log details for debugging
    console.error("Failed to get tenant connection:", err);

    return res.status(500).json({
      success: false,
      status: 500,
      message: "Unable to connect to tenant database",
      error: process.env.NODE_ENV === "LOCAL" ? err.message : undefined,
    });
  }
}

module.exports = {
  tenantConnectionMiddleware,
};

