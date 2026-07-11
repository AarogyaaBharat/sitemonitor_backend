const {
  get_audit_summary_service,
  get_seo_audit_service,
  get_performance_audit_service,
  get_security_audit_service,
  get_broken_links_audit_service,
  get_search_performance_service,
} = require("../services/audit.service");

async function get_audit_summary(req, res) {
  try {
    const result = await get_audit_summary_service({
      tenantConnection: req.tenantConnection,
      params: req.params,
    });
    return res.status(result.statusCode).json(result);
  } catch (err) {
    console.error("get_audit_summary error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function get_seo_audit(req, res) {
  try {
    const result = await get_seo_audit_service({
      tenantConnection: req.tenantConnection,
      params: req.params,
    });
    return res.status(result.statusCode).json(result);
  } catch (err) {
    console.error("get_seo_audit error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function get_performance_audit(req, res) {
  try {
    const result = await get_performance_audit_service({
      tenantConnection: req.tenantConnection,
      params: req.params,
    });
    return res.status(result.statusCode).json(result);
  } catch (err) {
    console.error("get_performance_audit error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function get_security_audit(req, res) {
  try {
    const result = await get_security_audit_service({
      tenantConnection: req.tenantConnection,
      params: req.params,
    });
    return res.status(result.statusCode).json(result);
  } catch (err) {
    console.error("get_security_audit error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function get_broken_links_audit(req, res) {
  try {
    const result = await get_broken_links_audit_service({
      tenantConnection: req.tenantConnection,
      params: req.params,
    });
    return res.status(result.statusCode).json(result);
  } catch (err) {
    console.error("get_broken_links_audit error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function get_search_performance(req, res) {
  try {
    const result = await get_search_performance_service({
      tenantConnection: req.tenantConnection,
      params: req.params,
    });
    return res.status(result.statusCode).json(result);
  } catch (err) {
    console.error("get_search_performance error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

module.exports = {
  get_audit_summary,
  get_seo_audit,
  get_performance_audit,
  get_security_audit,
  get_broken_links_audit,
  get_search_performance,
};
