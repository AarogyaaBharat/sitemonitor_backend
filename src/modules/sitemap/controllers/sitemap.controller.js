const { get_sitemaps_service } = require("../services/sitemap.service");

/**
 * Get all sitemaps for a domain
 */
async function get_sitemaps(req, res) {
  try {
    const result = await get_sitemaps_service({
      tenantConnection: req.tenantConnection,
      query: req.query,
    });
    return res.status(result.statusCode).json(result);
  } catch (error) {
    console.error("Error in get_sitemaps controller:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * Proxy download for sitemap XML
 * GET /api/sitemap/download?url=...
 */
async function download_sitemap(req, res) {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ success: false, message: "URL is required" });
    }

    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      return res.status(response.status).json({ success: false, message: "Failed to fetch sitemap" });
    }

    const xmlData = await response.text();
    const filename = url.split("/").pop() || "sitemap.xml";

    const contentType = filename.endsWith(".txt") ? "text/plain" : "application/xml";
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", contentType);
    return res.send(xmlData);
  } catch (error) {
    console.error("Error downloading sitemap:", error);
    return res.status(500).json({ success: false, message: "Error downloading sitemap" });
  }
}

module.exports = {
  get_sitemaps,
  download_sitemap,
};
