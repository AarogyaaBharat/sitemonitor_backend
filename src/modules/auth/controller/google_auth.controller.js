const { encrypt } = require("../../../common/utils/crypto");
const { googleConnectionSchema } = require("../models/google_connection.schema");
const googleOauthService = require("../services/google-oauth.service.js");

exports.getGoogleAuthUrl = async (req, res) => {
  try {
    // We pass tenant info and user id in the state so we know who they are on callback
    const stateObj = {
      tenantId: req.user.tenantId, // Assuming req.user is set by authMiddleware
      userId: req.user.id
    };
    const state = Buffer.from(JSON.stringify(stateObj)).toString("base64");
    const url = googleOauthService.getAuthUrl(state);

    return res.status(200).json({ success: true, data: { url } });
  } catch (error) {
    console.error("Error generating Google Auth URL:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.googleAuthCallback = async (req, res) => {
  try {
    const { code, state } = req.query; // If this is a GET redirect
    
    // In many SPAs, the frontend handles the redirect, extracts the code, and POSTs it.
    const actualCode = code || req.body.code;
    
    if (!actualCode) {
      return res.status(400).json({ success: false, message: "Authorization code missing" });
    }

    const tokens = await googleOauthService.getTokensFromCode(actualCode);
    const googleEmail = await googleOauthService.getUserEmail(tokens);

    // Determine tenant and user
    // If it's a POST request from frontend, authMiddleware is present.
    let userId = req.user ? req.user.id : null;
    let tenantConnection = req.tenantConnection;
    
    // If it's a GET request directly from Google, parse state
    if (!userId && state) {
      try {
        const stateObj = JSON.parse(Buffer.from(state, "base64").toString("utf8"));
        userId = stateObj.userId;
      } catch (err) {
        console.error("Failed to parse state", err);
      }
    }

    if (!userId || !tenantConnection) {
       return res.status(401).json({ success: false, message: "Unauthorized. Missing user context." });
    }

    // Encrypt refresh token
    const encryptedRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;

    const GoogleConnection = tenantConnection.models.GoogleConnection || tenantConnection.model("GoogleConnection", googleConnectionSchema, "google_connections");

    // Upsert the connection for the user
    const updateData = {
      google_email: googleEmail,
      access_token: tokens.access_token,
      token_expiry: tokens.expiry_date
    };
    
    if (encryptedRefreshToken) {
      updateData.refresh_token = encryptedRefreshToken;
    }

    const connection = await GoogleConnection.findOneAndUpdate(
      { user_id: userId, google_email: googleEmail },
      updateData,
      { new: true, upsert: true }
    );

    return res.status(200).json({ 
      success: true, 
      message: "Google account connected successfully",
      data: {
        google_email: connection.google_email,
        updated_at: connection.updatedAt
      }
    });

  } catch (error) {
    console.error("Error in Google Auth Callback:", error);
    return res.status(500).json({ success: false, message: "Failed to connect Google account" });
  }
};

exports.getConnectedAccounts = async (req, res) => {
  try {
    const userId = req.user.id;
    const tenantConnection = req.tenantConnection;
    const mongoose = require("mongoose");

    const GoogleConnection = tenantConnection.models.GoogleConnection || tenantConnection.model("GoogleConnection", googleConnectionSchema, "google_connections");
    const connections = await GoogleConnection.find({ user_id: new mongoose.Types.ObjectId(userId) }).select("google_email").lean();

    return res.status(200).json({
      success: true,
      connections: connections.map(c => c.google_email).filter(Boolean)
    });
  } catch (error) {
    console.error("Error retrieving connected Google accounts:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
