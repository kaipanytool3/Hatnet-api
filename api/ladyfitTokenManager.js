// ladyfitTokenManager.js
const axios = require("axios");
const qs = require("qs");
const path = require('path');
require("dotenv").config({ path: path.resolve(__dirname, '../.env') });

// Sử dụng biến môi trường cụ thể cho Ladyfit
const HANET_TOKEN_URL = process.env.LADYFIT_HANET_TOKEN_URL || "https://oauth.hanet.com/token";
const HANET_CLIENT_ID = process.env.LADYFIT_HANET_CLIENT_ID;
const HANET_CLIENT_SECRET = process.env.LADYFIT_HANET_CLIENT_SECRET;
const HANET_REFRESH_TOKEN = process.env.LADYFIT_HANET_REFRESH_TOKEN;
console.log("LADYFIT ENV VARIABLES:", {
  TOKEN_URL: process.env.LADYFIT_HANET_TOKEN_URL,
  CLIENT_ID: process.env.LADYFIT_HANET_CLIENT_ID,
  CLIENT_SECRET: process.env.LADYFIT_HANET_CLIENT_SECRET,
  REFRESH_TOKEN: process.env.LADYFIT_HANET_REFRESH_TOKEN
});
console.log("KAIPANY ENV VARIABLES:", {
  TOKEN_URL: process.env.KAIPANY_HANET_TOKEN_URL,
  CLIENT_ID: process.env.KAIPANY_HANET_CLIENT_ID,
  CLIENT_SECRET: process.env.KAIPANY_HANET_CLIENT_SECRET,
  REFRESH_TOKEN: process.env.KAIPANY_HANET_REFRESH_TOKEN
});
let currentAccessToken = null;
let tokenExpiresAt = null;

async function refreshAccessToken() {
  console.log("Ladyfit: Đang yêu cầu làm mới Access Token từ HANET...");
  if (
    !HANET_REFRESH_TOKEN ||
    !HANET_CLIENT_ID ||
    !HANET_CLIENT_SECRET ||
    !HANET_TOKEN_URL
  ) {
    throw new Error(
      "Ladyfit: Thiếu thông tin cấu hình để làm mới token (kiểm tra .env)"
    );
  }

  const apiUrl = HANET_TOKEN_URL;
  const requestData = {
    grant_type: "refresh_token",
    client_id: HANET_CLIENT_ID,
    client_secret: HANET_CLIENT_SECRET,
    refresh_token: HANET_REFRESH_TOKEN,
  };
  const config = {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 10000,
  };

  try {
    const response = await axios.post(
      apiUrl,
      qs.stringify(requestData),
      config
    );
    if (response.data && response.data.access_token) {
      console.log("Ladyfit: Làm mới Access Token thành công.");
      const expiresIn = response.data.expires_in || 3600;
      currentAccessToken = response.data.access_token;
      tokenExpiresAt = Date.now() + expiresIn * 1000 - 60 * 1000;
      if (
        response.data.refresh_token &&
        response.data.refresh_token !== HANET_REFRESH_TOKEN
      ) {
        console.warn("Ladyfit: Nhận được Refresh Token mới từ HANET!");
      }

      return currentAccessToken;
    } else {
      console.error(
        "Ladyfit: Lỗi khi làm mới token, response không chứa access_token:",
        response.data
      );
      throw new Error(
        `Ladyfit: Lỗi làm mới token từ HANET: ${
          response.data?.returnMessage || "Phản hồi không hợp lệ"
        }`
      );
    }
  } catch (error) {
    console.error(
      "Ladyfit: Lỗi nghiêm trọng khi gọi API làm mới token:",
      error.response?.data || error.message
    );
    currentAccessToken = null;
    tokenExpiresAt = null;
    throw new Error(
      `Ladyfit: Không thể làm mới Access Token: ${
        error.response?.data?.returnMessage || error.message
      }`
    );
  }
}

async function getValidHanetToken() {
  const now = Date.now();
  if (currentAccessToken && tokenExpiresAt && now < tokenExpiresAt - 10000) {
    console.log("Ladyfit: Sử dụng Access Token từ bộ nhớ.");
    return currentAccessToken;
  }
  console.log(
    "Ladyfit: Access Token trong bộ nhớ không hợp lệ hoặc hết hạn, đang làm mới..."
  );
  return await refreshAccessToken();
}

module.exports = {
  getValidHanetToken,
};
