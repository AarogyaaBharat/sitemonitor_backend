const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // sequence name, e.g. "dm_id"
  seq: { type: Number, default: 0 },
});

const domainSchema = new mongoose.Schema({
  dm_id: {
    type: Number,
    unique: true,
    index: true,
  },
  // User Reference
  dm_user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true,
  },

  // Basic Info
  dm_title: {
    type: String,
    required: true,
    trim: true,
  },
  dm_url: {
    type: String,
    required: true,
    trim: true,
  },
  dm_gsc_email: {
    type: String,
    default: null,
    trim: true,
  },

  // Crawl Settings
  dm_crawl_auto: {
    type: Boolean,
    default: false,
  },
  dm_connections_per_min: {
    type: String,
    enum: ["normal", "slow", "faster", "very-fast", "superfast"],
    default: "normal",
  },
  dm_max_scanned_pages: {
    type: Number,
    default: 0,
  },
  dm_scan_subdomains: {
    type: Boolean,
    default: true,
  },

  // Scan Frequency
  dm_scan_frequency: {
    type: Number,
    default: 1,
  },
  dm_frequency_type: {
    type: String,
    enum: ["day", "week", "month", "quarter"],
    default: "day",
  },
  dm_scan_time: {
    type: String,
    default: "00:00", // HH:mm
  },
  dm_next_scan_at: {
    type: Date,
    index: true,
  },

  // SEO / Content Settings
  dm_spelling_ignore_caps: {
    type: Boolean,
    default: false,
  },
  dm_case_sensitive_urls: {
    type: Boolean,
    default: true,
  },
  dm_render_pages_execute_js: {
    type: Boolean,
    default: false,
  },
  dm_mark_403_as_broken: {
    type: Boolean,
    default: false,
  },
  dm_ignore_canonical_urls: {
    type: Boolean,
    default: false,
  },
  dm_use_language_attribute: {
    type: Boolean,
    default: true,
  },

  dm_custom_urls: [
    {
      type: String,
      trim: true,
    },
  ],
  dm_last_scan_error: {
    type: String,
    default: "",
  },

  // Filters
  dm_path_constraints: [
    {
      type: String,
      trim: true,
    },
  ],
  dm_exclude_patterns: [
    {
      type: String,
      trim: true,
    },
  ],
  dm_ignored_spellings: [
    {
      type: String,
      trim: true,
    },
  ],
  dm_terms_conditions: [
    {
      type: String,
      trim: true,
    },
  ],

  // Internal URLs (better structured)
  dm_internal_urls: [
    {
      operator: { type: String, enum: ["starts-with", "contains", "regex"] },
      url: { type: String },
    },
  ],

  // Accessibility
  dm_accessibility: {
    type: String,
    enum: ["none", "wcag2a", "wcag2aa", "wcag2aaa"],
    default: "none",
  },

  // Code Excludes
  dm_source_code_excludes: {
    type: String,
    default: "",
  },

  // Readability
  dm_readability: {
    type: String,
    enum: ["none", "basic", "standard", "advanced"],
    default: "none",
  },

  // Status
  dm_status: {
    type: String,
    enum: ["active", "inactive", "suspended", "scanning", "completed", "failed"],
    default: "active",
  },

  // SEO Status
  dm_seo_status: {
    type: String,
    enum: ['pending', 'scanning', 'completed', 'failed'],
    default: 'pending'
  },

  dm_accessibility_status: {
    type: String,
    enum: ['pending', 'scanning', 'completed', 'failed'],
    default: 'pending'
  },
  dm_accessibility_last_scan_at: { type: Date },
  dm_policy_status: {
    type: String,
    enum: ['pending', 'scanning', 'completed', 'failed'],
    default: 'pending'
  },
  dm_policy_last_scan_at: { type: Date },
  
  dm_dark_pattern_status: {
    type: String,
    enum: ['pending', 'scanning', 'completed', 'failed'],
    default: 'pending'
  },
  dm_dark_pattern_last_scan_at: { type: Date },

  dm_ignored_spellings: [{ type: String }],

  dm_qa_status: {
    type: String,
    enum: ['pending', 'scanning', 'completed', 'failed'],
    default: 'pending',
  },
  dm_qa_last_scan_at: {
    type: Date,
    default: null,
  },

  // Soft Delete
  dm_is_deleted: {
    type: Boolean,
    default: false,
    index: true,
  },
  dm_is_archived: {
    type: Boolean,
    default: false,
    index: true,
  },
  dm_deleted_at: {
    type: Date,
    default: null,
  },
  dm_deleted_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    default: null,
  },

  // Audit Fields
  dm_created_at: {
    type: Date,
    default: Date.now,
  },
  dm_created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    default: null,
  },
  dm_updated_at: {
    type: Date,
    default: null,
  },
  dm_updated_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    default: null,
  },
},
  {
    collection: "domains",
    timestamps: false,
  }
);

// Pre-save hook to auto-increment dm_id for new documents
domainSchema.pre("save", async function (next) {
  if (!this.isNew || this.dm_id != null) {
    return next();
  }

  try {
    const connection = this.constructor.db;

    const Counter =
      connection.models.Counter ||
      connection.model("Counter", counterSchema, "counters");

    const counter = await Counter.findByIdAndUpdate(
      "dm_id",
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    this.dm_id = counter.seq;
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = {
  domainSchema,
};