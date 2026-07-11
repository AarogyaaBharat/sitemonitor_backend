const mongoose = require("mongoose");
const { domainSchema } = require("../models/domain.schema");
const { domainSummarySchema } = require("../models/domainSummary.schema");
const { domainReportSchema } = require("../models/domainReport.schema");
const { userSchema } = require("../../user/models/user.model");
const { scan_sitemap_service } = require("../../sitemap/services/sitemap.service");

function getUserModel(connection) {
  return (
    connection.models.User ||
    connection.model("User", userSchema, "users")
  );
}

function getDomainModel(connection) {
  return (
    connection.models.Domain ||
    connection.model("Domain", domainSchema, "domains")
  );
}

function getDomainSummaryModel(connection) {
  return (
    connection.models.DomainSummary ||
    connection.model("DomainSummary", domainSummarySchema, "domain_summaries")
  );
}

function getDomainReportModel(connection) {
  return (
    connection.models.DomainReport ||
    connection.model("DomainReport", domainReportSchema, "domain_reports")
  );
}

function getAuditModel(connection) {
  const { auditSchema } = require("../../audit/models/audit.schema");
  return (
    connection.models.Audit ||
    connection.model("Audit", auditSchema, "domain_audits")
  );
}

/**
 * Calculates the next scan date based on frequency, type, and time.
 */
function calculateNextScanAt(frequency, type, time, fromDate = new Date()) {
  const next = new Date(fromDate);
  const freq = parseInt(frequency) || 1;

  switch (type) {
    case 'day':
      next.setDate(next.getDate() + freq);
      break;
    case 'week':
      next.setDate(next.getDate() + (freq * 7));
      break;
    case 'month':
      next.setMonth(next.getMonth() + freq);
      break;
    case 'quarter':
      next.setMonth(next.getMonth() + (freq * 3));
      break;
    default:
      next.setDate(next.getDate() + freq);
  }

  if (time) {
    const [hours, minutes] = time.split(':').map(Number);
    if (!isNaN(hours)) next.setHours(hours, minutes || 0, 0, 0);
  }

  return next;
}

/**
 * Create a new domain
 */
async function create_domain_service({ tenantConnection, body, user, tenantId }) {
  const Domain = getDomainModel(tenantConnection);
  const User = getUserModel(tenantConnection);

  // Fetch the logged-in user's MongoDB _id
  const loginUser = await User.findOne({ user_id: user?.user_id, user_is_deleted: false });
  if (!loginUser) {
    return {
      statusCode: 404,
      success: false,
      message: "Logged-in user not found in this tenant",
    };
  }

  const {
    dm_title,
    dm_url,
    dm_crawl_auto,
    dm_connections_per_min,
    dm_max_scanned_pages,
    dm_scan_subdomains,
    dm_spelling_ignore_caps,
    dm_case_sensitive_urls,
    dm_render_pages_execute_js,
    dm_mark_403_as_broken,
    dm_ignore_canonical_urls,
    dm_use_language_attribute,
    dm_custom_urls,
    dm_path_constraints,
    dm_exclude_patterns,
    dm_internal_urls,
    dm_accessibility,
    dm_source_code_excludes,
    dm_readability,
    dm_scan_frequency,
    dm_frequency_type,
    dm_ignored_spellings,
    dm_terms_conditions,
  } = body || {};

  let hostNorm = "";
  try {
    const mainUrl = dm_url.trim().toLowerCase();
    const mainUrlWithProto = mainUrl.startsWith("http") ? mainUrl : `https://${mainUrl}`;
    const parsed = new URL(mainUrlWithProto);
    hostNorm = parsed.hostname.replace(/^www\./, "");
  } catch (err) {
    // fallback
  }

  let validatedCustomUrls = [];
  if (Array.isArray(dm_custom_urls) && dm_custom_urls.length > 0) {
    if (dm_custom_urls.length > 10) {
      return {
        statusCode: 400,
        success: false,
        message: "You can specify a maximum of 10 custom URLs",
      };
    }
    for (let u of dm_custom_urls) {
      if (typeof u !== "string" || !u.trim()) continue;
      const trimmedUrl = u.trim();
      try {
        const parsedUrl = new URL(trimmedUrl);
        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
          return {
            statusCode: 400,
            success: false,
            message: `Custom URL "${trimmedUrl}" must start with http:// or https://`,
          };
        }
        const customHost = parsedUrl.hostname.replace(/^www\./, "").toLowerCase();
        if (hostNorm && customHost !== hostNorm && !customHost.endsWith("." + hostNorm)) {
          return {
            statusCode: 400,
            success: false,
            message: `Custom URL "${trimmedUrl}" does not match the domain ${hostNorm}`,
          };
        }
        validatedCustomUrls.push(trimmedUrl);
      } catch (err) {
        return {
          statusCode: 400,
          success: false,
          message: `Invalid custom URL: "${trimmedUrl}"`,
        };
      }
    }
  }

  // Check if domain URL already exists
  const existingDomain = await Domain.findOne({
    dm_url: dm_url?.toLowerCase().trim(),
    dm_is_deleted: false,
  });

  if (existingDomain) {
    return {
      statusCode: 409,
      success: false,
      message: "Domain URL already exists",
    };
  }

  const domain = new Domain({
    dm_user_id: loginUser._id,
    dm_title,
    dm_url: dm_url?.toLowerCase().trim(),
    dm_crawl_auto: dm_crawl_auto ?? false,
    dm_connections_per_min: dm_connections_per_min || "normal",
    dm_max_scanned_pages: dm_max_scanned_pages || 0,
    dm_scan_subdomains: dm_scan_subdomains ?? true,
    dm_spelling_ignore_caps: dm_spelling_ignore_caps ?? false,
    dm_case_sensitive_urls: dm_case_sensitive_urls ?? true,
    dm_render_pages_execute_js: dm_render_pages_execute_js ?? false,
    dm_mark_403_as_broken: dm_mark_403_as_broken ?? false,
    dm_ignore_canonical_urls: dm_ignore_canonical_urls ?? false,
    dm_use_language_attribute: dm_use_language_attribute ?? true,
    dm_custom_urls: validatedCustomUrls,
    dm_path_constraints: dm_path_constraints || [],
    dm_exclude_patterns: dm_exclude_patterns || [],
    dm_internal_urls: dm_internal_urls || [],
    dm_accessibility: dm_accessibility || "none",
    dm_source_code_excludes: dm_source_code_excludes || "",
    dm_readability: dm_readability || "none",
    dm_scan_frequency: dm_scan_frequency || 1,
    dm_frequency_type: dm_frequency_type || "day",
    dm_scan_time: "00:00",
    dm_next_scan_at: calculateNextScanAt(dm_scan_frequency || 1, dm_frequency_type || "day", "00:00"),
    dm_ignored_spellings: dm_ignored_spellings || [],
    dm_terms_conditions: dm_terms_conditions || [],
    dm_status: "active",
    dm_created_by: loginUser._id,
  });

  const saved = await domain.save();

  // Log activity
  try {
    await global.createActivityLog(tenantConnection, {
      userId: loginUser?._id,
      userName: `${loginUser?.user_first_name || ""} ${loginUser?.user_last_name || ""}`.trim() || user?.user_email,
      action: "CREATE_DOMAIN",
      details: `Domain '${saved.dm_title}' (${saved.dm_url}) was added by ${loginUser?.user_first_name || user?.user_email || "User"}.`,
      metadata: { domainId: saved._id, domainUrl: saved.dm_url }
    });
  } catch (logErr) {
    console.error("Failed to log activity:", logErr);
  }

  return {
    statusCode: 201,
    success: true,
    message: "Domain created successfully",
    data: saved,
  };
}

/**
 * Get domain list (with filtering)
 */
async function get_domain_list_service({ tenantConnection, query, tenantId }) {
  const Domain = getDomainModel(tenantConnection);

  const { page = 1, limit = 10, dm_status, dm_user_id, search, is_archived } = query || {};
  const skip = (page - 1) * limit;

  const filter = {
    dm_is_deleted: false,
    dm_is_archived: is_archived === "true",
  };

  if (dm_status) filter.dm_status = dm_status;
  if (dm_user_id) filter.dm_user_id = dm_user_id;

  if (search) {
    filter.$or = [
      { dm_title: { $regex: search, $options: "i" } },
      { dm_url: { $regex: search, $options: "i" } },
    ];
  }

  const [domains, total] = await Promise.all([
    Domain.find(filter)
      .sort({ dm_created_at: -1 })
      .limit(Number(limit))
      .skip(skip),
    Domain.countDocuments(filter),
  ]);

  return {
    statusCode: 200,
    success: true,
    message: "Domain list retrieved successfully",
    data: {
      domains,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    },
  };
}

/**
 * Get domain by ID
 */
