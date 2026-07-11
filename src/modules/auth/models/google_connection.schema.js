const mongoose = require("mongoose");

const googleConnectionSchema = new mongoose.Schema(
  {
    user_id: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "users", 
      required: true,
      unique: true // A user can only have one active Google Connection per tenant
    },
    google_email: { 
      type: String, 
      required: true 
    },
    access_token: { 
      type: String, 
      required: true 
    },
    refresh_token: { 
      type: String, 
      required: true // Encrypted
    },
    token_expiry: { 
      type: Number, 
      required: true 
    }
  },
  { timestamps: true }
);

module.exports = { googleConnectionSchema };
