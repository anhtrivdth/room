import { detectLocations } from "./location-detector.js";
import { normalizeMessage } from "./normalize-message.js";
import type { DetectedLocation, NormalizedMessage, RouteDetection } from "./trip-filter.types.js";

const connectorPattern = /(?:=>|->|<-|>>|>|→|➡️?|↔|\||\/|--|-|(?<![\p{L}\d])(?:từ|đi|đến|tới|về|qua|xuống|lên|sang|ghé|đón|trả|rước|chở|đưa|lấy|xuất phát|khởi hành|pickup|dropoff|drop|to|from)(?![\p{L}\d]))/giu;
const movementWord = /^(?:từ|đi|đến|tới|về|qua|xuống|lên|sang|ghé|đón|trả|rước|chở|đưa|lấy|xuất phát|khởi hành|pickup|dropoff|drop|to|from)$/iu;
const routeEmoji = /(?:→|➡️?|↔)/u;
const trimEndpoint = (value: string) => value.replace(/^\s*(?:đón|trả|điểm đón|điểm trả|từ|đi|đến|tới|về)\s*[:.-]?\s*/iu, "").replace(/\s+(?:giá|phí|cước)\s+.*$/iu, "").replace(/\s+\d{1,3}(?:[.,]\d{3})*\s*(?:k|nghìn|ngàn|tr|triệu|đ|vnd)?\s*$/iu, "").trim();

function bestName(locations: DetectedLocation[], segment: string) {
  const found = detectLocations(normalizeMessage(segment));
  return found[0]?.canonicalName ?? (locations.length ? locations[0]?.canonicalName : undefined);
}

export function detectRoute(message: NormalizedMessage): RouteDetection {
  const locations = detectLocations(message);
  const base: RouteDetection = { locations, hasRouteStructure: false, hasEmojiRoute: routeEmoji.test(message.compact), inferredEndpointCount: 0 };
  const expanded = message.expanded;

  const reversedFrom = expanded.match(/^(?:đi\s+)?(.+?)\s+từ\s+(.+)$/iu);
  if (reversedFrom?.[1] && reversedFrom[2]) {
    const destination = trimEndpoint(reversedFrom[1]);
    const origin = trimEndpoint(reversedFrom[2]);
    if (destination && origin && (detectLocations(normalizeMessage(destination)).length || detectLocations(normalizeMessage(origin)).length)) {
      return { ...base, origin: bestName([], origin) ?? origin, destination: bestName([], destination) ?? destination, connector: "từ", hasRouteStructure: true, inferredEndpointCount: 2 };
    }
  }

  for (const match of expanded.matchAll(connectorPattern)) {
    const connector = match[0];
    const index = match.index;
    const left = trimEndpoint(expanded.slice(0, index));
    const right = trimEndpoint(expanded.slice(index + connector.length));
    if (!left || !right || (connector === "/" && !locations.length)) continue;
    const leftLocations = detectLocations(normalizeMessage(left));
    const rightLocations = detectLocations(normalizeMessage(right));
    const connectorIsStrong = movementWord.test(connector) || connector !== "/";
    const symbolicRoute = /^(?:=>|->|<-|>>|>|→|➡️?|↔)$/u.test(connector)
      && /[\p{L}]{2}/u.test(left) && /[\p{L}]{2}/u.test(right);
    if (!connectorIsStrong || (!leftLocations.length && !rightLocations.length && !symbolicRoute)) continue;
    const leftName = leftLocations.at(-1)?.canonicalName ?? left;
    const rightName = rightLocations[0]?.canonicalName ?? right;
    const reversed = connector === "<-";
    return {
      ...base,
      origin: reversed ? rightName : leftName,
      destination: reversed ? leftName : rightName,
      connector,
      hasRouteStructure: true,
      inferredEndpointCount: Number(!leftLocations.length) + Number(!rightLocations.length),
    };
  }

  if (locations.length >= 2) {
    return { ...base, origin: locations[0]?.canonicalName, destination: locations[1]?.canonicalName, hasRouteStructure: true };
  }

  if (locations.length === 1 && message.tokens.length >= 2 && message.tokens.length <= 10) {
    const known = locations[0]!;
    const before = trimEndpoint(message.compact.slice(0, known.start));
    const after = trimEndpoint(message.compact.slice(known.end));
    const candidate = before || after;
    if (candidate && /[\p{L}]{2}/u.test(candidate) && !/^(?:hôm nay|ngày mai|sáng mai|chiều mai|tối mai|giá|phí|cước)$/iu.test(candidate)) {
      return before
        ? { ...base, origin: before, destination: known.canonicalName, hasRouteStructure: true, inferredEndpointCount: 1 }
        : { ...base, origin: known.canonicalName, destination: after, hasRouteStructure: true, inferredEndpointCount: 1 };
    }
  }

  if (message.lines.length >= 2) {
    const lineLocations = message.lines.map((line) => ({ line, locations: detectLocations(normalizeMessage(line)) })).filter((entry) => entry.locations.length);
    if (lineLocations.length >= 2) return { ...base, origin: lineLocations[0]?.locations[0]?.canonicalName, destination: lineLocations[1]?.locations[0]?.canonicalName, hasRouteStructure: true };
    if (lineLocations.length === 1 && message.lines.length <= 4) {
      const locationLine = lineLocations[0]!;
      const other = message.lines.find((line) => line !== locationLine.line && /[\p{L}]{2}/u.test(line));
      if (other) return { ...base, origin: locationLine.locations[0]?.canonicalName, destination: trimEndpoint(other), hasRouteStructure: true, inferredEndpointCount: 1 };
    }
  }

  return base;
}