async function get_domain_by_id_service({ tenantConnection, params }) {
  const Domain = getDomainModel(tenantConnection);
  const { id } = params;

  let domain;
  if (mongoose.Types.ObjectId.isValid(id)) {
    domain = await Domain.findOne({ _id: id, dm_is_deleted: false });
  }
  
  if (!domain && !isNaN(Number(id))) {
    domain = await Domain.findOne({ dm_id: Number(id), dm_is_deleted: false });
  }

  if (!domain) {
    return {
      statusCode: 404,
      success: false,
      message: "Domain not found",
    };
  }

  return {
    statusCode: 200,
    success: true,
    message: "Domain retrieved successfully",
    data: domain,
  };
}

/**
 * Update domain
 */
async function update_domain_service({ tenantConnection, params, body, user, tenantId }) {
  const Domain = getDomainModel(tenantConnection);
  const User = getUserModel(tenantConnection);
  const { id } = params;

  // Fetch the logged-in user's MongoDB _id for audit
  const loginUser = await User.findOne({ user_id: user?.user_id, user_is_deleted: false });

  const existing = await Domain.findOne({ dm_id: Number(id), dm_is_deleted: false });
  if (!existing) {
    return {
      statusCode: 404,
      success: false,
      message: "Domain not found",
    };
  }

  const {
    dm_title,
    dm_url,
    dm_crawl_auto,
    dm_connections_per_min,
    dm_max_scanned_pages,
    dm_scan_subdomains,
    dm_spelling_ignore_caps,
    dm_case_sensitive_urls,
    dm_render_pages_execute_js,
    dm_mark_403_as_broken,
    dm_ignore_canonical_urls,
    dm_use_language_attribute,
    dm_custom_urls,
    dm_path_constraints,
    dm_exclude_patterns,
    dm_internal_urls,
    dm_accessibility,
    dm_source_code_excludes,
    dm_readability,
    dm_scan_frequency,
    dm_frequency_type,
    dm_status,
    dm_ignored_spellings,
    dm_terms_conditions,
  } = body || {};

  let hostNorm = "";
  try {
    const mainUrl = (dm_url || existing.dm_url).trim().toLowerCase();
    const mainUrlWithProto = mainUrl.startsWith("http") ? mainUrl : `https://${mainUrl}`;
    const parsed = new URL(mainUrlWithProto);
    hostNorm = parsed.hostname.replace(/^www\./, "");
  } catch (err) {
    // fallback
  }

  let validatedCustomUrls = null;
  if (dm_custom_urls != null) {
    validatedCustomUrls = [];
    if (Array.isArray(dm_custom_urls) && dm_custom_urls.length > 0) {
      if (dm_custom_urls.length > 10) {
        return {
          statusCode: 400,
          success: false,
          message: "You can specify a maximum of 10 custom URLs",
        };
      }
      for (let u of dm_custom_urls) {
        if (typeof u !== "string" || !u.trim()) continue;
        const trimmedUrl = u.trim();
        try {
          const parsedUrl = new URL(trimmedUrl);
          if (!["http:", "https:"].includes(parsedUrl.protocol)) {
            return {
              statusCode: 400,
              success: false,
              message: `Custom URL "${trimmedUrl}" must start with http:// or https://`,
            };
          }
          const customHost = parsedUrl.hostname.replace(/^www\./, "").toLowerCase();
          if (hostNorm && customHost !== hostNorm && !customHost.endsWith("." + hostNorm)) {
            return {
              statusCode: 400,
              success: false,
              message: `Custom URL "${trimmedUrl}" does not match the domain ${hostNorm}`,
            };
          }
          validatedCustomUrls.push(trimmedUrl);
        } catch (err) {
          return {
            statusCode: 400,
            success: false,
            message: `Invalid custom URL: "${trimmedUrl}"`,
          };
        }
      }
    }
  }

  const update = {};
  if (dm_title != null) update.dm_title = dm_title;
  if (dm_url != null) update.dm_url = dm_url.toLowerCase().trim();
  if (dm_crawl_auto != null) update.dm_crawl_auto = dm_crawl_auto;
  if (dm_connections_per_min != null) update.dm_connections_per_min = dm_connections_per_min;
  if (dm_max_scanned_pages != null) update.dm_max_scanned_pages = dm_max_scanned_pages;
  if (dm_scan_subdomains != null) update.dm_scan_subdomains = dm_scan_subdomains;
  if (dm_spelling_ignore_caps != null) update.dm_spelling_ignore_caps = dm_spelling_ignore_caps;
  if (dm_case_sensitive_urls != null) update.dm_case_sensitive_urls = dm_case_sensitive_urls;
  if (dm_render_pages_execute_js != null) update.dm_render_pages_execute_js = dm_render_pages_execute_js;
  if (dm_mark_403_as_broken != null) update.dm_mark_403_as_broken = dm_mark_403_as_broken;
  if (dm_ignore_canonical_urls != null) update.dm_ignore_canonical_urls = dm_ignore_canonical_urls;
  if (dm_use_language_attribute != null) update.dm_use_language_attribute = dm_use_language_attribute;
  if (validatedCustomUrls != null) update.dm_custom_urls = validatedCustomUrls;
  if (dm_path_constraints != null) update.dm_path_constraints = dm_path_constraints;
  if (dm_exclude_patterns != null) update.dm_exclude_patterns = dm_exclude_patterns;
  if (dm_internal_urls != null) update.dm_internal_urls = dm_internal_urls;
  if (dm_accessibility != null) update.dm_accessibility = dm_accessibility;
  if (dm_source_code_excludes != null) update.dm_source_code_excludes = dm_source_code_excludes;
  if (dm_readability != null) update.dm_readability = dm_readability;
  if (dm_scan_frequency != null) update.dm_scan_frequency = dm_scan_frequency;
  if (dm_frequency_type != null) update.dm_frequency_type = dm_frequency_type;
  update.dm_scan_time = "00:00";
  
  // Recalculate next scan if frequency changes
  if (dm_scan_frequency != null || dm_frequency_type != null) {
      const newFreq = dm_scan_frequency ?? existing.dm_scan_frequency;
      const newType = dm_frequency_type ?? existing.dm_frequency_type;
      update.dm_next_scan_at = calculateNextScanAt(newFreq, newType, "00:00", existing.dm_last_scan_at || new Date());
  }

  if (dm_status != null) update.dm_status = dm_status;
  if (dm_ignored_spellings != null) update.dm_ignored_spellings = dm_ignored_spellings;
  if (dm_terms_conditions != null) update.dm_terms_conditions = dm_terms_conditions;

  update.dm_updated_at = new Date();
  update.dm_updated_by = loginUser?._id || null;

  const domain = await Domain.findOneAndUpdate(
    { dm_id: Number(id), dm_is_deleted: false },
    { $set: update },
    { new: true }
  );

  if (!domain) {
    return {
      statusCode: 404,
      success: false,
      message: "Domain not found",
    };
  }

  // Log activity
  try {
    await global.createActivityLog(tenantConnection, {
      userId: loginUser?._id,
      userName: `${loginUser?.user_first_name || ""} ${loginUser?.user_last_name || ""}`.trim() || user?.user_email,
      action: "UPDATE_DOMAIN",
      details: `Domain '${domain.dm_title}' (${domain.dm_url}) settings were updated by ${loginUser?.user_first_name || user?.user_email || "User"}.`,
      metadata: { domainId: domain._id, domainUrl: domain.dm_url }
    });
  } catch (logErr) {
    console.error("Failed to log activity:", logErr);
  }

  return {
    statusCode: 200,
    success: true,
    message: "Domain updated successfully",
    data: domain,
  };
}

/**
 * Delete domain (soft delete)
 */
async function delete_domain_service({ tenantConnection, params, user }) {
  const Domain = getDomainModel(tenantConnection);
  const User = getUserModel(tenantConnection);
  const { id } = params;

  // Fetch the logged-in user's MongoDB _id for audit
  const loginUser = await User.findOne({ user_id: user?.user_id, user_is_deleted: false });

  const domain = await Domain.findOneAndUpdate(
    { dm_id: Number(id), dm_is_deleted: false },
    {
      $set: {
        dm_is_deleted: true,
        dm_deleted_at: new Date(),
        dm_deleted_by: loginUser?._id || null,
      },
    },
    { new: true }
  );

  if (!domain) {
    return {
      statusCode: 404,
      success: false,
      message: "Domain not found",
    };
  }

  // Log activity
  try {
    await global.createActivityLog(tenantConnection, {
      userId: loginUser?._id,
      userName: `${loginUser?.user_first_name || ""} ${loginUser?.user_last_name || ""}`.trim() || user?.user_email,
      action: "DELETE_DOMAIN",
      details: `Domain '${domain.dm_title}' (${domain.dm_url}) was deleted by ${loginUser?.user_first_name || user?.user_email || "User"}.`,
      metadata: { domainId: domain._id, domainUrl: domain.dm_url }
    });
  } catch (logErr) {
    console.error("Failed to log activity:", logErr);
  }

  return {
    statusCode: 200,
    success: true,
    message: "Domain deleted successfully",
  };
}

