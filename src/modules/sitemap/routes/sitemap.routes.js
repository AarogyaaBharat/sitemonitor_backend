const express = require("express");
const router = express.Router();
const { get_sitemaps, download_sitemap } = require("../controllers/sitemap.controller");
const { tenantConnectionMiddleware } = require("../../../common/middlewares/tenant.middleware");

// Proxy download (doesn't require tenant connection as it just fetches the URL directly)
router.get("/download", download_sitemap);

// Get sitemaps for domain
router.get("/", tenantConnectionMiddleware, get_sitemaps);

module.exports = router;
