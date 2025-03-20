const axios = require("axios");

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

function exchangeCodeForToken(code) {
  return axios.post(
    "https://discord.com/api/v10/oauth2/token",
    new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI,
      scope: "identify",
    }),
  );
}

function getUser(token) {
  return axios.get("https://discord.com/api/v10/users/@me", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

function getUserById(userId) {
  return axios.get("https://discord.com/api/v10/users/" + userId, {
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
    },
  });
}

module.exports = {
  exchangeCodeForToken,
  getUser,
  getUserById,
};