/**
 * Archive domain
 */
async function archive_domain_service({ tenantConnection, params, user }) {
  const Domain = getDomainModel(tenantConnection);
  const { id } = params;

  const domain = await Domain.findOneAndUpdate(
    { dm_id: Number(id), dm_is_deleted: false },
    { $set: { dm_is_archived: true } },
    { new: true }
  );

  if (!domain) {
    return {
      statusCode: 404,
      success: false,
      message: "Domain not found",
    };
  }

  // Log activity
  try {
    const User = getUserModel(tenantConnection);
    const loginUser = await User.findOne({ user_id: user?.user_id, user_is_deleted: false });
    await global.createActivityLog(tenantConnection, {
      userId: loginUser?._id,
      userName: `${loginUser?.user_first_name || ""} ${loginUser?.user_last_name || ""}`.trim() || user?.user_email,
      action: "ARCHIVE_DOMAIN",
      details: `Domain '${domain.dm_title}' (${domain.dm_url}) was archived by ${loginUser?.user_first_name || user?.user_email || "User"}.`,
      metadata: { domainId: domain._id, domainUrl: domain.dm_url }
    });
  } catch (logErr) {
    console.error("Failed to log activity:", logErr);
  }

  return {
    statusCode: 200,
    success: true,
    message: "Domain archived successfully",
  };
}

/**
 * Restore domain
 */
async function restore_domain_service({ tenantConnection, params, user }) {
  const Domain = getDomainModel(tenantConnection);
  const { id } = params;

  const domain = await Domain.findOneAndUpdate(
    { dm_id: Number(id), dm_is_deleted: false },
    { $set: { dm_is_archived: false } },
    { new: true }
  );

  if (!domain) {
    return {
      statusCode: 404,
      success: false,
      message: "Domain not found",
    };
  }

  // Log activity
  try {
    const User = getUserModel(tenantConnection);
    const loginUser = await User.findOne({ user_id: user?.user_id, user_is_deleted: false });
    await global.createActivityLog(tenantConnection, {
      userId: loginUser?._id,
      userName: `${loginUser?.user_first_name || ""} ${loginUser?.user_last_name || ""}`.trim() || user?.user_email,
      action: "RESTORE_DOMAIN",
      details: `Domain '${domain.dm_title}' (${domain.dm_url}) was restored by ${loginUser?.user_first_name || user?.user_email || "User"}.`,
      metadata: { domainId: domain._id, domainUrl: domain.dm_url }
    });
  } catch (logErr) {
    console.error("Failed to log activity:", logErr);
  }

  return {
    statusCode: 200,
    success: true,
    message: "Domain restored successfully",
  };
}

/**
 * Hard delete domain
 */
async function hard_delete_domain_service({ tenantConnection, params, user }) {
  const Domain = getDomainModel(tenantConnection);
  const { id } = params;

  const domain = await Domain.findOneAndDelete({ dm_id: Number(id) });

  if (!domain) {
    return {
      statusCode: 404,
      success: false,
      message: "Domain not found",
    };
  }

  // Log activity
  try {
    const User = getUserModel(tenantConnection);
    const loginUser = await User.findOne({ user_id: user?.user_id, user_is_deleted: false });
    await global.createActivityLog(tenantConnection, {
      userId: loginUser?._id,
      userName: `${loginUser?.user_first_name || ""} ${loginUser?.user_last_name || ""}`.trim() || user?.user_email,
      action: "HARD_DELETE_DOMAIN",
      details: `Domain '${domain.dm_title}' (${domain.dm_url}) was permanently deleted by ${loginUser?.user_first_name || user?.user_email || "User"}.`,
      metadata: { domainId: domain._id, domainUrl: domain.dm_url }
    });
  } catch (logErr) {
    console.error("Failed to log activity:", logErr);
  }

  return {
    statusCode: 200,
    success: true,
    message: "Domain permanently deleted",
  };
}

/**
 * Get domain scan history (summaries)
 */
async function get_domain_scan_history_service({ tenantConnection, params }) {
  const { id } = params;
  const Domain = getDomainModel(tenantConnection);
  const DomainSummary = getDomainSummaryModel(tenantConnection);

  let domainDoc;
  if (mongoose.Types.ObjectId.isValid(id)) {
    domainDoc = await Domain.findOne({ _id: id, dm_is_deleted: false });
  }
  
  if (!domainDoc && !isNaN(Number(id))) {
    domainDoc = await Domain.findOne({ dm_id: Number(id), dm_is_deleted: false });
  }

  if (!domainDoc) {
    return { statusCode: 404, success: false, message: "Domain not found" };
  }

  const host = domainDoc.dm_url.toLowerCase().trim().replace(/^https?[:/\\]+/i, '').replace(/[/\\]+.*$/, '');
  const summaries = await DomainSummary.find({ domain: host })
    .sort({ lastScanDate: -1 })
    .limit(30);

  return {
    statusCode: 200,
    success: true,
    message: "Domain scan history retrieved",
    data: summaries,
  };
}

/**
 * Get latest domain summary
 */
async function get_latest_domain_summary_service({ tenantConnection, params }) {
  const { id } = params;
  const Domain = getDomainModel(tenantConnection);
  const DomainSummary = getDomainSummaryModel(tenantConnection);

  let domainDoc;
  if (mongoose.Types.ObjectId.isValid(id)) {
    domainDoc = await Domain.findOne({ _id: id, dm_is_deleted: false });
  }
  
  if (!domainDoc && !isNaN(Number(id))) {
    domainDoc = await Domain.findOne({ dm_id: Number(id), dm_is_deleted: false });
  }

  if (!domainDoc) {
    return { statusCode: 404, success: false, message: "Domain not found" };
  }

  const host = domainDoc.dm_url.toLowerCase().trim().replace(/^https?[:/\\]+/i, '').replace(/[/\\]+.*$/, '');
  const latest = await DomainSummary.findOne({ domain: host })
    .sort({ lastScanDate: -1 })
    .lean();

  if (latest && latest.topIssues && latest.topIssues.length > 0) {
    const DomainReport = getDomainReportModel(tenantConnection);
    
    let filter = { domain: host };
    if (latest.jobId) {
      filter.jobId = latest.jobId;
    } else {
      const latestReport = await DomainReport.findOne({ domain: host }).sort({ scanDate: -1 });
      if (latestReport && latestReport.jobId) {
        filter.jobId = latestReport.jobId;
      }
    }

    const reports = await DomainReport.find(filter).lean();
    const normalize = s => (s || "").toLowerCase()
      .replace(/^fix\s+/i, '')
      .replace(/^review\s+/i, '')
      .replace(/\(\d+(\.\d+)?s?\)/g, '(...)') // Handle (6.15s) -> (...)
      .replace(/\d+\s+key\s+legal\s+terms/i, 'key legal terms')
      .replace(/\d+\s+image\(s\)/i, 'images')
      .replace(/\d+\s+spelling\s+issues/i, 'spelling issues')
      .replace(/\d+\s+broken\s+links/i, 'broken links')
      .replace(/\d+\s+large\s+images/i, 'large images')
      .replace(/>\d+KB/i, '>KB')
      .replace(/\bcls\b/gi, 'cls_safe')
      .replace(/\.$/, '')
      .replace(/s\b/g, '')
      .replace(/cls_safe/g, 'cls')
      .replace(/\s+/g, ' ')
      .trim();

    latest.topIssues = latest.topIssues.map(issue => {
      const lowerIssue = (issue.message || "").toLowerCase();
      const normalizedIssue = normalize(lowerIssue);
      
      const isCountableIssue = normalizedIssue.includes('spelling') || 
                               normalizedIssue.includes('misspell') || 
                               normalizedIssue.includes('typo') || 
                               normalizedIssue.includes('broken link') || 
                               normalizedIssue.includes('404') || 
                               normalizedIssue.includes('broken image');

      if (!isCountableIssue) {
        return issue;
      }
      
      let totalIssuesFound = 0;

      for (const r of reports) {
        const target = (r.seoImprovements || []).find(imp => {
          const m = (imp.message || "").toLowerCase();
          const nm = normalize(m);
          if (m === lowerIssue || nm === normalizedIssue || m.includes(normalizedIssue) || lowerIssue.includes(nm)) return true;
          
          if (normalizedIssue.includes('spelling') || normalizedIssue.includes('misspell') || normalizedIssue.includes('typo')) {
             if (nm.includes('spelling') || nm.includes('misspell') || nm.includes('typo') || imp.type === 'spelling') return true;
          }
          if (normalizedIssue.includes('broken link') || normalizedIssue.includes('404')) {
             if (nm.includes('broken link') || nm.includes('404') || imp.type === 'broken-links') return true;
          }
          if (normalizedIssue.includes('broken image')) {
             if (nm.includes('broken image') || imp.type === 'broken-images') return true;
          }
          return false;
        });

        let count = target ? (target.count || 0) : 0;
        
        if (count <= 1 && target && target.message) {
          const match = target.message.match(/(\d+)/);
          if (match) count = parseInt(match[1]);
        }
        if (count <= 1 && target && target.details && Array.isArray(target.details)) {
          count = target.details.length || count;
        }

        if (count <= 1) {
          if (normalizedIssue.includes('spelling') || normalizedIssue.includes('misspelling')) {
            count = (r.misspellings || r.textMetrics?.misspellings || r.spelling_mistakes || []).length || count;
          } else if (normalizedIssue.includes('broken link')) {
            count = (r.brokenLinks || r.broken_links || (r.links && r.links.broken) || []).length || count;
          } else if (normalizedIssue.includes('broken image')) {
            count = (r.brokenImages || r.broken_images || (r.images && r.images.broken) || []).length || count;
          }
        }
        
        if (count > 0) {
           totalIssuesFound += count;
        }
      }

      let updatedMessage = issue.message;
      if (totalIssuesFound > 0) {
        // Replace the number in the original message with the actual sum
        updatedMessage = updatedMessage.replace(/\d+/, totalIssuesFound.toString());
      }

      let affectedPagesCount = 0;
      for (const r of reports) {
        const hasIssue = (r.seoImprovements || []).some(imp => {
          const m = (imp.message || "").toLowerCase();
          const nm = normalize(m);
          if (m === lowerIssue || nm === normalizedIssue || m.includes(normalizedIssue) || lowerIssue.includes(nm)) return true;
          
          if (normalizedIssue.includes('spelling') || normalizedIssue.includes('misspell') || normalizedIssue.includes('typo')) {
             if (nm.includes('spelling') || nm.includes('misspell') || nm.includes('typo') || imp.type === 'spelling') return true;
          }
          if (normalizedIssue.includes('broken link') || normalizedIssue.includes('404')) {
             if (nm.includes('broken link') || nm.includes('404') || imp.type === 'broken-links') return true;
          }
          if (normalizedIssue.includes('broken image')) {
             if (nm.includes('broken image') || imp.type === 'broken-images') return true;
          }
          return false;
        });
        if (hasIssue) affectedPagesCount++;
      }

      return {
        ...issue,
        message: updatedMessage,
        count: affectedPagesCount > 0 ? affectedPagesCount : issue.count
      };
    });
  }

  return {
    statusCode: 200,
    success: true,
    message: "Latest domain summary retrieved",
    data: latest || null,
  };
}

