export type TripFilterMode = "strict" | "balanced" | "high_recall";
export type TripStatus = "open" | "possibly_open" | "closed" | "cancelled" | "unknown";
export type TripClassification = "trip_candidate" | "route_candidate" | "suspicious_trip" | "non_trip";

export type NormalizedMessage = {
  original: string;
  lowercase: string;
  accentless: string;
  compact: string;
  expanded: string;
  lines: string[];
  tokens: string[];
};

export type LocationCategory =
  | "province" | "city" | "district" | "ward" | "airport" | "hospital"
  | "station" | "industrial_zone" | "residential" | "landmark" | "generic_place";

export type LocationAlias = {
  canonicalName: string;
  aliases: string[];
  category: LocationCategory;
  ambiguous?: boolean;
};

export type DetectedLocation = {
  text: string;
  canonicalName: string;
  category: LocationCategory;
  start: number;
  end: number;
  source: "dictionary" | "generic" | "heuristic";
};

export type RouteDetection = {
  origin?: string;
  destination?: string;
  connector?: string;
  locations: DetectedLocation[];
  hasRouteStructure: boolean;
  hasEmojiRoute: boolean;
  inferredEndpointCount: number;
};

export type TripSignals = {
  origin?: string;
  destination?: string;
  locations: string[];
  routeConnector?: string;
  time?: string;
  price?: string;
  vehicleType?: string;
  passengerCount?: number;
  luggage?: string;
  phoneNumber?: string;
  contactSignal?: string;
  intentSignals: string[];
  negativeSignals: string[];
  status: TripStatus;
};

export type TripClassificationResult = {
  shouldForward: boolean;
  classification: TripClassification;
  score: number;
  reasons: string[];
  signals: TripSignals;
  normalized: NormalizedMessage;
};
