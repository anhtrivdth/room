import { detectRoute } from "./route-detector.js";
import { normalizeMessage } from "./normalize-message.js";
import { extractTripSignals } from "./trip-signal-extractor.js";
import type { TripClassificationResult, TripFilterMode } from "./trip-filter.types.js";

export function classifyTripMessage(original: string, mode: TripFilterMode = "high_recall"): TripClassificationResult {
  const normalized = normalizeMessage(original);
  const route = detectRoute(normalized);
  const signals = extractTripSignals(normalized, route);
  const reasons: string[] = [];
  let score = 0;
  const locationCount = new Set(signals.locations).size;
  const hasTwoEndpoints = Boolean(route.origin && route.destination);
  const hasConnector = Boolean(route.connector);
  const genericPlaceCount = route.locations.filter((location) => location.source === "generic").length;
  const pickupDrop = /(?<![\p{L}\d])(?:điểm đón|điểm trả|đón|trả|rước|chở|đưa)(?![\p{L}\d])/iu.test(normalized.expanded);

  if (hasTwoEndpoints && hasConnector) { score += 6; reasons.push("route_structure_detected"); }
  else if (locationCount >= 2 || (hasTwoEndpoints && route.inferredEndpointCount <= 1)) { score += 5; reasons.push("two_locations_detected"); }
  if (genericPlaceCount && locationCount >= 2) { score += 4; reasons.push("generic_place_and_location_detected"); }
  if (pickupDrop) { score += 4; reasons.push("pickup_drop_structure_detected"); }
  if (signals.intentSignals.length) { score += 3; reasons.push("trip_intent_detected"); }
  if (signals.price) { score += 2; reasons.push("price_detected"); }
  if (signals.time) { score += 2; reasons.push("time_detected"); }
  if (signals.phoneNumber || signals.contactSignal) { score += 2; reasons.push("contact_detected"); }
  if (signals.vehicleType) { score += 1; reasons.push("vehicle_detected"); }
  if (signals.passengerCount || signals.luggage) { score += 1; reasons.push("passenger_or_luggage_detected"); }
  if (route.hasEmojiRoute) { score += 1; reasons.push("route_emoji_detected"); }
  for (const location of route.locations) reasons.push(`${location.source === "generic" ? "generic_place" : "location"}_detected:${location.canonicalName.toLocaleLowerCase("vi-VN")}`);

  const strongExplicitRoute = hasTwoEndpoints && hasConnector && locationCount >= 2;
  const clearlyNonTrip = signals.negativeSignals.length > 0 && !strongExplicitRoute;
  if (clearlyNonTrip) { score -= 8; reasons.push("non_trip_context_detected"); }
  const mandatoryRoute = locationCount >= 2 || (hasTwoEndpoints && hasConnector) || (genericPlaceCount > 0 && locationCount >= 2);
  const recallFallback = (locationCount >= 1 && Boolean(signals.price || signals.time || hasConnector || pickupDrop)) || (route.hasEmojiRoute && hasTwoEndpoints);
  const immediateSignal = locationCount >= 1 || Boolean(signals.price) || Boolean(signals.vehicleType);
  let classification: TripClassificationResult["classification"];
  if (clearlyNonTrip) classification = "non_trip";
  else if (route.hasRouteStructure && (mandatoryRoute || hasTwoEndpoints)) classification = "route_candidate";
  else if (score >= 5) classification = "trip_candidate";
  else if (score >= 3 || recallFallback) classification = "suspicious_trip";
  else classification = "non_trip";
  if (classification === "non_trip" && immediateSignal) {
    classification = "suspicious_trip";
    reasons.push("immediate_location_price_or_vehicle_signal");
  }

  const threshold = mode === "strict" ? 5 : mode === "balanced" ? 4 : 3;
  const shouldForward = immediateSignal || (!clearlyNonTrip && (mandatoryRoute || recallFallback || score >= threshold));
  return { shouldForward, classification, score, reasons: [...new Set(reasons)], signals, normalized };
}