/**
 * Get detailed SEO pages for a domain
 */
async function get_domain_seo_pages_service({ tenantConnection, params, query }) {
  const { id } = params;
  const { page = 1, limit = 10, search = '', issue = '' } = query || {};
  const skip = (Math.max(1, Number(page)) - 1) * Number(limit);

  const Domain = getDomainModel(tenantConnection);
  const DomainReport = getDomainReportModel(tenantConnection);

  let domainDoc;
  if (mongoose.Types.ObjectId.isValid(id)) {
    domainDoc = await Domain.findOne({ _id: id, dm_is_deleted: false });
  }
  
  if (!domainDoc && !isNaN(Number(id))) {
    domainDoc = await Domain.findOne({ dm_id: Number(id), dm_is_deleted: false });
  }

  if (!domainDoc) {
    return { statusCode: 404, success: false, message: "Domain not found" };
  }

  const host = domainDoc.dm_url.toLowerCase().trim().replace(/^https?[:/\\]+/i, '').replace(/[/\\]+.*$/, '');
  const DomainSummary = getDomainSummaryModel(tenantConnection);
  const latestSummary = await DomainSummary.findOne({ domain: host }).sort({ lastScanDate: -1 });

  const filter = { domain: host };

  if (latestSummary && latestSummary.jobId) {
    filter.jobId = latestSummary.jobId;
  } else {
    // Fallback: if no summary exists, find the latest jobId from reports
    const latestReport = await DomainReport.findOne({ domain: host }).sort({ scanDate: -1 });
    if (latestReport && latestReport.jobId) {
      filter.jobId = latestReport.jobId;
    }
  }

  if (search) {
    filter.$or = [
      { url: { $regex: search, $options: 'i' } },
      { 'meta.title': { $regex: search, $options: 'i' } }
    ];
  }

  if (issue) {
    const checkIssue = issue.toLowerCase().trim();
    if (checkIssue === '200') {
      filter.httpStatus = 200;
    } else if (checkIssue === '301' || checkIssue === '302' || checkIssue === '301/302' || checkIssue === '301/302 redirect') {
      filter.httpStatus = { $in: [301, 302] };
    } else if (checkIssue === '404' || checkIssue === '404 error' || checkIssue === '404 code') {
      filter.httpStatus = 404;
    } else if (checkIssue === '500' || checkIssue === '500 error' || checkIssue === '500 code') {
      filter.httpStatus = { $gte: 500 };
    } else if (checkIssue === 'valid-urls' || checkIssue === 'valid_urls' || checkIssue === 'valid urls') {
      filter.httpStatus = { $gte: 200, $lt: 400 };
    } else if (checkIssue === 'broken-links' || checkIssue === 'broken_links' || checkIssue === 'broken links') {
      const issueFilters = [
        { 'brokenLinks.0': { $exists: true } },
        { 'broken_links.0': { $exists: true } },
        { 'links.broken.0': { $exists: true } },
        { 'seoImprovements.type': 'broken-links' },
        { 'seoImprovements.message': { $regex: /broken link/i } },
        { 'links.broken': { $gt: 0 } }
      ];
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: issueFilters }];
        delete filter.$or;
      } else {
        filter.$or = issueFilters;
      }
    } else {
      const lowerIssue = issue.toLowerCase();
      const normalize = s => (s || "").toLowerCase()
        .replace(/^fix\s+/i, '')
        .replace(/^review\s+/i, '')
        .replace(/\(\d+(\.\d+)?s?\)/g, '(...)')
        .replace(/\d+\s+key\s+legal\s+terms/i, 'key legal terms')
        .replace(/\d+\s+image\(s\)/i, 'images')
        .replace(/\d+\s+spelling\s+issues/i, 'spelling issues')
        .replace(/\d+\s+broken\s+links/i, 'broken links')
        .replace(/\d+\s+large\s+images/i, 'large images')
        .replace(/>\d+KB/i, '>KB')
        .replace(/\bcls\b/gi, 'cls_safe')
        .replace(/\.$/, '')
        .replace(/s\b/g, '')
        .replace(/cls_safe/g, 'cls')
        .replace(/\s+/g, ' ')
        .trim();
      const normalizedIssue = normalize(lowerIssue);
      const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      let issueFilters = [
        { 'seoImprovements.message': issue },
        { 'seoImprovements.message': { $regex: escapeRegex(normalizedIssue), $options: 'i' } }
      ];

      if (normalizedIssue.includes('spelling') || normalizedIssue.includes('misspell') || normalizedIssue.includes('typo') || normalizedIssue.includes('title-meta-spelling') || normalizedIssue.includes('headings-spelling') || normalizedIssue.includes('image-alt-spelling') || normalizedIssue.includes('anchor-cta-spelling') || normalizedIssue.includes('navigation-footer-spelling') || normalizedIssue.includes('form-labels-placeholders') || normalizedIssue.includes('accessibility-text-spelling') || normalizedIssue.includes('content-spelling')) {
        
        const spellingBaseFilter = { 
          $or: [
            { type: 'spelling' },
            { message: { $regex: /spelling|misspell|typo/i } }
          ]
        };

        if (normalizedIssue.includes('title') || normalizedIssue.includes('meta')) {
          issueFilters.push({ seoImprovements: { $elemMatch: { ...spellingBaseFilter, message: { $regex: /title|meta/i } } } });
        } else if (normalizedIssue.includes('heading') || normalizedIssue.includes('h1')) {
          issueFilters.push({ seoImprovements: { $elemMatch: { ...spellingBaseFilter, message: { $regex: /heading|h1|h2|h3|h4|h5|h6/i } } } });
        } else if (normalizedIssue.includes('image') || normalizedIssue.includes('alt')) {
          issueFilters.push({ seoImprovements: { $elemMatch: { ...spellingBaseFilter, message: { $regex: /image|alt/i } } } });
        } else if (normalizedIssue.includes('anchor') || normalizedIssue.includes('cta') || normalizedIssue.includes('link text')) {
          issueFilters.push({ seoImprovements: { $elemMatch: { ...spellingBaseFilter, message: { $regex: /anchor|cta|link text/i } } } });
        } else if (normalizedIssue.includes('navigation') || normalizedIssue.includes('footer') || normalizedIssue.includes('nav')) {
          issueFilters.push({ seoImprovements: { $elemMatch: { ...spellingBaseFilter, message: { $regex: /navigation|footer|nav/i } } } });
        } else if (normalizedIssue.includes('form') || normalizedIssue.includes('label') || normalizedIssue.includes('placeholder')) {
          issueFilters.push({ seoImprovements: { $elemMatch: { ...spellingBaseFilter, message: { $regex: /form|label|placeholder/i } } } });
        } else if (normalizedIssue.includes('accessibility') || normalizedIssue.includes('aria')) {
          issueFilters.push({ seoImprovements: { $elemMatch: { ...spellingBaseFilter, message: { $regex: /accessibility|aria/i } } } });
        } else {
          issueFilters.push({ 'seoImprovements.type': 'spelling' });
          issueFilters.push({ 'misspellings.0': { $exists: true } });
          issueFilters.push({ 'textMetrics.misspellings.0': { $exists: true } });
          issueFilters.push({ 'spelling_mistakes.0': { $exists: true } });
        }
      } else if (normalizedIssue.includes('broken link') || normalizedIssue.includes('404')) {
        issueFilters.push({ 'brokenLinks.0': { $exists: true } });
        issueFilters.push({ 'broken_links.0': { $exists: true } });
        issueFilters.push({ 'links.broken.0': { $exists: true } });
        issueFilters.push({ 'seoImprovements.type': 'broken-links' });
      } else if (normalizedIssue.includes('broken image')) {
        issueFilters.push({ 'brokenImages.0': { $exists: true } });
        issueFilters.push({ 'broken_images.0': { $exists: true } });
        issueFilters.push({ 'images.broken.0': { $exists: true } });
        issueFilters.push({ 'seoImprovements.type': 'broken-images' });
      } else if (normalizedIssue.includes('meta title')) {
        issueFilters.push({ 'meta.title': { $in: [null, ""] } });
        issueFilters.push({ 'meta.title': { $exists: false } });
        issueFilters.push({ 'seoImprovements.message': { $regex: /missing.*title|title.*missing/i } });
      } else if (normalizedIssue.includes('description too long') || normalizedIssue.includes('description length')) {
        issueFilters.push({ 'meta.description': { $regex: /^.{156,}$/ } });
        issueFilters.push({ 'seoImprovements.message': { $regex: /description.*too.*long/i } });
      } else if (normalizedIssue.includes('description too short')) {
        issueFilters.push({ 'meta.description': { $regex: /^.{1,29}$/ } });
        issueFilters.push({ 'seoImprovements.message': { $regex: /description.*too.*short/i } });
      } else if (normalizedIssue.includes('meta description')) {
        issueFilters.push({ 'meta.description': { $in: [null, ""] } });
        issueFilters.push({ 'meta.description': { $exists: false } });
        issueFilters.push({ 'seoImprovements.message': { $regex: /missing.*description|description.*missing/i } });
      } else if (normalizedIssue.includes('h1 missing') || normalizedIssue.includes('h1 tag missing')) {
        issueFilters.push({ 'headings.h1': 0 });
        issueFilters.push({ 'headings.h1': { $exists: false } });
        issueFilters.push({ 'seoImprovements.message': { $regex: /missing.*h1|h1.*missing/i } });
      } else if (normalizedIssue.includes('multiple h1')) {
        issueFilters.push({ 'headings.h1': { $gt: 1 } });
        issueFilters.push({ 'seoImprovements.message': { $regex: /multiple.*h1/i } });
      } else if (normalizedIssue.includes('canonical')) {
        issueFilters.push({ 'meta.canonical': { $in: [null, ""] } });
        issueFilters.push({ 'meta.canonical': { $exists: false } });
        issueFilters.push({ 'seoImprovements.message': { $regex: /missing.*canonical|canonical.*missing/i } });
      } else if (normalizedIssue.includes('alt text')) {
        issueFilters.push({ 'images.withoutAlt': { $gt: 0 } });
        issueFilters.push({ 'seoImprovements.message': { $regex: /alt.*text|missing.*alt/i } });
      } else if (normalizedIssue.includes('lcp') || normalizedIssue.includes('largest contentful paint')) {
        issueFilters.push({ 'seoImprovements.message': { $regex: /lcp/i } });
      } else if (normalizedIssue.includes('inp') || normalizedIssue.includes('interaction to next paint')) {
        issueFilters.push({ 'seoImprovements.message': { $regex: /inp|interaction to next paint/i } });
      } else if (normalizedIssue.includes('fcp') || normalizedIssue.includes('first contentful paint')) {
        issueFilters.push({ 'seoImprovements.message': { $regex: /fcp|first contentful paint/i } });
      } else if (normalizedIssue.includes('cls') || normalizedIssue.includes('cumulative layout shift')) {
        issueFilters.push({ 'seoImprovements.message': { $regex: /cls|layout shift/i } });
      } else if (normalizedIssue.includes('speed index')) {
        issueFilters.push({ 'seoImprovements.message': { $regex: /speed index/i } });
      } else if (normalizedIssue.includes('blocking time') || normalizedIssue.includes('tbt')) {
        issueFilters.push({ 'seoImprovements.message': { $regex: /blocking time|tbt/i } });
      } else if (normalizedIssue.includes('render-blocking') || normalizedIssue.includes('render blocking')) {
        issueFilters.push({ 'seoImprovements.message': { $regex: /render-blocking|render blocking/i } });
      } else if (normalizedIssue.includes('large image')) {
        issueFilters.push({ 'seoImprovements.message': { $regex: /large image/i } });
      } else if (normalizedIssue.includes('t&c') || normalizedIssue.includes('terms') || normalizedIssue.includes('compliance')) {
        issueFilters.push({ 'seoImprovements.message': { $regex: /terms|t&c|compliance/i } });
      } else if (normalizedIssue.includes('h1') || normalizedIssue.includes('heading')) {
        issueFilters.push({ 'seoImprovements.message': { $regex: /h1|heading/i } });
      } else if (normalizedIssue.includes('title')) {
        issueFilters.push({ 'seoImprovements.message': { $regex: /title/i } });
      } else if (normalizedIssue.includes('description')) {
        issueFilters.push({ 'seoImprovements.message': { $regex: /description/i } });
      }

      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: issueFilters }];
        delete filter.$or;
      } else {
        filter.$or = issueFilters;
      }
    }
  }

  // Get all reports matching the filter sorted by latest scanDate
  const allReports = await DomainReport.find(filter).sort({ scanDate: -1 });

  // De-duplicate by unique URL in-memory, keeping only the latest report per URL
  const uniqueReportsMap = new Map();
  for (const r of allReports) {
    if (r.url && !uniqueReportsMap.has(r.url)) {
      uniqueReportsMap.set(r.url, r);
    }
  }
  const uniqueReports = Array.from(uniqueReportsMap.values());

  // Map to the structure expected by the frontend
  const mappedPages = uniqueReports.map(r => ({
    title: r.meta?.title || '(No title found)',
    url: r.url,
    notifications: (r.seoImprovements || []).length,
    priority: (r.seoImprovements || []).some(i => i.priority === 'high') ? 'High' : 
              (r.seoImprovements || []).some(i => i.priority === 'medium') ? 'Medium' : 'Low',
    views: 0, 
    performanceScore: r.lighthousePerformanceScore || r.performance?.score || r.performance?.advancedMetrics?.performanceScore || 0,
    accessibilityScore: r.lighthouseAccessibilityScore || r.accessibility?.score || 0,
    lastCrawled: r.scanDate || r.scanCompletedAt || r.createdAt,
    seoImprovements: r.seoImprovements || [],
    targetedIssueCount: issue ? 
      (() => {
        const lowerIssue = issue.toLowerCase();
        const normalize = s => (s || "").toLowerCase()
          .replace(/^fix\s+/i, '')
          .replace(/^review\s+/i, '')
          .replace(/\(\d+(\.\d+)?s?\)/g, '(...)')
          .replace(/\d+\s+key\s+legal\s+terms/i, 'key legal terms')
          .replace(/\d+\s+image\(s\)/i, 'images')
          .replace(/\d+\s+spelling\s+issues/i, 'spelling issues')
          .replace(/\d+\s+broken\s+links/i, 'broken links')
          .replace(/\d+\s+large\s+images/i, 'large images')
          .replace(/>\d+KB/i, '>KB')
          .replace(/\bcls\b/gi, 'cls_safe')
          .replace(/\.$/, '')
          .replace(/s\b/g, '')
          .replace(/cls_safe/g, 'cls')
          .replace(/\s+/g, ' ')
          .trim();
        const normalizedIssue = normalize(lowerIssue);
        
        let target = (r.seoImprovements || []).find(imp => {
          const m = (imp.message || "").toLowerCase();
          const nm = normalize(m);
          return m === lowerIssue || nm === normalizedIssue || m.includes(normalizedIssue) || lowerIssue.includes(nm);
        });
        
        let count = target ? (target.count || 0) : 0;
        
        const isCountableIssue = normalizedIssue.includes('spelling') || 
                                 normalizedIssue.includes('misspell') || 
                                 normalizedIssue.includes('typo') || 
                                 normalizedIssue.includes('broken link') || 
                                 normalizedIssue.includes('404') || 
                                 normalizedIssue.includes('broken image');

        if (isCountableIssue) {
          // If it's a general spelling/broken link issue, use the raw counts if they are > 0
          if (normalizedIssue.includes('broken link') || normalizedIssue.includes('404')) {
            const bl = r.brokenLinks || r.broken_links || (r.links && r.links.broken) || [];
            if (bl.length > 0) return bl.length;
          }
          if (normalizedIssue.includes('broken image')) {
            const bi = r.brokenImages || r.broken_images || (r.images && r.images.broken) || [];
            if (bi.length > 0) return bi.length;
          }
          if (normalizedIssue.includes('spelling') || normalizedIssue.includes('misspell')) {
             // If it's a specific category, we should filter improvements by that category
             // But if it's general, use total misspellings
              const totalMs = (r.misspellings || r.textMetrics?.misspellings || r.spelling_mistakes || []).length || r.textMetrics?.spellingMistakesCount || 0;
              if (totalMs > 0) return totalMs;
          }
        }

        // Search again with more specific spelling category logic if needed
        target = (r.seoImprovements || []).find(imp => {
          const m = (imp.message || "").toLowerCase();
          const nm = normalize(m);
          if (m === lowerIssue || nm === normalizedIssue || m.includes(normalizedIssue) || lowerIssue.includes(nm)) return true;
          
          // Special cases for spelling categories
          if (normalizedIssue.includes('spelling') || normalizedIssue.includes('misspell')) {
             const scMapping = {
                'title': [/title/i, /meta/i, /description/i],
                'heading': [/heading/i, /h1/i, /h2/i, /h3/i, /h4/i, /h5/i, /h6/i],
                'image': [/image alt/i, /alt text/i],
                'anchor': [/anchor/i, /cta/i, /link text/i],
                'navigation': [/navigation/i, /footer/i, /nav/i],
                'form': [/form/i, /label/i, /placeholder/i],
             };
             for (const [key, regexes] of Object.entries(scMapping)) {
                if (normalizedIssue.includes(key) && regexes.some(rx => rx.test(m))) return true;
             }
          }
          return false;
        });
        
        count = target ? (target.count || 0) : 0;
        
        // If count is 0 or 1, try to extract it from the message (e.g. "Fix 2 broken links")
        if (count <= 1 && target && target.message) {
          const match = target.message.match(/(\d+)/);
          if (match) count = parseInt(match[1]);
        }

        // If still 1 or 0, check details array length if present
        if (count <= 1 && target && target.details && Array.isArray(target.details)) {
          count = target.details.length || count;
        }
        
        // Fallback for special cases where count might be missing or 1 in improvements but present in raw data
        if (count <= 1) {
          if (normalizedIssue.includes('spelling') || normalizedIssue.includes('misspellings')) {
            count = (r.misspellings || r.textMetrics?.misspellings || r.spelling_mistakes || []).length || count;
          } else if (normalizedIssue.includes('broken link')) {
            count = (r.brokenLinks || r.broken_links || (r.links && r.links.broken) || []).length || count;
          } else if (normalizedIssue.includes('broken image')) {
            count = (r.brokenImages || r.broken_images || (r.images && r.images.broken) || []).length || count;
          }
        }
        
        return count || 1; // Last resort default to 1 if we know it's an affected page
      })() : 
      (r.seoImprovements || []).length,

    brokenLinks: (() => {
      if (r.brokenLinks && r.brokenLinks.length) return r.brokenLinks;
      if (r.broken_links && r.broken_links.length) return r.broken_links;
      if (r.links && r.links.broken && r.links.broken.length) return r.links.broken;
      // Extract from seoImprovements
      const imp = (r.seoImprovements || []).find(i => (i.type === 'broken-links' || (i.message || "").toLowerCase().includes("broken link")));
      return (imp && imp.details && Array.isArray(imp.details)) ? imp.details : [];
    })(),
    brokenImages: (() => {
      if (r.brokenImages && r.brokenImages.length) return r.brokenImages;
      if (r.broken_images && r.broken_images.length) return r.broken_images;
      if (r.images && r.images.broken && r.images.broken.length) return r.images.broken;
      // Extract from seoImprovements
      const imp = (r.seoImprovements || []).find(i => (i.type === 'broken-images' || (i.message || "").toLowerCase().includes("broken image")));
      return (imp && imp.details && Array.isArray(imp.details)) ? imp.details : [];
    })(),
    misspellings: (() => {
      const rawMs = (r.misspellings || r.textMetrics?.misspellings || r.spelling_mistakes || []);
      if (rawMs.length) return rawMs;
      // Extract from seoImprovements
      const imp = (r.seoImprovements || []).find(i => (i.type === 'spelling' || (i.message || "").toLowerCase().includes("spelling")));
      return (imp && imp.details && Array.isArray(imp.details)) ? imp.details.map(d => ({ word: d.word, suggestions: d.suggestions })) : [];
    })(),
    largeImages: (() => {
      // Extract from seoImprovements
      const imp = (r.seoImprovements || []).find(i => (i.type === 'images' && (i.message || "").toLowerCase().includes("large image")));
      if (imp && imp.details && Array.isArray(imp.details)) return imp.details;
      // Fallback: extract from r.imageAnalysis or r.images
      const loadDetails = r.imageAnalysis?.imageLoadDetails || r.images?.imageLoadDetails || [];
      return loadDetails.filter(img => {
        const sizeStr = String(img.size || '0').toLowerCase();
        if (sizeStr.includes('mb')) return true;
        if (sizeStr.includes('kb')) {
          const kb = parseFloat(sizeStr);
          return kb > 150;
        }
        return false;
      });
    })()
  }));

  // Filter out pages that don't actually have the targeted issue (count > 0)
  const filteredPages = issue ? mappedPages.filter(p => p.targetedIssueCount > 0) : mappedPages;
  const finalTotal = filteredPages.length;

  // Apply pagination slicing on the unique results
  const paginatedPages = filteredPages.slice(skip, skip + Number(limit));

  return {
    statusCode: 200,
    success: true,
    message: "SEO pages retrieved",
    data: {
      pages: paginatedPages,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: finalTotal,
        pages: Math.ceil(finalTotal / Number(limit)) || 1
      }
    }
  };
}

