const express = require("express");
const router = express.Router();
const authController = require("../controller/auth.controller.js");
const googleAuthController = require("../controller/google_auth.controller.js");
const { loginValidationMiddleware, refreshTokenValidationMiddleware } = require("../helper/auth.helper.js");
const { authMiddleware } = require("../../../common/middlewares/auth.middleware.js");

// Routes
router.post("/login", loginValidationMiddleware, authController.login);
router.post("/refresh-token", refreshTokenValidationMiddleware, authController.refreshToken);
router.post("/send-otp", authController.sendOTP);
router.post("/verify-otp", authController.verifyOTP);

// Google OAuth
router.get("/google/url", authMiddleware, googleAuthController.getGoogleAuthUrl);
router.get("/google/connections", authMiddleware, googleAuthController.getConnectedAccounts);
router.post("/google/callback", authMiddleware, googleAuthController.googleAuthCallback);
// Also allow GET for standard redirect, but client needs to pass tenant connection info (handled in controller via state or frontend interception)
router.get("/google/callback", googleAuthController.googleAuthCallback);

module.exports = router;
