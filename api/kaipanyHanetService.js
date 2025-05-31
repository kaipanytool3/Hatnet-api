// kaipanyHanetService.js
require("dotenv").config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require("axios");
const qs = require("qs");
const tokenManager = require("./kaipanyTokenManager");
const HANET_API_BASE_URL = process.env.KAIPANY_HANET_API_BASE_URL;

if (!HANET_API_BASE_URL) {
  console.error("Lỗi: Biến môi trường KAIPANY_HANET_API_BASE_URL chưa được thiết lập.");
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
    console.error("Kaipany: Không thể lấy được token hợp lệ:", refreshError.message);
    throw new Error(`Kaipany: Lỗi xác thực với HANET: ${refreshError.message}`);
  }
  if (!accessToken) {
    throw new Error("Kaipany: Không lấy được Access Token hợp lệ.");
  }

  // Chuyển đổi dateFrom, dateTo từ string sang số
  const fromTime = parseInt(dateFrom);
  const toTime = parseInt(dateTo);
  
  // Kiểm tra nếu khoảng thời gian > 30 ngày (2,592,000,000 milliseconds)
  const MAX_TIME_RANGE = 30 * 24 * 60 * 60 * 1000; // 30 ngày
  const timeRange = toTime - fromTime;
  
  let rawCheckinData = [];
  
  // Nếu khoảng thời gian > 30 ngày, chia thành nhiều chu kỳ 30 ngày
  if (timeRange > MAX_TIME_RANGE) {
    console.log(`Kaipany: Khoảng thời gian > 30 ngày, chia thành nhiều chu kỳ nhỏ hơn`);
    
    let currentStart = fromTime;
    let chunks = 0;
    
    while (currentStart < toTime) {
      // Tính điểm kết thúc cho chu kỳ hiện tại
      let currentEnd = Math.min(currentStart + MAX_TIME_RANGE, toTime);
      chunks++;
      
      console.log(`Kaipany: Đang lấy dữ liệu chu kỳ #${chunks}: ${new Date(currentStart).toLocaleDateString()} - ${new Date(currentEnd).toLocaleDateString()}`);
      
      // Lấy dữ liệu cho chu kỳ hiện tại
      const chunkData = await fetchCheckinDataForTimeRange(placeId, currentStart, currentEnd, devices, accessToken);
      rawCheckinData = [...rawCheckinData, ...chunkData];
      
      // Tiến đến chu kỳ tiếp theo
      currentStart = currentEnd + 1;
    }
    
    console.log(`Kaipany: Đã lấy dữ liệu từ tất cả ${chunks} chu kỳ, tổng cộng ${rawCheckinData.length} bản ghi`);
  } else {
    // Khoảng thời gian < 30 ngày, xử lý thông thường
    console.log(`Kaipany: Khoảng thời gian < 30 ngày, xử lý thông thường`);
    rawCheckinData = await fetchCheckinDataForTimeRange(placeId, fromTime, toTime, devices, accessToken);
  }
  
  return filterCheckinsByDay({ data: rawCheckinData });
}

async function fetchCheckinDataForTimeRange(placeId, dateFrom, dateTo, devices, accessToken) {
  let rawCheckinData = [];
  
  for (let index = 1; index <= 100000; index++) {
    const apiUrl = `${HANET_API_BASE_URL}/person/getCheckinByPlaceIdInTimestamp`;
    const requestData = {
      token: accessToken,
      placeID: placeId,
      from: dateFrom,
      to: dateTo,
      ...(devices && { devices: devices }),
      size: 1000, // Tăng kích thước trang lên 1000 để lấy nhiều kết quả hơn mỗi trang
      page: index,
    };
    const config = {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
    };

    try {
      console.log(`Kaipany: Đang gọi HANET API cho placeID=${placeId}, trang ${index}...`);
      const response = await axios.post(
        apiUrl,
        qs.stringify(requestData),
        config
      );
      if (response.data && typeof response.data.returnCode !== "undefined") {
        if (response.data.returnCode === 1 || response.data.returnCode === 0) {
          console.log(`Kaipany: Gọi HANET API thành công cho placeID=${placeId}.`);
          if (Array.isArray(response.data.data)) {
            if (response.data.data.length === 0) {
              // Nếu trang không có dữ liệu, thoát vòng lặp
              console.log(`Kaipany: Không còn dữ liệu ở trang ${index}, dừng truy vấn.`);
              break;
            }
            rawCheckinData = [...rawCheckinData, ...response.data.data];
            console.log(
              `Kaipany: Đã nhận tổng cộng ${rawCheckinData.length} bản ghi check-in.`
            );
          } else {
            console.warn(
              `Kaipany: Dữ liệu trả về cho placeID ${placeId} không phải mảng hoặc không có.`
            );
            break;
          }
        } else {
          console.error(
            `Kaipany: Lỗi logic từ HANET cho placeID=${placeId}: Mã lỗi ${
              response.data.returnCode
            }, Thông điệp: ${response.data.returnMessage || "N/A"}`
          );
        }
      } else {
        console.error(
          `Kaipany: Response không hợp lệ từ HANET cho placeID=${placeId}:`,
          response.data
        );
      }
    } catch (error) {
      if (error.code === "ECONNABORTED") {
        console.error(`Kaipany: Lỗi timeout khi gọi API cho placeID=${placeId}.`);
      } else {
        console.error(
          `Kaipany: Lỗi mạng/request khi gọi ${apiUrl} cho placeID=${placeId}:`,
          error.response?.data || error.message
        );
      }
      console.warn(
        `Kaipany: Không lấy được dữ liệu cho địa điểm ${placeId} do lỗi request.`
      );
    }
  }

  return rawCheckinData;
}