/**
 * Get SEO checkpoints summary for a domain
 */
async function get_domain_seo_checkpoints_service({ tenantConnection, params }) {
  const { id } = params;
  const Domain = getDomainModel(tenantConnection);
  const DomainSummary = getDomainSummaryModel(tenantConnection);

  let domainDoc;
  if (mongoose.Types.ObjectId.isValid(id)) {
    domainDoc = await Domain.findOne({ _id: id, dm_is_deleted: false });
  }
  
  if (!domainDoc && !isNaN(Number(id))) {
    domainDoc = await Domain.findOne({ dm_id: Number(id), dm_is_deleted: false });
  }

  if (!domainDoc) {
    return { statusCode: 404, success: false, message: "Domain not found" };
  }

  const host = domainDoc.dm_url.toLowerCase().trim().replace(/^https?[:/\\]+/i, '').replace(/[/\\]+.*$/, '');
  const summary = await DomainSummary.findOne({ domain: host }).sort({ lastScanDate: -1 });

  if (!summary) {
    return {
      statusCode: 200,
      success: true,
      data: { high: [], medium: [], low: [] }
    };
  }

  const totalPages = summary.totalPages || 1;

  const mapIssue = (issue) => ({
    id: issue.type + Math.random().toString(36).substr(2, 9),
    issue: issue.message,
    showInfoIcon: true,
    status: "error",
    compliancePercent: Math.round(((totalPages - issue.count) / totalPages) * 100),
    pagesLabel: `${issue.count} PAGE${issue.count > 1 ? 'S' : ''}`,
    pagesHref: "#"
  });

  const high = summary.topIssues.filter(i => i.priority === 'high').map(mapIssue);
  const medium = summary.topIssues.filter(i => i.priority === 'medium').map(mapIssue);
  const low = summary.topIssues.filter(i => i.priority === 'low').map(mapIssue);

  return {
    statusCode: 200,
    success: true,
    message: "SEO checkpoints retrieved",
    data: { high, medium, low }
  };
}

