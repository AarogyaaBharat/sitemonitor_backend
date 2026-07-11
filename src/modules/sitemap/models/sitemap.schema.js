const mongoose = require("mongoose");

const sitemapSchema = new mongoose.Schema(
  {
    domainId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Domain",
      required: true,
    },
    domainUrl: {
      type: String,
      required: true,
    },
    sitemapUrl: {
      type: String,
      required: true,
    },
    urlsCount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["success", "failed", "pending"],
      default: "pending",
    },
    error: {
      type: String,
      default: null,
    },
    lastScanned: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = { sitemapSchema };
