const mongoose = require("mongoose");

/**
 * Helper to get models from connection
 */
function getModels(connection) {
  const { domainSchema } = require("../../domain/models/domain.schema");
  const { domainSummarySchema } = require("../../domain/models/domainSummary.schema");
  const { domainReportSchema } = require("../../domain/models/domainReport.schema");
  const { searchPerformanceSchema } = require("../../performance/models/search_performance.schema");

  return {
    Domain: connection.models.Domain || connection.model("Domain", domainSchema, "domains"),
    DomainSummary: connection.models.DomainSummary || connection.model("DomainSummary", domainSummarySchema, "domain_summaries"),
    DomainReport: connection.models.DomainReport || connection.model("DomainReport", domainReportSchema, "domain_reports"),
    SearchPerformance: connection.models.SearchPerformance || connection.model("SearchPerformance", searchPerformanceSchema, "search_performances"),
  };
}

/**
 * Normalizes issue messages for consistent counting
 */
function normalizeIssueMessage(msg) {
  if (!msg) return "";
  return msg.toLowerCase()
    .replace(/\d+/g, "")
    .replace(/^fix\s+/i, "")
    .replace(/^review\s+/i, "")
    .replace(/\.$/, "")
    .replace(/s\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Get domain host from URL
 */
function getHostFromUrl(url) {
  if (!url) return "";
  return url.toLowerCase().trim()
    .replace(/^https?[:/\\]+/i, "")
    .replace(/[/\\]+.*$/, "");
}

/**
 * Get the latest jobId for a domain to ensure we only look at the most recent scan
 */
async function getLatestJobId(DomainSummary, DomainReport, host) {
  const summary = await DomainSummary.findOne({ domain: host }).sort({ lastScanDate: -1 }).lean();
  if (summary && summary.jobId) return summary.jobId;

  const latestReport = await DomainReport.findOne({ domain: host }).sort({ scanDate: -1 }).lean();
  return latestReport ? latestReport.jobId : null;
}

/**
 * GET Audit Summary
 */
async function get_audit_summary_service({ tenantConnection, params }) {
  const { id } = params;
  const { Domain, DomainSummary, DomainReport } = getModels(tenantConnection);

  let domainDoc = await Domain.findOne({ $or: [{ _id: mongoose.Types.ObjectId.isValid(id) ? id : null }, { dm_id: !isNaN(Number(id)) ? Number(id) : null }], dm_is_deleted: false }).lean();
  if (!domainDoc) return { statusCode: 404, success: false, message: "Domain not found" };

  const host = getHostFromUrl(domainDoc.dm_url);
  const summary = await DomainSummary.findOne({ domain: host }).sort({ lastScanDate: -1 }).lean();
  const jobId = await getLatestJobId(DomainSummary, DomainReport, host);

  if (!summary && !jobId) {
    return { statusCode: 200, success: true, data: null, message: "No scan data available" };
  }

  // Basic summary response
  return {
    statusCode: 200,
    success: true,
    data: {
      domain: domainDoc,
      summary,
      lastScanDate: summary ? summary.lastScanDate : domainDoc.dm_last_scan_at,
      jobId
    }
  };
}

/**
 * GET SEO Audit Data
 */
async function get_seo_audit_service({ tenantConnection, params }) {
  const { id } = params;
  const { Domain, DomainSummary, DomainReport } = getModels(tenantConnection);

  let domainDoc = await Domain.findOne({ $or: [{ _id: mongoose.Types.ObjectId.isValid(id) ? id : null }, { dm_id: !isNaN(Number(id)) ? Number(id) : null }], dm_is_deleted: false }).lean();
  if (!domainDoc) return { statusCode: 404, success: false, message: "Domain not found" };

  const host = getHostFromUrl(domainDoc.dm_url);
  const jobId = await getLatestJobId(DomainSummary, DomainReport, host);
  if (!jobId) return { statusCode: 200, success: true, data: { issues: [] }, message: "No scan data" };

  const reports = await DomainReport.find({ domain: host, jobId }).lean();
  
  const seoHealth = {
    'meta-title-missing': 0,
    'meta-description-missing': 0,
    'h1-tags-missing': 0,
    'no-canonical': 0,
    'multiple-h1-tags': 0,
    'meta-description-too-long': 0,
    'meta-description-too-short': 0,
    'missing-alt-text': 0,
  };

  for (const r of reports) {
    if (!r.meta?.title) seoHealth['meta-title-missing']++;
    if (!r.meta?.description) seoHealth['meta-description-missing']++;
    
    // Headings are numbers in this structure
    const h1Count = typeof r.headings?.h1 === 'number' ? r.headings.h1 : (Array.isArray(r.headings?.h1) ? r.headings.h1.length : 0);
    if (h1Count === 0) seoHealth['h1-tags-missing']++;
    if (h1Count > 1) seoHealth['multiple-h1-tags']++;
    
    if (!r.meta?.canonical) seoHealth['no-canonical']++;
    const descLen = (r.meta?.description || '').length;
    if (descLen > 155) seoHealth['meta-description-too-long']++;
    if (descLen > 0 && descLen < 30) seoHealth['meta-description-too-short']++;
    
    // Images alt count
    const imagesWithoutAlt = typeof r.images?.withoutAlt === 'number' ? r.images.withoutAlt : ((r.images?.list || []).filter(img => !img.alt || img.alt.trim() === '').length);
    seoHealth['missing-alt-text'] += imagesWithoutAlt;
  }

  return {
    statusCode: 200,
    success: true,
    data: {
      seoHealth,
      totalPages: reports.length,
      jobId
    }
  };
}

/**
 * GET Performance Audit
 */
async function get_performance_audit_service({ tenantConnection, params }) {
  const { id } = params;
  const { Domain, DomainSummary, DomainReport } = getModels(tenantConnection);

  let domainDoc = await Domain.findOne({ $or: [{ _id: mongoose.Types.ObjectId.isValid(id) ? id : null }, { dm_id: !isNaN(Number(id)) ? Number(id) : null }], dm_is_deleted: false }).lean();
  if (!domainDoc) return { statusCode: 404, success: false, message: "Domain not found" };

  const host = getHostFromUrl(domainDoc.dm_url);
  const jobId = await getLatestJobId(DomainSummary, DomainReport, host);
  if (!jobId) return { statusCode: 200, success: true, data: null };

  const reports = await DomainReport.find({ domain: host, jobId }).lean();
  
  const perfScores = reports.map(r => r.performance?.score || r.lighthousePerformanceScore || 0).filter(s => s > 0);
  const avgPerf = perfScores.length > 0 ? Math.round(perfScores.reduce((a, b) => a + b, 0) / perfScores.length) : 0;
  
  const lcpVals = reports.map(r => r.performance?.lcp || r.performance?.largestContentfulPaint || 0).filter(v => v > 0);
  const avgLCP = lcpVals.length > 0 ? (lcpVals.reduce((a, b) => a + b, 0) / lcpVals.length).toFixed(2) : 0;
  
  const inpVals = reports.map(r => r.performance?.inp || r.performance?.interactionToNextPaint || 0).filter(v => v > 0);
  const avgINP = inpVals.length > 0 ? Math.round(inpVals.reduce((a, b) => a + b, 0) / inpVals.length) : 0;

  return {
    statusCode: 200,
    success: true,
    data: {
      score: avgPerf,
      avgLCP: Number(avgLCP),
      avgINP,
      status: avgPerf >= 90 ? 'Good' : avgPerf >= 50 ? 'Needs Improvement' : 'Poor',
      jobId
    }
  };
}

/**
 * GET Security Audit
 */
async function get_security_audit_service({ tenantConnection, params }) {
  const { id } = params;
  const { Domain, DomainSummary, DomainReport } = getModels(tenantConnection);

  let domainDoc = await Domain.findOne({ $or: [{ _id: mongoose.Types.ObjectId.isValid(id) ? id : null }, { dm_id: !isNaN(Number(id)) ? Number(id) : null }], dm_is_deleted: false }).lean();
  if (!domainDoc) return { statusCode: 404, success: false, message: "Domain not found" };

  const host = getHostFromUrl(domainDoc.dm_url);
  const jobId = await getLatestJobId(DomainSummary, DomainReport, host);
  if (!jobId) return { statusCode: 200, success: true, data: null };

  const summary = await DomainSummary.findOne({ domain: host, jobId }).lean();
  const reports = await DomainReport.find({ domain: host, jobId }).limit(10).lean(); // Check a few pages for security headers

  return {
    statusCode: 200,
    success: true,
    data: {
      ssl: summary?.securitySummary?.sslValid ?? null,
      headers: reports[0]?.security?.headers || {},
      jobId
    }
  };
}

/**
 * GET Broken Links Audit
 */
async function get_broken_links_audit_service({ tenantConnection, params }) {
  const { id } = params;
  const { Domain, DomainSummary, DomainReport } = getModels(tenantConnection);

  let domainDoc = await Domain.findOne({ $or: [{ _id: mongoose.Types.ObjectId.isValid(id) ? id : null }, { dm_id: !isNaN(Number(id)) ? Number(id) : null }], dm_is_deleted: false }).lean();
  if (!domainDoc) return { statusCode: 404, success: false, message: "Domain not found" };

  const host = getHostFromUrl(domainDoc.dm_url);
  const jobId = await getLatestJobId(DomainSummary, DomainReport, host);
  if (!jobId) return { statusCode: 200, success: true, data: { total: 0, broken: [] } };

  const reports = await DomainReport.find({ 
    domain: host, 
    jobId, 
    $or: [
      { 'brokenLinks.0': { $exists: true } },
      { 'broken_links.0': { $exists: true } },
      { 'links.broken': { $gt: 0 } },
      { 'links.brokenDetails.0': { $exists: true } },
      { 'seoImprovements': { $elemMatch: { type: 'broken-links' } } }
    ]
  }).lean();

  const brokenLinksMap = [];
  for (const r of reports) {
    const broken = r.brokenLinks || r.broken_links || r.links?.brokenDetails || (Array.isArray(r.links?.broken) ? r.links.broken : []);
    const count = Array.isArray(broken) ? broken.length : (typeof r.links?.broken === 'number' ? r.links.broken : 0);
    
    if (count > 0) {
      brokenLinksMap.push({
        url: r.url,
        count: count,
        links: Array.isArray(broken) ? broken : []
      });
    }
  }

  return {
    statusCode: 200,
    success: true,
    data: {
      total: brokenLinksMap.reduce((acc, curr) => acc + curr.count, 0),
      pages: brokenLinksMap.length,
      details: brokenLinksMap,
      jobId
    }
  };
}

async function get_search_performance_service({ tenantConnection, params }) {
  const { id: domainId } = params;

  const { SearchPerformance, Domain } = getModels(tenantConnection);
  
  let domainDoc = await Domain.findOne({ 
    $or: [
      { _id: mongoose.Types.ObjectId.isValid(domainId) ? domainId : null }, 
      { dm_id: !isNaN(Number(domainId)) ? Number(domainId) : null }
    ], 
    dm_is_deleted: false 
  }).lean();

  if (!domainDoc) {
    return { statusCode: 404, success: false, message: "Domain not found" };
  }

  // Find the latest search performance report for this domain
  const report = await SearchPerformance.findOne({ domainId: domainDoc._id }).sort({ scanDate: -1 }).lean();

  if (!report) {
    // Check if the user has connected their Google account at all
    const mongoose = require("mongoose");
    const { googleConnectionSchema } = require("../../auth/models/google_connection.schema");
    const GoogleConnection = tenantConnection.models.GoogleConnection || tenantConnection.model("GoogleConnection", googleConnectionSchema, "google_connections");
    
    let googleConnection = null;
    if (domainDoc.dm_user_id) {
      const connQuery = { user_id: new mongoose.Types.ObjectId(domainDoc.dm_user_id) };
      if (domainDoc.dm_gsc_email) {
        connQuery.google_email = domainDoc.dm_gsc_email;
      }
      googleConnection = await GoogleConnection.findOne(connQuery).lean();
    }
    
    if (!googleConnection) {
      return {
        statusCode: 404,
        success: false,
        errorType: "NO_CONNECTION",
        message: "No Google account connected. Please connect your Google account.",
      };
    }

    return {
      statusCode: 404,
      success: false,
      errorType: "UNVERIFIED_SITE",
      googleEmail: googleConnection.google_email,
      message: `Google account connected (${googleConnection.google_email}), but we could not access Google Search Console data for ${domainDoc.dm_url}. Please ensure this domain is verified in your Google Search Console account.`,
    };
  }

  return {
    statusCode: 200,
    success: true,
    data: {
      summaryMetrics: report.summaryMetrics,
      topKeywords: report.topKeywords,
      topPages: report.topPages,
      devicePerformance: report.devicePerformance,
      countryPerformance: report.countryPerformance,
      indexStatus: report.indexStatus,
      chartData: report.chartData,
      scanDate: report.scanDate
    },
  };
}

module.exports = {
  get_audit_summary_service,
  get_seo_audit_service,
  get_performance_audit_service,
  get_security_audit_service,
  get_broken_links_audit_service,
  get_search_performance_service,
};
