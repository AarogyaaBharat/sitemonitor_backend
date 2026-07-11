const { google } = require("googleapis");

const getOAuth2Client = () => {
  return new google.auth.OAuth2(
    process.env.GSC_CLIENT_ID,
    process.env.GSC_CLIENT_SECRET,
    process.env.GSC_REDIRECT_URI
  );
};

const getAuthUrl = (state) => {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/webmasters.readonly",
      "https://www.googleapis.com/auth/userinfo.email"
    ],
    state: state
  });
};

const getTokensFromCode = async (code) => {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
};

const getUserEmail = async (tokens) => {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();
  return userInfo.data.email;
};

module.exports = {
  getOAuth2Client,
  getAuthUrl,
  getTokensFromCode,
  getUserEmail
};
