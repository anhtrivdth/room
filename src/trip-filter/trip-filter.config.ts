import type { TripFilterMode } from "./trip-filter.types.js";

export type TripFilterConfig = {
  mode: TripFilterMode;
  forwardLowScore: boolean;
};

export const DEFAULT_TRIP_FILTER_CONFIG: TripFilterConfig = {
  mode: "high_recall",
  forwardLowScore: false,
};

export function tripFilterConfigFromEnv(): TripFilterConfig {
  const mode = process.env.TRIP_FILTER_MODE;
  return {
    mode: mode === "strict" || mode === "balanced" || mode === "high_recall" ? mode : "high_recall",
    forwardLowScore: process.env.TRIP_FORWARD_LOW_SCORE === "true",
  };
}