/**
 * Trigger domain scan
 */
async function trigger_domain_scan_service({ tenantConnection, params, user }) {
  const { id } = params;
  const Domain = getDomainModel(tenantConnection);

  let query = { dm_is_deleted: false };
  if (mongoose.Types.ObjectId.isValid(id)) {
    query._id = id;
  } else if (!isNaN(Number(id))) {
    query.dm_id = Number(id);
  } else {
    return { statusCode: 404, success: false, message: "Invalid domain ID" };
  }

  const domain = await Domain.findOneAndUpdate(
    query,
    { 
      $set: { 
        dm_seo_status: 'pending',
        dm_updated_at: new Date()
      } 
    },
    { new: true }
  );

  if (!domain) {
    return { statusCode: 404, success: false, message: "Domain not found" };
  }

  // Post job details to master queue enqueuer immediately
  try {
    const MASTER_URL = process.env.MASTER_MS_URL || "http://localhost:4100";
    await fetch(`${MASTER_URL}/scan/domain`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        dm_url: domain.dm_url,
        dm_max_scanned_pages: domain.dm_max_scanned_pages || 500,
        dm_scan_subdomains: domain.dm_scan_subdomains ?? true,
        dm_render_pages_execute_js: domain.dm_render_pages_execute_js ?? false,
        sourceDb: tenantConnection.name,
        sourceUri: process.env.DB_URL,
        sourceDomainDocId: domain._id,
        dm_custom_urls: domain.dm_custom_urls || []
      })
    });
    console.log(`Successfully triggered immediate SEO scan in Master MS for: ${domain.dm_url}`);
  } catch (err) {
    console.error("Failed to trigger immediate SEO scan in Master MS:", err);
  }

  // Also trigger Sitemap scan in the background
  try {
    scan_sitemap_service(tenantConnection, domain).catch(err => {
      console.error("Background sitemap scan failed:", err);
    });
  } catch(err) {
    console.error("Failed to start sitemap scan:", err);
  }

  // Log activity
  try {
    const User = getUserModel(tenantConnection);
    const loginUser = await User.findOne({ user_id: user?.user_id, user_is_deleted: false });
    await global.createActivityLog(tenantConnection, {
      userId: loginUser?._id,
      userName: `${loginUser?.user_first_name || ""} ${loginUser?.user_last_name || ""}`.trim() || user?.user_email,
      action: "TRIGGER_SCAN",
      details: `Scan triggered manually for domain '${domain.dm_title}' (${domain.dm_url}) by ${loginUser?.user_first_name || user?.user_email || "User"}.`,
      metadata: { domainId: domain._id, domainUrl: domain.dm_url }
    });
  } catch (logErr) {
    console.error("Failed to log activity:", logErr);
  }

  return {
    statusCode: 200,
    success: true,
    message: "Scan triggered successfully. Domain status updated to pending.",
    data: domain,
  };
}

