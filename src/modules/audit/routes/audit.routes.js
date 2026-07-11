const express = require("express");
const { authMiddleware } = require("../../../common/middlewares/auth.middleware");
const {
  get_audit_summary,
  get_seo_audit,
  get_performance_audit,
  get_security_audit,
  get_broken_links_audit,
  get_search_performance,
} = require("../controllers/audit.controller");

const router = express.Router();

// All audit routes require authentication
router.use(authMiddleware);

router.get("/summary/:id", get_audit_summary);
router.get("/seo/:id", get_seo_audit);
router.get("/performance/:id", get_performance_audit);
router.get("/security/:id", get_security_audit);
router.get("/broken-links/:id", get_broken_links_audit);
router.get("/search-performance/:id", get_search_performance);

module.exports = router;
