const express = require("express");
const router = express.Router();
const gscController = require("../controllers/gsc.controller.js");
const { authMiddleware } = require("../../../common/middlewares/auth.middleware.js");

// Routes
router.get("/validate", authMiddleware, gscController.validateGscConnection);

module.exports = router;