/**
 * Get aggregated audit data for a domain
 */
async function get_domain_audit_data_service({ tenantConnection, params }) {
  const { id } = params;
  const Domain = getDomainModel(tenantConnection);
  const DomainSummary = getDomainSummaryModel(tenantConnection);
  const DomainReport = getDomainReportModel(tenantConnection);
  const Audit = getAuditModel(tenantConnection);

  let domainDoc;
  if (mongoose.Types.ObjectId.isValid(id)) {
    domainDoc = await Domain.findOne({ _id: id, dm_is_deleted: false });
  }
  if (!domainDoc && !isNaN(Number(id))) {
    domainDoc = await Domain.findOne({ dm_id: Number(id), dm_is_deleted: false });
  }
  if (!domainDoc) {
    return { statusCode: 404, success: false, message: 'Domain not found' };
  }

  const host = domainDoc.dm_url.toLowerCase().trim().replace(/^https?[:/\\]+/i, '').replace(/[/\\]+.*$/, '');
  const summary = await DomainSummary.findOne({ domain: host }).sort({ lastScanDate: -1 }).lean();

  let latestJobId = summary?.jobId;
  if (!latestJobId) {
    const latestReport = await DomainReport.findOne({ domain: host }).sort({ scanDate: -1 });
    if (latestReport && latestReport.jobId) latestJobId = latestReport.jobId;
  }

  // Look for a cached audit snapshot matching the latest scan
  let savedAuditDoc;
  if (latestJobId) {
    savedAuditDoc = await Audit.findOne({ domain: host, jobId: latestJobId }).lean();
  }

  if (savedAuditDoc) {
    return {
      statusCode: 200,
      success: true,
      message: 'Domain audit data retrieved from cache',
      data: {
        domain: domainDoc,
        summary,
        performance: savedAuditDoc.performance,
        pagesAnalyzed: savedAuditDoc.pagesAnalyzed,
        seoHealth: savedAuditDoc.seoHealth,
        responseStatus: savedAuditDoc.responseStatus,
        spellChecker: savedAuditDoc.spellChecker,
        topIssues: summary?.topIssues || [],
        lastScanDate: savedAuditDoc.scanDate || summary?.lastScanDate || domainDoc.dm_last_scan_at,
        jobId: savedAuditDoc.jobId
      }
    };
  }

  // Get latest reports for this domain (up to 500 for aggregation)
  let reportFilter = { domain: host };
  if (latestJobId) {
    reportFilter.jobId = latestJobId;
  }

  const reports = await DomainReport.find(reportFilter).sort({ scanDate: -1 }).limit(500).lean();

  // --- Performance ---
  const perfScores = reports.map(r => r.performance?.score || r.lighthousePerformanceScore || 0).filter(s => s > 0);
  const avgPerf = perfScores.length > 0 ? Math.round(perfScores.reduce((a, b) => a + b, 0) / perfScores.length) : (summary?.performanceMetrics?.avgPerformanceScore || 0);
  const lcpVals = reports.map(r => r.performance?.lcp || r.performance?.largestContentfulPaint || 0).filter(v => v > 0);
  const avgLCP = lcpVals.length > 0 ? (lcpVals.reduce((a, b) => a + b, 0) / lcpVals.length).toFixed(2) : (summary?.performanceMetrics?.avgLCP || 0);
  const inpVals = reports.map(r => r.performance?.inp || r.performance?.interactionToNextPaint || 0).filter(v => v > 0);
  const avgINP = inpVals.length > 0 ? Math.round(inpVals.reduce((a, b) => a + b, 0) / inpVals.length) : 0;

  // --- Pages Analyzed / Response Status ---
  const totalPages = summary?.totalPages || reports.length || 0;
  const statusCounts = { 200: 0, 301: 0, 302: 0, 404: 0, 500: 0, other: 0 };
  for (const r of reports) {
    const s = r.httpStatus;
    if (s === 200) statusCounts[200]++;
    else if (s === 301) statusCounts[301]++;
    else if (s === 302) statusCounts[302]++;
    else if (s === 404) statusCounts[404]++;
    else if (s >= 500) statusCounts[500]++;
    else statusCounts.other++;
  }
  const validUrls = statusCounts[200] + statusCounts[301] + statusCounts[302];

  // --- SEO Health ---
  const normalize = s => (s || '').toLowerCase().replace(/\d+/g, '').replace(/^fix\s+/i, '').replace(/^review\s+/i, '').replace(/\.$/,'').replace(/s\b/g,'').replace(/\s+/g,' ').trim();
  const seoHealthMap = {
    'meta-title-missing': 0,
    'meta-description-missing': 0,
    'h1-tags-missing': 0,
    'no-canonical': 0,
    'multiple-h1-tags': 0,
    'meta-description-too-long': 0,
    'meta-description-too-short': 0,
    'missing-alt-text': 0,
  };
  const issueKeywords = {
    'meta-title-missing': ['meta title', 'title tag', 'missing title'],
    'meta-description-missing': ['meta description', 'description missing'],
    'h1-tags-missing': ['h1 missing', 'h1 tag', 'missing h1'],
    'no-canonical': ['canonical'],
    'multiple-h1-tags': ['multiple h1'],
    'meta-description-too-long': ['description too long', 'description length'],
    'meta-description-too-short': ['description too short'],
    'missing-alt-text': ['alt text', 'image alt', 'missing alt'],
  };

  if (summary && summary.topIssues) {
    for (const issue of summary.topIssues) {
      const msg = (issue.message || '').toLowerCase();
      const nm = normalize(msg);
      for (const [slug, keywords] of Object.entries(issueKeywords)) {
        if (keywords.some(k => msg.includes(k) || nm.includes(normalize(k)))) {
          seoHealthMap[slug] = (seoHealthMap[slug] || 0) + (issue.count || 0);
          break;
        }
      }
    }
  }

  // Count directly from reports
  for (const r of reports) {
    if (!r.meta?.title) seoHealthMap['meta-title-missing']++;
    if (!r.meta?.description) seoHealthMap['meta-description-missing']++;
    const h1Count = r.headings?.h1?.length || 0;
    if (h1Count === 0) seoHealthMap['h1-tags-missing']++;
    if (h1Count > 1) seoHealthMap['multiple-h1-tags']++;
    if (!r.meta?.canonical) seoHealthMap['no-canonical']++;
    const descLen = (r.meta?.description || '').length;
    if (descLen > 0 && descLen > 155) seoHealthMap['meta-description-too-long']++;
    if (descLen > 0 && descLen < 30) seoHealthMap['meta-description-too-short']++;
    const imagesWithoutAlt = (r.images?.list || []).filter(img => !img.alt || img.alt.trim() === '').length;
    if (imagesWithoutAlt > 0) seoHealthMap['missing-alt-text'] += imagesWithoutAlt;
  }

  // --- Spell Checker ---
  let totalMisspellings = 0;
  const spellCheckerCategories = {
    'title-meta-spelling': 0,
    'headings-spelling': 0,
    'image-alt-spelling': 0,
    'anchor-cta-spelling': 0,
    'navigation-footer-spelling': 0,
    'form-labels-placeholders': 0,
    'language-consistency': 0,
    'accessibility-text-spelling': 0,
    'content-spelling': 0,
  };

  const scMapping = {
    'title-meta-spelling': [/title/i, /meta/i, /description/i],
    'headings-spelling': [/heading/i, /h1/i, /h2/i, /h3/i, /h4/i, /h5/i, /h6/i],
    'image-alt-spelling': [/image alt/i, /alt text/i],
    'anchor-cta-spelling': [/anchor/i, /cta/i, /link text/i],
    'navigation-footer-spelling': [/navigation/i, /footer/i, /nav/i],
    'form-labels-placeholders': [/form/i, /label/i, /placeholder/i],
    'language-consistency': [/language/i],
    'accessibility-text-spelling': [/accessibility/i, /aria/i],
  };

  const pagesWithBrokenLinksSet = new Set();
  const pagesWithMisspellingsSet = new Set();
  let totalBrokenLinks = 0;

  for (const r of reports) {
    let pageMisspellings = (r.misspellings || r.textMetrics?.misspellings || r.spelling_mistakes || []).length;
    const spellingImps = (r.seoImprovements || []).filter(i => (i.type === 'spelling' || (i.message || "").toLowerCase().includes("spelling")));
    if (pageMisspellings === 0 && spellingImps.length > 0) {
      for (const imp of spellingImps) {
        let count = imp.count || 0;
        if (count <= 1 && imp.message) {
          const match = imp.message.match(/(\d+)/);
          if (match) count = parseInt(match[1]);
        }
        if (count <= 1 && imp.details && Array.isArray(imp.details)) {
          count = imp.details.length || count;
        }
        pageMisspellings += (count || 1);
      }
    }
    
    if (pageMisspellings > 0) {
      totalMisspellings += pageMisspellings;
      pagesWithMisspellingsSet.add(r.url);
    }

    const bl = r.brokenLinks || r.broken_links || r.links?.brokenDetails || (Array.isArray(r.links?.broken) ? r.links.broken : []);
    const blCount = Array.isArray(bl) ? bl.length : (typeof r.links?.broken === 'number' ? r.links.broken : 0);
    if (blCount > 0 || (r.seoImprovements || []).some(i => i.type === 'broken-links')) {
      pagesWithBrokenLinksSet.add(r.url);
      totalBrokenLinks += (blCount || 1);
    }

    for (const imp of (r.seoImprovements || [])) {
      const msg = (imp.message || '').toLowerCase();
      if (msg.includes('spelling') || msg.includes('misspell') || msg.includes('typo')) {
        let count = imp.count || 0;
        if (count <= 1) {
          const match = msg.match(/(\d+)/);
          if (match) count = parseInt(match[1]);
        }
        if (count <= 1 && imp.details && Array.isArray(imp.details)) {
          count = imp.details.length || count;
        }
        count = count || 1;

        for (const [slug, regexes] of Object.entries(scMapping)) {
          if (regexes.some(rx => rx.test(msg))) {
            spellCheckerCategories[slug] += count;
          }
        }
      }
    }
  }
  
  spellCheckerCategories['content-spelling'] = totalMisspellings;

  const resultData = {
    domain: domainDoc,
    summary,
    performance: {
      score: avgPerf,
      avgLCP: Number(avgLCP),
      avgINP,
      status: avgPerf >= 90 ? 'Good' : avgPerf >= 50 ? 'Needs Improvement' : 'Poor',
    },
    pagesAnalyzed: {
      totalPages,
      statusCodes: {
        200: statusCounts[200],
        301: statusCounts[301],
        302: statusCounts[302],
        404: statusCounts[404],
        500: statusCounts[500],
      },
      validUrls,
    },
    seoHealth: seoHealthMap,
    responseStatus: {
      validUrls,
      200: statusCounts[200],
      301: statusCounts[301],
      302: statusCounts[302],
      404: statusCounts[404],
      500: statusCounts[500],
    },
    spellChecker: {
      totalMisspellings,
      totalBrokenLinks,
      pagesWithMisspellings: pagesWithMisspellingsSet.size,
      pagesWithBrokenLinks: pagesWithBrokenLinksSet.size,
      ...spellCheckerCategories,
    },
    topIssues: summary?.topIssues || [],
    lastScanDate: summary?.lastScanDate || domainDoc.dm_last_scan_at,
    jobId: latestJobId
  };

  // Save to Audit DB table to cache it permanently
  if (latestJobId && reports.length > 0) {
    try {
      const pageDetails = reports.map(r => {
        let misspellingsCount = (r.misspellings || r.textMetrics?.misspellings || r.spelling_mistakes || []).length;
        const spellingImps = (r.seoImprovements || []).filter(i => (i.type === 'spelling' || (i.message || "").toLowerCase().includes("spelling")));
        if (misspellingsCount === 0 && spellingImps.length > 0) {
          spellingImps.forEach(imp => {
            let count = imp.count || 0;
            if (count <= 1 && imp.message) {
              const match = imp.message.match(/(\d+)/);
              if (match) count = parseInt(match[1]);
            }
            if (count <= 1 && imp.details && Array.isArray(imp.details)) {
              count = imp.details.length || count;
            }
            misspellingsCount += (count || 1);
          });
        }

        const bl = r.brokenLinks || r.broken_links || r.links?.brokenDetails || (Array.isArray(r.links?.broken) ? r.links.broken : []);
        const blCount = Array.isArray(bl) ? bl.length : (typeof r.links?.broken === 'number' ? r.links.broken : 0);
        let brokenLinksCount = blCount || ((r.seoImprovements || []).some(i => i.type === 'broken-links') ? 1 : 0);

        return {
          url: r.url,
          httpStatus: r.httpStatus || 200,
          seoScore: r.seoScore || 0,
          performanceScore: r.lighthousePerformanceScore || r.performance?.score || r.performance?.advancedMetrics?.performanceScore || 0,
          accessibilityScore: r.lighthouseAccessibilityScore || r.accessibility?.score || 0,
          lastCrawled: r.scanDate || r.scanCompletedAt || new Date(),
          
          hasTitle: !!r.meta?.title,
          hasDescription: !!r.meta?.description,
          h1Count: r.headings?.h1?.length || 0,
          hasCanonical: !!r.meta?.canonical,
          imagesWithoutAlt: (r.images?.list || []).filter(img => !img.alt || img.alt.trim() === '').length,
          
          misspellingsCount,
          brokenLinksCount
        };
      });

      const auditSnapshot = {
        domain: host,
        jobId: latestJobId,
        scanDate: summary?.lastScanDate || domainDoc.dm_last_scan_at || new Date(),
        performance: resultData.performance,
        pagesAnalyzed: resultData.pagesAnalyzed,
        seoHealth: resultData.seoHealth,
        responseStatus: resultData.responseStatus,
        spellChecker: resultData.spellChecker,
        pages: pageDetails
      };

      await Audit.create(auditSnapshot);
      console.log(`Saved dynamic audit calculation to Audit DB table for jobId: ${latestJobId}`);
    } catch (saveErr) {
      console.error('Error saving dynamic audit calculation:', saveErr);
    }
  }

  return {
    statusCode: 200,
    success: true,
    message: 'Domain audit data retrieved',
    data: resultData
  };
}

module.exports = {
  create_domain_service,
  get_domain_list_service,
  get_domain_by_id_service,
  update_domain_service,
  delete_domain_service,
  archive_domain_service,
  restore_domain_service,
  hard_delete_domain_service,
  get_domain_scan_history_service,
  get_latest_domain_summary_service,
  get_domain_seo_pages_service,
  get_domain_seo_checkpoints_service,
  trigger_domain_scan_service,
  get_domain_audit_data_service,
};
