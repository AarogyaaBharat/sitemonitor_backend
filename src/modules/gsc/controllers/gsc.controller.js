const { google } = require("googleapis");
const { decrypt } = require("../../../common/utils/crypto");
const { googleConnectionSchema } = require("../../auth/models/google_connection.schema");
const googleOauthService = require("../../auth/services/google-oauth.service");

exports.validateGscConnection = async (req, res) => {
  try {
    const userId = req.user.id;
    const tenantConnection = req.tenantConnection;

    const GoogleConnection = tenantConnection.models.GoogleConnection || tenantConnection.model("GoogleConnection", googleConnectionSchema, "google_connections");
    const connection = await GoogleConnection.findOne({ user_id: userId }).lean();

    if (!connection || (!connection.access_token && !connection.refresh_token)) {
      return res.status(200).json({
        success: true,
        connected: false,
        message: "No Google Search Console connection found for this user."
      });
    }

    const decryptedRefreshToken = connection.refresh_token ? decrypt(connection.refresh_token) : null;

    const oauth2Client = googleOauthService.getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: connection.access_token,
      refresh_token: decryptedRefreshToken
    });

    const searchconsole = google.webmasters({ version: "v3", auth: oauth2Client });

    // Fetch verified sites to validate GSC access
    const sitesRes = await searchconsole.sites.list();
    const properties = (sitesRes.data.siteEntry || []).map(site => ({
      siteUrl: site.siteUrl,
      permissionLevel: site.permissionLevel
    }));

    return res.status(200).json({
      success: true,
      connected: true,
      google_email: connection.google_email,
      properties
    });

  } catch (error) {
    console.error("GSC Validation failed:", error);
    
    let statusCode = 500;
    let message = "Failed to validate Google Search Console connection";
    let type = "unknown_error";

    // Handle token expiration/revocation errors
    if (error.message && (error.message.includes("invalid_grant") || error.message.includes("invalid_token") || error.code === 401 || error.code === 400)) {
      statusCode = 401;
      message = "Google authorization expired or access has been revoked. Please reconnect your account.";
      type = "invalid_grant";
    } else if (error.code === 403) {
      statusCode = 403;
      message = "You do not have permission to access Google Search Console.";
      type = "forbidden";
    }

    return res.status(statusCode).json({
      success: false,
      connected: false,
      message,
      type,
      rawError: error.message
    });
  }
};
