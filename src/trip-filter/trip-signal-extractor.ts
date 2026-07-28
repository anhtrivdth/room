import type { NormalizedMessage, RouteDetection, TripSignals, TripStatus } from "./trip-filter.types.js";

const first = (value: string, regex: RegExp) => value.match(regex)?.[0]?.trim();

function detectStatus(value: string): TripStatus {
  if (["hủy", "huỷ", "cancel", "bỏ kèo"].some((term) => value.includes(term))) return "cancelled";
  if (["đã nhận", "đã chốt", "đã có tài", "có tài rồi", "xong"].some((term) => value.includes(term))) return "closed";
  if (["cần xe", "cần tài", "ai đi", "ai chạy", "ai nhận", "nhận giúp", "chạy giúp", "có xe không", "có tài không"].some((term) => value.includes(term))) return "open";
  if (["ib", "inbox", "liên hệ", "alo", "chốt"].some((term) => value.includes(term))) return "possibly_open";
  return "unknown";
}

export function extractTripSignals(message: NormalizedMessage, route: RouteDetection): TripSignals {
  const value = message.expanded;
  const price = first(value, /(?<![\p{L}\d])(?:\d{1,3}(?:[.,]\d{3})+|\d+\s*tr\s*\d+|\d+(?:[.,]\d+)?\s*(?:k|nghìn|ngàn|tr|triệu|đ|vnd|xị|xi|lít|net)|\d+\s*triệu\s*\d+|(?:tài thu|khách trả|giá|phí|cước)\s*\d+)(?![\p{L}\d])/iu)
    ?? first(value, /(?<![\p{L}\d:+])\d{2,7}(?![\p{L}\d:])/u);
  const time = first(value, /(?<![\p{L}\d])(?:(?:[01]?\d|2[0-3])(?:h|g)(?:[0-5]\d)?|(?:[01]?\d|2[0-3]):[0-5]\d|\d{1,2}\s*giờ(?:\s*rưỡi)?|sáng nay|chiều nay|tối nay|hôm nay|ngày mai|sáng mai|chiều mai|tối mai|mai|gấp|đi ngay)(?![\p{L}\d])/iu);
  const vehicleType = first(value, /(?<![\p{L}\d])(?:x\s*[467]|4c|5c|6c|7c|16c|4\s*chỗ|6\s*chỗ|7\s*chỗ|16\s*chỗ|sedan|suv|mpv)(?![\p{L}\d])/iu)?.toUpperCase();
  const passenger = value.match(/(?<![\p{L}\d])(\d{1,2})\s*(?:khách|kh|người)(?![\p{L}\d])/iu);
  const luggage = first(value, /(?<![\p{L}\d])\d{1,2}\s*(?:vali|vl|kiện|hành lý)(?![\p{L}\d])/iu);
  const phoneNumber = first(value, /(?<!\d)(?:\+?84|0)(?:[ .-]?\d){8,10}(?!\d)/u);
  const intentPatterns = ["cần xe", "cần tài", "cần tài xế", "tìm tài", "ai đi", "ai chạy", "ai nhận", "bác nào", "anh em nào", "có xe không", "có tài không", "nhận giúp", "chạy giúp", "hỗ trợ", "ghép khách", "ghép chuyến", "nhắn riêng", "inbox", "liên hệ", "gọi", "alo", "chốt"];
  const intentSignals = intentPatterns.filter((signal) => value.includes(signal));
  const contactSignal = first(value, /(?<![\p{L}\d])(?:ib|inbox|nhắn riêng|liên hệ|gọi|alo|chốt)(?![\p{L}\d])/iu);
  const negativePatterns = ["bán xe", "mua xe", "tuyển tài xế", "cần tuyển", "việc làm", "tuyển dụng", "cho thuê xe", "bán hàng"];
  const negativeSignals = negativePatterns.filter((signal) => value.includes(signal));
  return {
    origin: route.origin,
    destination: route.destination,
    locations: route.locations.map((location) => location.canonicalName),
    routeConnector: route.connector,
    time,
    price,
    vehicleType,
    passengerCount: passenger?.[1] ? Number(passenger[1]) : undefined,
    luggage,
    phoneNumber,
    contactSignal,
    intentSignals,
    negativeSignals,
    status: detectStatus(value),
  };
}
