require("dotenv").config();
const express = require("express");
const cors = require("cors");

// Import các module dịch vụ cho các đường dẫn khác nhau
// Legacy modules
const hanetService = require("./hanetService");
const getAllPlace = require("./getPlaceId");
const getDeviceById = require("./getDeviceByPlaceId");
const hanetServiceId = require("./hanetServiceId");

// Kaipany modules
const kaipanyHanetService = require("./kaipanyHanetService");

// Ladyfit modules
const ladyfitHanetService = require("./ladyfitHanetService");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(
  cors({
    origin: [
      "https://client-i1vo1qjv7-fugboizzs-projects.vercel.app",
      "http://localhost:3000",
    ],
  })
);
app.use(express.json());

// Middleware logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${
        res.statusCode
      } (${duration}ms)`
    );
  });
  next();
});

// Health check route
app.get("/", (req, res) => {
  res.send("API Server is running! Available routes: /api, /Kaipany, /Ladyfit");
});

// Legacy API routes (giữ nguyên để đảm bảo tương thích ngược)
app.get("/api", (req, res) => {
  res.send("API Server is running! (Legacy API)");
});

app.get("/api/people", async (req, res, next) => {
  try {
    const peopleData = await hanetService.getPeopleListByPlace();
    res.status(200).json({ success: true, data: peopleData });
  } catch (error) {
    next(error);
  }
});

app.get("/api/place", async (req, res, next) => {
  try {
    const placeData = await getAllPlace.getAllPlace();
    res.status(200).json({ success: true, data: placeData });
  } catch (error) {
    next(error);
  }
});

app.get("/api/device", async (req, res, next) => {
  try {
    const placeId = req.query.placeId;
    if (!placeId) {
      return res.status(400).json({
        success: false,
        message: "Thiếu tham số bắt buộc: placeId",
      });
    }

    const deviceData = await getDeviceById.getDeviceById(placeId);
    res.status(200).json({ success: true, data: deviceData });
  } catch (error) {
    next(error);
  }
});

// Middleware kiểm tra tham số cho route checkins
const validateCheckinParams = (req, res, next) => {
  const { placeId, dateFrom, dateTo } = req.query;

  if (!placeId) {
    return res.status(400).json({
      success: false,
      message: "Thiếu tham số bắt buộc: placeId",
    });
  }

  if (!dateFrom) {
    return res.status(400).json({
      success: false,
      message: "Thiếu tham số bắt buộc: dateFrom",
    });
  }

  if (!dateTo) {
    return res.status(400).json({
      success: false,
      message: "Thiếu tham số bắt buộc: dateTo",
    });
  }

  const fromTimestamp = parseInt(dateFrom, 10);
  const toTimestamp = parseInt(dateTo, 10);

  if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
    return res.status(400).json({
      success: false,
      message: "dateFrom và dateTo phải là millisecond timestamp hợp lệ.",
    });
  }

  if (fromTimestamp > toTimestamp) {
    return res.status(400).json({
      success: false,
      message: "Thời gian bắt đầu không được muộn hơn thời gian kết thúc.",
    });
  }

  // Lưu timestamp đã được validate vào request object
  req.validatedParams = {
    placeId,
    fromTimestamp,
    toTimestamp,
    devices: req.query.devices,
  };

  next();
};

app.get("/api/checkins", validateCheckinParams, async (req, res, next) => {
  try {
    const { placeId, fromTimestamp, toTimestamp, devices } =
      req.validatedParams;

    console.log(
      `[${new Date().toISOString()}] Nhận yêu cầu lấy checkin cho placeId: ${placeId}, từ: ${fromTimestamp}, đến: ${toTimestamp}, devices: ${
        devices || "Tất cả"
      }`
    );

    const filteredCheckins = await hanetServiceId.getPeopleListByMethod(
      placeId,
      fromTimestamp,
      toTimestamp,
      devices
    );

    console.log(
      `[${new Date().toISOString()}] Trả về ${
        Array.isArray(filteredCheckins) ? filteredCheckins.length : "kết quả"
      } checkin.`
    );

    res.status(200).json(filteredCheckins);
  } catch (err) {
    next(err);
  }
});

// ================= KAIPANY API ROUTES =================
// Middleware kiểm tra tham số cho Kaipany checkins
const validateKaipanyCheckinParams = (req, res, next) => {
  const { placeId, dateFrom, dateTo } = req.query;

  if (!placeId) {
    return res.status(400).json({
      success: false,
      message: "Thiếu tham số bắt buộc: placeId",
    });
  }

  if (!dateFrom) {
    return res.status(400).json({
      success: false,
      message: "Thiếu tham số bắt buộc: dateFrom",
    });
  }

  if (!dateTo) {
    return res.status(400).json({
      success: false,
      message: "Thiếu tham số bắt buộc: dateTo",
    });
  }

  const fromTimestamp = parseInt(dateFrom, 10);
  const toTimestamp = parseInt(dateTo, 10);

  if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
    return res.status(400).json({
      success: false,
      message: "dateFrom và dateTo phải là millisecond timestamp hợp lệ.",
    });
  }

  if (fromTimestamp > toTimestamp) {
    return res.status(400).json({
      success: false,
      message: "Thời gian bắt đầu không được muộn hơn thời gian kết thúc.",
    });
  }

  // Lưu timestamp đã được validate vào request object
  req.validatedParams = {
    placeId,
    fromTimestamp,
    toTimestamp,
    devices: req.query.devices,
  };

  next();
};

// Định nghĩa route prefix cho Kaipany
app.get("/Kaipany", (req, res) => {
  res.send("Kaipany API Server is running!");
});

app.get("/Kaipany/place", async (req, res, next) => {
  try {
    const placeData = await kaipanyHanetService.getPlaceList();
    res.status(200).json({ success: true, data: placeData });
  } catch (error) {
    next(error);
  }
});

app.get("/Kaipany/device", async (req, res, next) => {
  try {
    const placeId = req.query.placeId;
    if (!placeId) {
      return res.status(400).json({
        success: false,
        message: "Thiếu tham số bắt buộc: placeId",
      });
    }

    const deviceData = await kaipanyHanetService.getDeviceList(placeId);
    res.status(200).json({ success: true, data: deviceData });
  } catch (error) {
    next(error);
  }
});

app.get("/Kaipany/checkins", validateKaipanyCheckinParams, async (req, res, next) => {
  try {
    const { placeId, fromTimestamp, toTimestamp, devices } =
      req.validatedParams;

    console.log(
      `[${new Date().toISOString()}] Kaipany: Nhận yêu cầu lấy checkin cho placeId: ${placeId}, từ: ${fromTimestamp}, đến: ${toTimestamp}, devices: ${
        devices || "Tất cả"
      }`
    );

    const filteredCheckins = await kaipanyHanetService.getPeopleListByMethod(
      placeId,
      fromTimestamp,
      toTimestamp,
      devices
    );

    console.log(
      `[${new Date().toISOString()}] Kaipany: Trả về ${
        Array.isArray(filteredCheckins) ? filteredCheckins.length : "kết quả"
      } checkin.`
    );

    res.status(200).json(filteredCheckins);
  } catch (err) {
    next(err);
  }
});

// ================= LADYFIT API ROUTES =================
// Middleware kiểm tra tham số cho Ladyfit checkins
const validateLadyfitCheckinParams = (req, res, next) => {
  const { placeId, dateFrom, dateTo } = req.query;

  if (!placeId) {
    return res.status(400).json({
      success: false,
      message: "Thiếu tham số bắt buộc: placeId",
    });
  }

  if (!dateFrom) {
    return res.status(400).json({
      success: false,
      message: "Thiếu tham số bắt buộc: dateFrom",
    });
  }

  if (!dateTo) {
    return res.status(400).json({
      success: false,
      message: "Thiếu tham số bắt buộc: dateTo",
    });
  }

  const fromTimestamp = parseInt(dateFrom, 10);
  const toTimestamp = parseInt(dateTo, 10);

  if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
    return res.status(400).json({
      success: false,
      message: "dateFrom và dateTo phải là millisecond timestamp hợp lệ.",
    });
  }

  if (fromTimestamp > toTimestamp) {
    return res.status(400).json({
      success: false,
      message: "Thời gian bắt đầu không được muộn hơn thời gian kết thúc.",
    });
  }

  // Lưu timestamp đã được validate vào request object
  req.validatedParams = {
    placeId,
    fromTimestamp,
    toTimestamp,
    devices: req.query.devices,
  };

  next();
};

// Định nghĩa route prefix cho Ladyfit
app.get("/Ladyfit", (req, res) => {
  res.send("Ladyfit API Server is running!");
});

app.get("/Ladyfit/place", async (req, res, next) => {
  try {
    const placeData = await ladyfitHanetService.getPlaceList();
    res.status(200).json({ success: true, data: placeData });
  } catch (error) {
    next(error);
  }
});

app.get("/Ladyfit/device", async (req, res, next) => {
  try {
    const placeId = req.query.placeId;
    if (!placeId) {
      return res.status(400).json({
        success: false,
        message: "Thiếu tham số bắt buộc: placeId",
      });
    }

    const deviceData = await ladyfitHanetService.getDeviceList(placeId);
    res.status(200).json({ success: true, data: deviceData });
  } catch (error) {
    next(error);
  }
});

app.get("/Ladyfit/checkins", validateLadyfitCheckinParams, async (req, res, next) => {
  try {
    const { placeId, fromTimestamp, toTimestamp, devices } =
      req.validatedParams;

    console.log(
      `[${new Date().toISOString()}] Ladyfit: Nhận yêu cầu lấy checkin cho placeId: ${placeId}, từ: ${fromTimestamp}, đến: ${toTimestamp}, devices: ${
        devices || "Tất cả"
      }`
    );

    const filteredCheckins = await ladyfitHanetService.getPeopleListByMethod(
      placeId,
      fromTimestamp,
      toTimestamp,
      devices
    );

    console.log(
      `[${new Date().toISOString()}] Ladyfit: Trả về ${
        Array.isArray(filteredCheckins) ? filteredCheckins.length : "kết quả"
      } checkin.`
    );

    res.status(200).json(filteredCheckins);
  } catch (err) {
    next(err);
  }
});

// ================= ERROR HANDLING MIDDLEWARE =================
const handleApiError = (err, req, res, next) => {
  console.error(`Lỗi trong route ${req.path}:`, err.message);
  console.error(err.stack);

  if (err.message && (err.message.startsWith("HANET Error 401") || 
                     err.message.startsWith("Kaipany: Lỗi xác thực") || 
                     err.message.startsWith("Ladyfit: Lỗi xác thực"))) {
    return res.status(401).json({
      success: false,
      message: "Lỗi xác thực với HANET API",
    });
  }

  if (err.message && err.message.includes("place not found")) {
    return res.status(404).json({
      success: false,
      message: "Không tìm thấy địa điểm",
    });
  }

  if (err.message && (err.message.startsWith("HANET API Error") ||
                     err.message.startsWith("Kaipany: Lỗi từ HANET API") ||
                     err.message.startsWith("Ladyfit: Lỗi từ HANET API"))) {
    return res.status(502).json({
      success: false,
      message: "Lỗi từ HANET API khi lấy dữ liệu",
      error: process.env.NODE_ENV === "production" ? undefined : err.message,
    });
  }

  res.status(500).json({
    success: false,
    message: "Lỗi máy chủ nội bộ",
    error: process.env.NODE_ENV === "production" ? undefined : err.message,
  });
};

app.use(handleApiError);

// Start server
if (process.env.PORT !== "production") {
  app.listen(PORT, () => {
    console.log(`Server đang lắng nghe trên cổng ${PORT}`);
    console.log(`Truy cập tại: http://localhost:${PORT}`);
    console.log(`Các đường dẫn API có sẵn:`);
    console.log(`- Legacy API: http://localhost:${PORT}/api`);
    console.log(`- Kaipany API: http://localhost:${PORT}/Kaipany`);
    console.log(`- Ladyfit API: http://localhost:${PORT}/Ladyfit`);
  });
}

module.exports = app;
