import { ROUTE_CONTEXT_PATTERN } from "./abbreviation-dictionary.js";
import { LOCATION_DICTIONARY, PLACE_TYPE_TERMS } from "./location-dictionary.js";
import { removeVietnameseAccents } from "./normalize-message.js";
import type { DetectedLocation, NormalizedMessage } from "./trip-filter.types.js";

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const overlaps = (a: DetectedLocation, start: number, end: number) => a.start < end && start < a.end;
const aliases = LOCATION_DICTIONARY.flatMap((location) => location.aliases.map((alias) => ({ location, alias: removeVietnameseAccents(alias.toLocaleLowerCase("vi-VN")) })))
  .sort((a, b) => b.alias.length - a.alias.length);
const placeTypePattern = [...PLACE_TYPE_TERMS].map(removeVietnameseAccents).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");

export function detectLocations(message: NormalizedMessage): DetectedLocation[] {
  const haystack = removeVietnameseAccents(message.compact);
  const hasRouteContext = ROUTE_CONTEXT_PATTERN.test(message.compact);
  const detected: DetectedLocation[] = [];

  for (const { location, alias } of aliases) {
    if (location.ambiguous && alias.length <= 2 && !hasRouteContext) continue;
    const regex = new RegExp(`(?<![\\p{L}\\d])${escapeRegex(alias)}(?![\\p{L}\\d])`, "gu");
    for (const match of haystack.matchAll(regex)) {
      const start = match.index;
      const end = start + match[0].length;
      if (detected.some((item) => overlaps(item, start, end))) continue;
      detected.push({ text: message.compact.slice(start, end), canonicalName: location.canonicalName, category: location.category, start, end, source: "dictionary" });
    }
  }

  const genericRegex = new RegExp(`(?<![\\p{L}\\d])(${placeTypePattern})(?![\\p{L}\\d])(?:\\s+(?:so\\s+)?[\\p{L}\\d][\\p{L}\\d.'/-]*){0,5}`, "gu");
  for (const match of haystack.matchAll(genericRegex)) {
    const start = match.index;
    let value = match[0].replace(/\s+(?:tu|di|den|toi|ve|qua|xuong|len|sang|don|tra|gia|phi)\b.*$/u, "").trim();
    if (!value) continue;
    const end = start + value.length;
    if (detected.some((item) => overlaps(item, start, end))) continue;
    detected.push({ text: message.compact.slice(start, end), canonicalName: message.compact.slice(start, end), category: "generic_place", start, end, source: "generic" });
  }

  return detected.sort((a, b) => a.start - b.start || b.end - a.end);
}
