import { classifyTripMessage } from "../src/trip-filter/trip-classifier.js";
import type { TripFilterMode } from "../src/trip-filter/trip-filter.types.js";

type SimulationCase = {
  group: string;
  message: string;
  expected: boolean;
};

const mode = (process.argv[2] ?? "high_recall") as TripFilterMode;
if (!(["high_recall", "balanced", "strict"] as const).includes(mode)) {
  throw new Error(`Chế độ không hợp lệ: ${mode}`);
}

const cases: SimulationCase[] = [
  { group: "Ý định gọi xe", message: "Cần xe đi sân bay", expected: true },
  { group: "Ý định gọi xe", message: "Ai nhận giúp cuốc này", expected: true },
  { group: "Ý định gọi xe", message: "Cần tài xế 7 chỗ", expected: true },
  { group: "Tuyến đường", message: "Bệnh viện Bình Dân về Củ Chi", expected: true },
  { group: "Tuyến đường", message: "Q1 -> TSN", expected: true },
  { group: "Tuyến đường", message: "Chợ Bến Thành về Quận 1", expected: true },
  { group: "Địa điểm", message: "Củ Chi", expected: true },
  { group: "Địa điểm", message: "Sân bay Tân Sơn Nhất", expected: true },
  { group: "Giá/cuốc phí", message: "400k", expected: true },
  { group: "Giá/cuốc phí", message: "Khách trả 500", expected: true },
  { group: "Loại xe", message: "X7", expected: true },
  { group: "Loại xe", message: "Xe 7 chỗ", expected: true },
  { group: "Đủ nhiều tín hiệu", message: "5h Q1 về TSN, 3 khách, 2 vali, giá 400k, ai nhận ib", expected: true },
  { group: "Hội thoại bị loại", message: "@Quan Đại ok", expected: false },
  { group: "Hội thoại bị loại", message: "@Thảo Nguyễn cho a xin làm quen nha", expected: false },
  { group: "Hội thoại bị loại", message: "@Chính ib r nhen", expected: false },
  { group: "Hội thoại bị loại", message: "@Hiếu xử lý :-DIG", expected: false },
];

let failures = 0;
console.log(`Mô phỏng bộ lọc — chế độ: ${mode}\n`);

for (const item of cases) {
  const result = classifyTripMessage(item.message, mode);
  const passed = result.shouldForward === item.expected;
  if (!passed) failures++;
  console.log(`${passed ? "✓" : "✗"} [${item.group}] ${JSON.stringify(item.message)}`);
  console.log(`  ${result.shouldForward ? "CHẤP NHẬN" : "TỪ CHỐI"} | ${result.classification} | điểm ${result.score}`);
  console.log(`  tín hiệu: ${result.reasons.join(", ") || "không có"}\n`);
}

console.log(`Kết quả: ${cases.length - failures}/${cases.length} trường hợp đúng kỳ vọng.`);
if (failures) process.exitCode = 1;
