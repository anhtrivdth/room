import { expandAbbreviations } from "./abbreviation-dictionary.js";
import type { NormalizedMessage } from "./trip-filter.types.js";

export function removeVietnameseAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

export function normalizeMessage(original: string): NormalizedMessage {
  const unicode = original.normalize("NFC").replace(/\r\n?/g, "\n").replace(/[‐‑‒–—―]/g, "-");
  const lowercase = unicode.toLocaleLowerCase("vi-VN");
  const lines = lowercase.split("\n").map((line) => line.replace(/[\t ]+/g, " ").trim()).filter(Boolean);
  const compact = lines.join(" ").replace(/\s+/g, " ").trim();
  const accentless = removeVietnameseAccents(compact);
  const expanded = expandAbbreviations(compact);
  const tokens = expanded.match(/[\p{L}\d]+|=>|->|<-|>>|>|→|➡|↔|-|\/|\||:/gu) ?? [];
  return { original, lowercase, accentless, compact, expanded, lines, tokens };
}
