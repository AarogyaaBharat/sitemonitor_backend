const { sitemapSchema } = require("../models/sitemap.schema");

const getSitemapModel = (connection) => {
  return connection.models.Sitemap || connection.model("Sitemap", sitemapSchema);
};

/**
 * Helper to fetch text from a URL
 */
async function fetchText(url) {
  try {
    const response = await fetch(url, { redirect: "follow", timeout: 10000 });
    if (!response.ok) return null;
    return await response.text();
  } catch (error) {
    return null;
  }
}

/**
 * Count <url> occurrences in XML string
 */
function countSitemapUrls(xmlText) {
  if (!xmlText) return 0;
  // A simple regex to count <url> tags which typically contain <loc>
  const matches = xmlText.match(/<loc[^>]*>.*?<\/loc>/gi);
  return matches ? matches.length : 0;
}

/**
 * Scan a domain for sitemaps (runs asynchronously)
 */
async function scan_sitemap_service(tenantConnection, domain) {
  try {
    const Sitemap = getSitemapModel(tenantConnection);
    const domainUrl = domain.dm_url.replace(/\/+$/, ""); // Ensure no trailing slash
    
    let sitemapUrls = [];

    // 1. Check robots.txt
    const robotsTxtUrl = `${domainUrl}/robots.txt`;
    const robotsTxt = await fetchText(robotsTxtUrl);
    
    // Save robots.txt record to the database
    await Sitemap.findOneAndUpdate(
      { domainId: domain._id, sitemapUrl: robotsTxtUrl },
      {
        domainId: domain._id,
        domainUrl,
        sitemapUrl: robotsTxtUrl,
        status: robotsTxt ? "success" : "failed",
        urlsCount: 0,
        lastScanned: new Date(),
      },
      { upsert: true, new: true }
    );

    if (robotsTxt) {
      const lines = robotsTxt.split(/\r?\n/);
      for (const line of lines) {
        if (line.toLowerCase().startsWith("sitemap:")) {
          const sUrl = line.substring(8).trim();
          if (sUrl) sitemapUrls.push(sUrl);
        }
      }
    }

    // 2. Fallback to default /sitemap.xml if none found
    if (sitemapUrls.length === 0) {
      sitemapUrls.push(`${domainUrl}/sitemap.xml`);
    }

    // De-duplicate URLs
    sitemapUrls = [...new Set(sitemapUrls)];

    // 3. Fetch each sitemap to verify and count URLs
    for (const sUrl of sitemapUrls) {
      const xmlText = await fetchText(sUrl);
      
      let status = "failed";
      let urlsCount = 0;
      
      if (xmlText && xmlText.includes("<?xml")) {
        status = "success";
        urlsCount = countSitemapUrls(xmlText);
      }

      // Upsert record
      await Sitemap.findOneAndUpdate(
        { domainId: domain._id, sitemapUrl: sUrl },
        {
          domainId: domain._id,
          domainUrl,
          sitemapUrl: sUrl,
          status,
          urlsCount,
          lastScanned: new Date(),
        },
        { upsert: true, new: true }
      );
    }
  } catch (err) {
    console.error("Error in scan_sitemap_service:", err);
  }
}

/**
 * Get sitemaps for a domain
 */
async function get_sitemaps_service({ tenantConnection, query }) {
  try {
    const Sitemap = getSitemapModel(tenantConnection);
    const { domainId } = query;

    if (!domainId) {
      return { success: false, statusCode: 400, message: "domainId is required" };
    }

    const sitemaps = await Sitemap.find({ domainId }).sort({ lastScanned: -1 });

    return {
      success: true,
      statusCode: 200,
      data: sitemaps,
    };
  } catch (err) {
    console.error("Error getting sitemaps:", err);
    return { success: false, statusCode: 500, message: "Server Error" };
  }
}

module.exports = {
  scan_sitemap_service,
  get_sitemaps_service,
};
