const crypto = require("crypto");

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "SiteMonitorSecretKey2026Secure32";
const ALGORITHM = "aes-256-cbc";

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

const encryptionMiddleware = (req, res, next) => {
  const originalJson = res.json;
  const originalSend = res.send;
  
  // We hook both res.json and res.send because some routes might use res.send(object)
  res.json = function (body) {
    try {
      // Avoid encrypting twice if somehow called again
      if (body && body.encryptedData) {
        return originalJson.call(this, body);
      }
      
      const jsonString = JSON.stringify(body);
      const encryptedData = encrypt(jsonString);
      return originalJson.call(this, { encryptedData });
    } catch (error) {
      console.error("Encryption error:", error);
      return originalJson.call(this, body);
    }
  };

  res.send = function (body) {
    // If the body is an object, express converts it to json.
    // If we're sending string or buffer, we should probably let it be (e.g. HTML, files).
    // It's safest to only intercept res.json explicitly, but some routes might just res.send(json object)
    // To be safe, we will let res.json handle it if it's an object, and intercept send only if needed.
    // Express res.send internally calls res.json for objects. So we don't strictly need to intercept res.send for objects.
    // We'll leave res.send alone for strings/buffers to not break HTML/file downloads.
    return originalSend.call(this, body);
  };
  
  next();
};

module.exports = encryptionMiddleware;