async function getPlaceList() {
  let accessToken;
  try {
    console.log("Kaipany: Bắt đầu lấy token từ tokenManager...");
    accessToken = await tokenManager.getValidHanetToken();
    console.log("Kaipany: Lấy token thành công, token:", accessToken ? accessToken.substring(0, 10) + '...' : 'null');
  } catch (refreshError) {
    console.error("Kaipany: Không thể lấy được token hợp lệ:", refreshError.message);
    console.error("Kaipany: Chi tiết lỗi:", refreshError.stack);
    throw new Error(`Kaipany: Lỗi xác thực với HANET: ${refreshError.message}`);
  }

  if (!accessToken) {
    console.error("Kaipany: Token trả về từ tokenManager là null hoặc rỗng");
    throw new Error("Kaipany: Không lấy được Access Token hợp lệ.");
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
    console.log("Kaipany: Đang gọi HANET API để lấy danh sách địa điểm...");
    console.log("Kaipany: URL API:", apiUrl);
    console.log("Kaipany: Request data:", { token: accessToken ? accessToken.substring(0, 10) + '...' : 'null' });
    
    const response = await axios.post(apiUrl, qs.stringify(requestData), config);
    
    console.log("Kaipany: API response status:", response.status);
    console.log("Kaipany: API response returnCode:", response.data?.returnCode);
    
    if (response.data && response.data.returnCode === 1) {
      console.log("Kaipany: Lấy danh sách địa điểm thành công.");
      console.log("Kaipany: Số lượng địa điểm:", Array.isArray(response.data.data) ? response.data.data.length : 'unknown');
      return response.data.data || [];
    } else {
      console.error(
        "Kaipany: Lỗi khi lấy danh sách địa điểm từ HANET:",
        JSON.stringify(response.data)
      );
      throw new Error(
        `Kaipany: Lỗi từ HANET API: ${response.data?.returnMessage || "Lỗi không xác định"}`
      );
    }
  } catch (error) {
    console.error("Kaipany: Lỗi khi gọi API lấy danh sách địa điểm:");
    
    if (error.response) {
      // Lỗi từ phản hồi của server
      console.error("Kaipany: Lỗi từ phản hồi của server:");
      console.error("Kaipany: Status:", error.response.status);
      console.error("Kaipany: Data:", JSON.stringify(error.response.data));
      console.error("Kaipany: Headers:", JSON.stringify(error.response.headers));
    } else if (error.request) {
      // Lỗi không nhận được phản hồi
      console.error("Kaipany: Không nhận được phản hồi từ server:", error.request);
    } else {
      // Lỗi khác
      console.error("Kaipany: Lỗi chung:", error.message);
    }
    console.error("Kaipany: Stack trace:", error.stack);
    
    throw new Error(`Kaipany: Không thể lấy danh sách địa điểm: ${error.message}`);
  }
}

async function getDeviceList(placeId) {
  let accessToken;
  try {
    accessToken = await tokenManager.getValidHanetToken();
  } catch (refreshError) {
    console.error("Kaipany: Không thể lấy được token hợp lệ:", refreshError.message);
    throw new Error(`Kaipany: Lỗi xác thực với HANET: ${refreshError.message}`);
  }

  if (!accessToken) {
    throw new Error("Kaipany: Không lấy được Access Token hợp lệ.");
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
    console.log(`Kaipany: Đang gọi HANET API để lấy danh sách thiết bị cho placeID=${placeId}...`);
    const response = await axios.post(apiUrl, qs.stringify(requestData), config);
    
    if (response.data && response.data.returnCode === 1) {
      console.log(`Kaipany: Lấy danh sách thiết bị cho placeID=${placeId} thành công.`);
      return response.data.data || [];
    } else {
      console.error(
        `Kaipany: Lỗi khi lấy danh sách thiết bị từ HANET cho placeID=${placeId}:`,
        response.data
      );
      throw new Error(
        `Kaipany: Lỗi từ HANET API: ${response.data?.returnMessage || "Lỗi không xác định"}`
      );
    }
  } catch (error) {
    console.error(
      `Kaipany: Lỗi khi gọi API lấy danh sách thiết bị cho placeID=${placeId}:`,
      error.response?.data || error.message
    );
    throw new Error(`Kaipany: Không thể lấy danh sách thiết bị: ${error.message}`);
  }
}

module.exports = {
  getPeopleListByMethod,
  getPlaceList,
  getDeviceList
};
