import { describe, expect, it } from "vitest";
import { classifyTripMessage } from "../src/trip-filter/trip-classifier.js";
import { normalizeMessage } from "../src/trip-filter/normalize-message.js";
import { renderTripAlert } from "../src/trip-filter/trip-alert.js";

describe("high-recall trip classifier", () => {
  const requiredRoutes = [
    "Bệnh viện Bình Dân về Củ Chi",
    "Bình Dân - Củ Chi",
    "BV Bình Dân đi CC",
    "Bv bình dân > củ chi",
    "Bình Dân => Củ Chi",
    "Bình Dân tới Củ Chi",
    "Bình Dân xuống Củ Chi",
    "Bình Dân Củ Chi",
    "Q3 về Củ Chi",
    "Q1 TSN",
    "Tân Sơn Nhất Vũng Tàu",
    "BV Chợ Rẫy - Long An",
    "Vinhome GP sân bay",
    "5h Bình Dân về Củ Chi",
    "Bình Dân về Củ Chi 400",
    "Bình Dân\nCủ Chi",
    "đi cc từ bv bình dân",
    "cc <- bình dân",
    "Bình Dân ➡️ Củ Chi",
    "bv bình dân ve cc",
    "benh vien binh dan ve cu chi",
  ];

  it.each(requiredRoutes)("chuyển tiếp tuyến bắt buộc: %s", (content) => {
    const result = classifyTripMessage(content);
    expect(result.shouldForward, JSON.stringify(result, null, 2)).toBe(true);
    expect(["route_candidate", "trip_candidate", "suspicious_trip"]).toContain(result.classification);
  });

  it("trích xuất tuyến, giờ và giá không đơn vị", () => {
    const result = classifyTripMessage("5h BV Bình Dân về CC 400");
    expect(result.signals.origin).toBeTruthy();
    expect(result.signals.destination).toBeTruthy();
    expect(result.signals.time).toBe("5h");
    expect(result.signals.price).toBe("400");
  });

  it("nhận diện cập nhật trạng thái đóng nhưng vẫn chuyển", () => {
    const result = classifyTripMessage("Bình Dân về Củ Chi đã có tài");
    expect(result.shouldForward).toBe(true);
    expect(result.signals.status).toBe("closed");
  });

  it("không coi hội thoại thường là tuyến", () => {
    const result = classifyTripMessage("Hôm nay anh em chạy ổn không");
    expect(result.shouldForward, JSON.stringify(result, null, 2)).toBe(false);
  });

  it("báo ngay khi có một địa danh đơn lẻ", () => {
    expect(classifyTripMessage("Củ Chi").shouldForward).toBe(true);
  });

  it("vẫn báo tin bán hàng nếu có địa danh theo chế độ phủ tối đa", () => {
    expect(classifyTripMessage("Bán xe 7 chỗ giá 500 triệu tại Củ Chi").shouldForward).toBe(true);
  });

  it("vẫn báo tin tuyển dụng nếu có địa danh theo chế độ phủ tối đa", () => {
    expect(classifyTripMessage("Cần tuyển tài xế làm việc tại Củ Chi").shouldForward).toBe(true);
  });

  it("trích xuất xe, khách, hành lý và liên hệ", () => {
    const result = classifyTripMessage("X7 3 khách 2 vali từ Q1 về TSN 400k ai nhận ib 0901234567");
    expect(result.signals.vehicleType).toBe("X7");
    expect(result.signals.passengerCount).toBe(3);
    expect(result.signals.luggage).toBe("2 vali");
    expect(result.signals.contactSignal).toBeTruthy();
    expect(result.shouldForward).toBe(true);
  });

  it.each(["1tr2", "1 triệu 2", "1.200.000", "4 xị", "4xi", "4 lít", "500 net", "tài thu 500", "khách trả 500"])("nhận dạng giá: %s", (price) => {
    expect(classifyTripMessage(`Bình Dân về Củ Chi ${price}`).signals.price).toBeTruthy();
  });

  it.each(["X4", "x6", "X7", "4c", "6C", "7c"])("báo ngay loại xe: %s", (vehicle) => {
    const result = classifyTripMessage(vehicle);
    expect(result.shouldForward).toBe(true);
    expect(result.signals.vehicleType).toBe(vehicle.toUpperCase());
  });

  it.each(["10", "193", "193k", "400.000"])("báo ngay số tiền đứng riêng: %s", (price) => {
    const result = classifyTripMessage(price);
    expect(result.shouldForward).toBe(true);
    expect(result.signals.price).toBeTruthy();
  });

  it.each(["Bệnh viện Hoàn Mỹ về Củ Chi", "Chung cư Sunrise City -> Long An", "Khách sạn Rex sang Củ Chi", "Công ty ABC về Đồng Nai"])("nhận địa điểm ngoài dictionary: %s", (content) => {
    const result = classifyTripMessage(content);
    expect(result.shouldForward, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.signals.origin).toBeTruthy();
    expect(result.signals.destination).toBeTruthy();
  });

  it("tạo đủ các phiên bản chuẩn hóa mà không làm mất mũi tên và xuống dòng", () => {
    const result = normalizeMessage("BV Bình Dân  ->  CC\r\n400k");
    expect(result.original).toContain("BV Bình Dân");
    expect(result.lowercase).toContain("bv bình dân");
    expect(result.accentless).toContain("bv binh dan");
    expect(result.compact).toContain("->");
    expect(result.expanded).toContain("bệnh viện");
    expect(result.lines).toHaveLength(2);
    expect(result.tokens).toContain("->");
  });

  it("làm nổi bật và escape nội dung gốc bằng HTML", () => {
    const message = { id: "m1", groupId: "g1", senderId: "u1", senderName: "A <B>", text: "cần xe <script>", timestamp: new Date() };
    const alert = renderTripAlert(message, "Nhóm & xe", classifyTripMessage(message.text));
    expect(alert).toContain("<b>📣 NỘI DUNG GỐC</b>");
    expect(alert).toContain("<blockquote><b>cần xe &lt;script&gt;</b></blockquote>");
    expect(alert).toContain("Nhóm &amp; xe");
    expect(alert).not.toContain("Địa điểm phát hiện:");
    expect(alert).not.toContain("Trạng thái:");
  });

  it("không hiển thị tuyến phân tích giữa người gửi và nội dung gốc", () => {
    const message = { id: "m2", groupId: "g1", senderId: "u1", senderName: "Tài xế", text: "ddcc - q1", timestamp: new Date() };
    const alert = renderTripAlert(message, "xe", classifyTripMessage(message.text));
    expect(alert).not.toContain("ddcc →");
    expect(alert.indexOf("Người gửi:")).toBeLessThan(alert.indexOf("NỘI DUNG GỐC"));
  });
});
