export const ABBREVIATIONS: Readonly<Record<string, string>> = {
  bv: "bệnh viện", bvien: "bệnh viện", pk: "phòng khám", sb: "sân bay", sbay: "sân bay",
  tsn: "tân sơn nhất", sg: "sài gòn", hcm: "hồ chí minh", tphcm: "thành phố hồ chí minh",
  cc: "củ chi", td: "thủ đức", "tđ": "thủ đức", gv: "gò vấp", pn: "phú nhuận",
  tb: "tân bình", tp: "tân phú", bc: "bình chánh", bch: "bình chánh", nb: "nhà bè",
  hm: "hóc môn", bd: "bình dương", dnai: "đồng nai", vt: "vũng tàu", la: "long an", tn: "tây ninh",
  q1: "quận 1", q2: "quận 2", q3: "quận 3", q4: "quận 4", q5: "quận 5", q6: "quận 6",
  q7: "quận 7", q8: "quận 8", q9: "quận 9", q10: "quận 10", q11: "quận 11", q12: "quận 12",
  tx: "tài xế", kh: "khách", ae: "anh em", ace: "anh chị em", dd: "điểm đón", "đđ": "điểm đón",
  dt: "điểm trả", "đt": "điểm trả", lh: "liên hệ", ib: "nhắn riêng", inb: "nhắn riêng",
  dc: "được", "đc": "được", ko: "không", k0: "không", kg: "không", hnay: "hôm nay",
  nmai: "ngày mai", smai: "sáng mai", cmai: "chiều mai", tmai: "tối mai",
};

export const AMBIGUOUS_ABBREVIATIONS = new Set(["cc", "bd", "tb", "tđ", "td", "dt"]);
export const ROUTE_CONTEXT_PATTERN = /(?:(?<![\p{L}\d])(?:từ|tu|đi|di|đến|den|tới|toi|về|ve|qua|xuống|xuong|lên|len|sang|đón|don|trả|tra)(?![\p{L}\d])|(?:->|=>|<-|→|➡|↔|>|--|\|))/iu;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function expandAbbreviations(value: string) {
  const hasRouteContext = ROUTE_CONTEXT_PATTERN.test(value);
  return Object.entries(ABBREVIATIONS).reduce((expanded, [short, full]) => {
    if (AMBIGUOUS_ABBREVIATIONS.has(short) && !hasRouteContext) return expanded;
    return expanded.replace(new RegExp(`(?<![\\p{L}\\d])${escapeRegex(short)}(?![\\p{L}\\d])`, "giu"), (matched, offset: number, source: string) => {
      if (short === "bd" && /(?:bệnh viện|bv)\s*$/iu.test(source.slice(0, offset))) return "bình dân";
      return full;
    });
  }, value);
}
