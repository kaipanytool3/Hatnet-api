// ladyfitHanetService.js
require("dotenv").config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require("axios");
const qs = require("qs");
const tokenManager = require("./ladyfitTokenManager");
const HANET_API_BASE_URL = process.env.LADYFIT_HANET_API_BASE_URL || "https://partner.hanet.ai";

if (!process.env.LADYFIT_HANET_API_BASE_URL) {
  console.error("Lỗi: Biến môi trường LADYFIT_HANET_API_BASE_URL chưa được thiết lập.");
  console.log("Sử dụng URL mặc định https://partner.hanet.ai");
}

function filterCheckinsByDay(data) {
  try {
    if (!data || !data.data || !Array.isArray(data.data)) {
      console.error("Dữ liệu đầu vào không hợp lệ!");
      return [];
    }

    const validCheckins = data.data.filter(
      (item) =>
        item.personID &&
        item.personID !== "" &&
        item.personName &&
        item.personName !== ""
    );

    // Tạo một đối tượng tạm để theo dõi lần check-in đầu tiên và checkout cuối cùng của mỗi người theo ngày
    const personCheckins = {};

    validCheckins.forEach((checkin) => {
      const date = checkin.date;
      const personKey = `${date}_${checkin.personID}`;
      const checkinTime = parseInt(checkin.checkinTime);

      // Nếu chưa có thông tin cho person này, tạo mới
      if (!personCheckins[personKey]) {
        personCheckins[personKey] = {
          personName: checkin.personName !== undefined ? checkin.personName : "",
          personID: checkin.personID,
          aliasID: checkin.aliasID !== undefined ? checkin.aliasID : "",
          placeID: checkin.placeID !== undefined ? checkin.placeID : null,
          title: checkin.title
            ? typeof checkin.title === "string"
              ? checkin.title.trim()
              : "N/A"
            : "Khách hàng",
          type: checkin.type !== undefined ? checkin.type : null,
          deviceID: checkin.deviceID !== undefined ? checkin.deviceID : "",
          deviceName: checkin.deviceName !== undefined ? checkin.deviceName : "",
          date: checkin.date,
          checkinTime: checkinTime,  // Timestamp cho check-in sớm nhất
          checkoutTime: checkinTime,  // Ban đầu checkout = checkin
          formattedCheckinTime: formatTimestamp(checkinTime),
          formattedCheckoutTime: formatTimestamp(checkinTime),
        };
      } else {
        // Cập nhật thời gian check-in sớm nhất và check-out muộn nhất
        if (checkinTime < personCheckins[personKey].checkinTime) {
          personCheckins[personKey].checkinTime = checkinTime;
          personCheckins[personKey].formattedCheckinTime = formatTimestamp(checkinTime);
        }
        
        if (checkinTime > personCheckins[personKey].checkoutTime) {
          personCheckins[personKey].checkoutTime = checkinTime;
          personCheckins[personKey].formattedCheckoutTime = formatTimestamp(checkinTime);
        }
      }
    });

    // Sắp xếp kết quả theo thời gian check-in
    const result = Object.values(personCheckins).sort(
      (a, b) => a.checkinTime - b.checkinTime
    );

    return result;
  } catch (error) {
    console.error("Lỗi khi xử lý dữ liệu:", error);
    return [];
  }
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

async function getPeopleListByMethod(placeId, dateFrom, dateTo, devices) {
  let accessToken;
  try {
    accessToken = await tokenManager.getValidHanetToken();
  } catch (refreshError) {
    console.error("Ladyfit: Không thể lấy được token hợp lệ:", refreshError.message);
    throw new Error(`Ladyfit: Lỗi xác thực với HANET: ${refreshError.message}`);
  }
  if (!accessToken) {
    throw new Error("Ladyfit: Không lấy được Access Token hợp lệ.");
  }
  let rawCheckinData = [];
  for (let index = 1; index <= 100000; index++) {
    const apiUrl = `${HANET_API_BASE_URL}/person/getCheckinByPlaceIdInTimestamp`;
    const requestData = {
      token: accessToken,
      placeID: placeId,
      from: dateFrom,
      to: dateTo,
      ...(devices && { devices: devices }),
      size: 500,
      page: index,
    };
    const config = {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
    };

    try {
      console.log(`Ladyfit: Đang gọi HANET API cho placeID=${placeId}...`);
      const response = await axios.post(
        apiUrl,
        qs.stringify(requestData),
        config
      );
      if (response.data && typeof response.data.returnCode !== "undefined") {
        if (response.data.returnCode === 1 || response.data.returnCode === 0) {
          console.log(`Ladyfit: Gọi HANET API thành công cho placeID=${placeId}.`);
          if (Array.isArray(response.data.data)) {
            if (response.data.data.length === 0) {
              // Nếu trang không có dữ liệu, thoát vòng lặp
              console.log(`Ladyfit: Không còn dữ liệu ở trang ${index}, dừng truy vấn.`);
              break;
            }
            rawCheckinData = [...rawCheckinData, ...response.data.data];
            console.log(
              `Ladyfit: Đã nhận tổng cộng ${rawCheckinData.length} bản ghi check-in.`
            );
          } else {
            console.warn(
              `Ladyfit: Dữ liệu trả về cho placeID ${placeId} không phải mảng hoặc không có.`
            );
            break;
          }
        } else {
          console.error(
            `Ladyfit: Lỗi logic từ HANET cho placeID=${placeId}: Mã lỗi ${
              response.data.returnCode
            }, Thông điệp: ${response.data.returnMessage || "N/A"}`
          );
        }
      } else {
        console.error(
          `Ladyfit: Response không hợp lệ từ HANET cho placeID=${placeId}:`,
          response.data
        );
      }
    } catch (error) {
      if (error.code === "ECONNABORTED") {
        console.error(`Ladyfit: Lỗi timeout khi gọi API cho placeID=${placeId}.`);
      } else {
        console.error(
          `Ladyfit: Lỗi mạng/request khi gọi ${apiUrl} cho placeID=${placeId}:`,
          error.response?.data || error.message
        );
      }
      console.warn(
        `Ladyfit: Không lấy được dữ liệu cho địa điểm ${placeId} do lỗi request.`
      );
    }
  }

  return filterCheckinsByDay({ data: rawCheckinData });
}

async function getPlaceList() {
  let accessToken;
  try {
    accessToken = await tokenManager.getValidHanetToken();
  } catch (refreshError) {
    console.error("Ladyfit: Không thể lấy được token hợp lệ:", refreshError.message);
    throw new Error(`Ladyfit: Lỗi xác thực với HANET: ${refreshError.message}`);
  }

  if (!accessToken) {
    throw new Error("Ladyfit: Không lấy được Access Token hợp lệ.");
  }

  const apiUrl = `${HANET_API_BASE_URL}/place/getPlaces`;
  const requestData = {
    token: accessToken,
  };
  const config = {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 10000,
  };

  try {
    console.log("Ladyfit: Đang gọi HANET API để lấy danh sách địa điểm...");
    const response = await axios.post(apiUrl, qs.stringify(requestData), config);
    
    if (response.data && response.data.returnCode === 1) {
      console.log("Ladyfit: Lấy danh sách địa điểm thành công.");
      return response.data.data || [];
    } else {
      console.error(
        "Ladyfit: Lỗi khi lấy danh sách địa điểm từ HANET:",
        response.data
      );
      throw new Error(
        `Ladyfit: Lỗi từ HANET API: ${response.data?.returnMessage || "Lỗi không xác định"}`
      );
    }
  } catch (error) {
    console.error(
      "Ladyfit: Lỗi khi gọi API lấy danh sách địa điểm:",
      error.response?.data || error.message
    );
    throw new Error(`Ladyfit: Không thể lấy danh sách địa điểm: ${error.message}`);
  }
}

async function getDeviceList(placeId) {
  let accessToken;
  try {
    accessToken = await tokenManager.getValidHanetToken();
  } catch (refreshError) {
    console.error("Ladyfit: Không thể lấy được token hợp lệ:", refreshError.message);
    throw new Error(`Ladyfit: Lỗi xác thực với HANET: ${refreshError.message}`);
  }

  if (!accessToken) {
    throw new Error("Ladyfit: Không lấy được Access Token hợp lệ.");
  }

  const apiUrl = `${HANET_API_BASE_URL}/device/getListDeviceByPlace`;
  const requestData = {
    token: accessToken,
    placeID: placeId,
  };
  const config = {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 10000,
  };

  try {
    console.log(`Ladyfit: Đang gọi HANET API để lấy danh sách thiết bị cho placeID=${placeId}...`);
    console.log(`Ladyfit: URL API: ${apiUrl}`);
    console.log(`Ladyfit: Token: ${accessToken ? accessToken.substring(0, 10) + '...' : 'null'}`);
    
    const response = await axios.post(apiUrl, qs.stringify(requestData), config);
    
    if (response.data && response.data.returnCode === 1) {
      console.log(`Ladyfit: Lấy danh sách thiết bị cho placeID=${placeId} thành công.`);
      return response.data.data || [];
    } else {
      console.error(
        `Ladyfit: Lỗi khi lấy danh sách thiết bị từ HANET cho placeID=${placeId}:`,
        response.data
      );
      throw new Error(
        `Ladyfit: Lỗi từ HANET API: ${response.data?.returnMessage || "Lỗi không xác định"}`
      );
    }
  } catch (error) {
    console.error(
      `Ladyfit: Lỗi khi gọi API lấy danh sách thiết bị cho placeID=${placeId}:`,
      error.response?.data || error.message
    );
    throw new Error(`Ladyfit: Không thể lấy danh sách thiết bị: ${error.message}`);
  }
}

module.exports = {
  getPeopleListByMethod,
  getPlaceList,
  getDeviceList
};
