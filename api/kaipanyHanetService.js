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
  if (!placeId) {
    throw new Error("Thiếu tham số placeId");
  }

  if (!dateFrom || !dateTo) {
    throw new Error("Thiếu tham số dateFrom hoặc dateTo");
  }

  // Ghi nhận thởi điểm bắt đầu truy vấn để theo dõi thời gian xử lý
  const startTime = Date.now();
  console.log(`Kaipany: Bắt đầu truy vấn cho placeId=${placeId} từ ${new Date(parseInt(dateFrom)).toLocaleDateString()} đến ${new Date(parseInt(dateTo)).toLocaleDateString()}`);

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
  
  // Tối ưu hóa khoảng thời gian cho môi trường Serverless
  const ONE_DAY = 24 * 60 * 60 * 1000; // 1 ngày = 86,400,000 ms
  
  // Tính toán khoảng thời gian tối ưu dựa vào độ dài của khoảng thời gian
  // Nếu truy vấn cho một năm (365 ngày), chúng ta sẽ chia thành các đoạn lớn hơn
  const timeRange = toTime - fromTime;
  const totalDays = Math.ceil(timeRange / ONE_DAY);
  
  // Điều chỉnh kích thước đoạn dựa trên tổng thời gian truy vấn
  let CHUNK_SIZE;
  if (totalDays > 180) { // > 6 tháng
    CHUNK_SIZE = 60 * ONE_DAY; // Đoạn 60 ngày
  } else {
    CHUNK_SIZE = 30 * ONE_DAY; // Đoạn 30 ngày mặc định
  }
  
  console.log(`Kaipany: Truy vấn cho ${totalDays} ngày, chia thành các đoạn ${Math.ceil(CHUNK_SIZE / ONE_DAY)} ngày`);
  
  let rawCheckinData = [];
  
  // Thực hiện truy vấn từng đoạn thời gian
  let currentStart = fromTime;
  let chunks = 0;
  let totalResults = 0;
  
  while (currentStart < toTime) {
    chunks++;
    // Tính điểm kết thúc cho chu kỳ hiện tại
    let currentEnd = Math.min(currentStart + CHUNK_SIZE, toTime);
    
    // Kiểm tra tính hợp lệ của timestamp trước khi gọi API
    if (isNaN(currentStart) || isNaN(currentEnd)) {
      console.error(`Kaipany: Timestamp không hợp lệ cho đoạn #${chunks}: currentStart=${currentStart}, currentEnd=${currentEnd}`);
      currentStart = currentEnd; // Bỏ qua đoạn này nếu timestamp không hợp lệ
      continue;
    }
    
    console.log(`Kaipany: Đang lấy dữ liệu đoạn #${chunks}/${Math.ceil(timeRange/CHUNK_SIZE)}: ${new Date(currentStart).toLocaleDateString()} - ${new Date(currentEnd).toLocaleDateString()}`);
    
    try {
      // Lấy dữ liệu cho đoạn hiện tại
      const chunkData = await fetchCheckinDataForTimeRange(placeId, currentStart, currentEnd, devices, accessToken);
      
      // Thêm dữ liệu vào kết quả
      totalResults += chunkData.length;
      rawCheckinData = [...rawCheckinData, ...chunkData];
      
      console.log(`Kaipany: Hoàn thành đoạn #${chunks} - Nhận được ${chunkData.length} kết quả (Tổng: ${totalResults})`);
    } catch (error) {
      console.error(`Kaipany: Lỗi khi lấy dữ liệu cho đoạn #${chunks}:`, error.message);
    }
    
    // Tiến đến chu kỳ tiếp theo
    currentStart = currentEnd;
  }
  
  console.log(`Kaipany: Đã lấy dữ liệu từ tất cả ${chunks} chu kỳ, tổng cộng ${rawCheckinData.length} bản ghi`); 
  
  console.log(`Kaipany: Đã lấy xong tất cả dữ liệu, tổng số bản ghi: ${rawCheckinData.length}`);
  
  // Xử lý và lọc dữ liệu check-in theo ngày
  const result = filterCheckinsByDay({ data: rawCheckinData });
  
  // Ghi nhận thời gian hoàn thành và thông báo
  const processingTime = (Date.now() - startTime) / 1000;
  console.log(`Kaipany: Hoàn thành xử lý trong ${processingTime.toFixed(2)} giây, trả về ${result.length} kết quả đã lọc`);
  
  return result;
}

async function fetchCheckinDataForTimeRange(placeId, dateFrom, dateTo, devices, accessToken) {
  let rawCheckinData = [];
  
  // Tăng số trang tối đa để đảm bảo lấy hết kết quả, nhưng giới hạn ở một mức hợp lý
  // Giới hạn MAX_PAGES để tránh truy vấn quá nhiều trang không cần thiết
  const MAX_PAGES = 50000;
  let emptyPagesCount = 0;
  
  for (let index = 1; index <= MAX_PAGES; index++) {
    const apiUrl = `${HANET_API_BASE_URL}/person/getCheckinByPlaceIdInTimestamp`;
    // Đảm bảo timestamp là số nguyên
    const fromTimestamp = parseInt(dateFrom);
    const toTimestamp = parseInt(dateTo);
  
    // Kiểm tra tính hợp lệ của timestamp
    if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
      console.error(`Kaipany: Timestamp không hợp lệ: from=${dateFrom}, to=${dateTo}`);
      throw new Error('Timestamp không hợp lệ');
    }
  
    // Log ra giá trị thời gian đã chuyển đổi để debug
    console.log(`Kaipany: Timestamp đã chuyển đổi: from=${fromTimestamp} (${new Date(fromTimestamp).toISOString()}), to=${toTimestamp} (${new Date(toTimestamp).toISOString()})`);
  
    const requestData = {
      token: accessToken,
      placeID: placeId,
      from: fromTimestamp,
      to: toTimestamp,
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
              // Nếu trang không có dữ liệu, tăng bộ đếm trang trống
              emptyPagesCount++;
              console.log(`Kaipany: Không có dữ liệu ở trang ${index}, đã gặp ${emptyPagesCount} trang trống.`);
              
              // Chỉ dừng nếu gặp nhiều trang trống liên tiếp
              if (emptyPagesCount >= 3) {
                console.log(`Kaipany: Đã gặp ${emptyPagesCount} trang trống liên tiếp, dừng truy vấn.`);
                break;
              }
              
              // Tiếp tục vòng lặp để kiểm tra các trang tiếp theo
              continue;
            }
            
            // Reset bộ đếm trang trống nếu có dữ liệu
            emptyPagesCount = 0;
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
      } else if (error.response?.data?.returnCode === -2020) {
        // Xử lý lỗi invalid input datetime
        console.error(`Kaipany: Lỗi timestamp không hợp lệ (returnCode=-2020) khi gọi API cho placeID=${placeId}:`, {
          requestData: requestData,
          errorMessage: error.response?.data?.returnMessage
        });
      } else {
        // Xử lý các lỗi khác
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
