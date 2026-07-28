import type { TripClassification } from "./trip-filter.types.js";

export type TripFilterCounters = {
  forwarded_trip_count: number;
  forwarded_route_candidate_count: number;
  forwarded_suspicious_count: number;
  ignored_message_count: number;
  duplicate_message_count: number;
};

export class TripFilterMetrics {
  private readonly counters: TripFilterCounters = {
    forwarded_trip_count: 0,
    forwarded_route_candidate_count: 0,
    forwarded_suspicious_count: 0,
    ignored_message_count: 0,
    duplicate_message_count: 0,
  };
  forwarded(classification: TripClassification) {
    if (classification === "trip_candidate") this.counters.forwarded_trip_count++;
    else if (classification === "route_candidate") this.counters.forwarded_route_candidate_count++;
    else if (classification === "suspicious_trip") this.counters.forwarded_suspicious_count++;
  }
  ignored() { this.counters.ignored_message_count++; }
  duplicate() { this.counters.duplicate_message_count++; }
  snapshot(): TripFilterCounters { return { ...this.counters }; }
}
