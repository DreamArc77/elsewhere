export const tripPhases = [
  "planning",
  "packing",
  "departing",
  "in_transit",
  "arrival_checkin",
  "day_exploration",
  "returning",
  "home_reflection",
] as const;

export type TripPhase = (typeof tripPhases)[number];

export const publicPostcardPhases = new Set<TripPhase>([
  "planning",
  "departing",
  "arrival_checkin",
  "day_exploration",
  "returning",
  "home_reflection",
]);

export interface PersonaProfile {
  name: string;
  traits: string[];
  relationship: string;
  toneStyle: string;
  referenceImageAsset: string;
}

export interface StoredPersonaProfile extends PersonaProfile {
  personaId: string;
  createdAt: string;
}

export interface TripRequest {
  personaId: string;
  originCity: string;
  destinationCity: string;
  startWindow?: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
  snippet?: string;
}

export interface TransportPlan {
  summary: string;
  departure: string;
  arrival: string;
  carrierHint?: string;
}

export interface HotelPlan {
  name: string;
  district: string;
  address?: string;
  nightlyBudget?: string;
}

export interface DailyAgenda {
  day: number;
  dateLabel: string;
  headline: string;
  morning: string[];
  afternoon: string[];
  evening: string[];
  notes: string;
}

export interface TripPlan {
  tripId: string;
  days: number;
  transport: TransportPlan;
  hotel: HotelPlan;
  dailyAgenda: DailyAgenda[];
  groundingSources: GroundingSource[];
  weatherSummary: string;
  recommendedPostingMoments: TripPhase[];
}

export type TripStatus = "planned" | "active" | "completed" | "failed";

export interface ArtifactReference {
  artifactId: string;
  kind: "plan" | "grounding" | "image" | "delivery";
  phase: TripPhase;
  path: string;
  createdAt: string;
  day?: number;
}

export interface Postcard {
  tripId: string;
  phase: TripPhase;
  caption: string;
  imageAsset: string;
  sentAt: string;
}

export interface TripState {
  status: TripStatus;
  currentPhase: TripPhase;
  currentDay: number;
  nextRunAt: string | null;
  pendingPostcard: Postcard | null;
  artifacts: ArtifactReference[];
}

export interface TimelineStep {
  stepId: string;
  phase: TripPhase;
  day: number;
  emitsPostcard: boolean;
  delayHours: number;
}

export interface PhaseGroundingResult {
  phase: TripPhase;
  day: number;
  locality: string;
  weatherSummary: string;
  transitSummary: string;
  venueSummary: string;
  photoBrief: string;
  sensoryHighlights: string[];
  groundingSources: GroundingSource[];
}

export interface ImageGenerationResult {
  mimeType: string;
  bytesBase64: string;
  provider: string;
  promptEcho?: string;
}

export interface PendingDispatch {
  stepId: string;
  phase: TripPhase;
  day: number;
  postcard: Postcard;
  dedupeKey: string;
  grounding: PhaseGroundingResult;
  imagePrompt: string;
  artifactIds: string[];
}

export interface DeliveryBinding {
  bindingId?: string;
  channel: string;
  accountId?: string;
  target: string;
  parentConversationId?: string;
  threadId?: string | number;
  boundAt?: number;
}

export interface TripRecord {
  tripId: string;
  personaId: string;
  request: TripRequest;
  plan: TripPlan;
  state: TripState;
  timeline: TimelineStep[];
  timelineIndex: number;
  pendingDispatch: PendingDispatch | null;
  deliveryBinding?: DeliveryBinding;
  createdAt: string;
  updatedAt: string;
  lastRunId?: string;
}

export interface SendReceipt {
  messageId: string;
  deduped: boolean;
  provider: string;
}

export interface LogEntry {
  tripId: string;
  runId: string;
  phase: TripPhase | "system";
  event: string;
  decision: string;
  scheduledAt?: string;
  startedAt: string;
  finishedAt: string;
  provider: string;
  latencyMs: number;
  status: "success" | "failure" | "skipped";
  errorCode?: string;
  details?: Record<string, unknown>;
}

export interface HostSchedulerPort {
  scheduleTripTick(input: { tripId: string; runAt: string }): Promise<void>;
}

export interface HostMessengerPort {
  sendPostcard(input: {
    personaId: string;
    postcard: Postcard;
    dedupeKey: string;
  }): Promise<SendReceipt>;
}

export interface GroundingPort {
  planTrip(input: {
    tripId: string;
    persona: StoredPersonaProfile;
    request: TripRequest;
  }): Promise<TripPlan>;
  enrichPhase(input: {
    tripId: string;
    persona: StoredPersonaProfile;
    request: TripRequest;
    plan: TripPlan;
    phase: TripPhase;
    day: number;
  }): Promise<PhaseGroundingResult>;
  composeCaption(input: {
    tripId: string;
    persona: StoredPersonaProfile;
    request: TripRequest;
    plan: TripPlan;
    phase: TripPhase;
    day: number;
    grounding: PhaseGroundingResult;
  }): Promise<{ caption: string; provider: string }>;
}

export interface ImageGenerationPort {
  generateImage(input: {
    tripId: string;
    persona: StoredPersonaProfile;
    request: TripRequest;
    plan: TripPlan;
    phase: TripPhase;
    day: number;
    grounding: PhaseGroundingResult;
    prompt: string;
  }): Promise<ImageGenerationResult>;
}

export interface ClockPort {
  now(): Date;
}

export interface LoggerPort {
  log(entry: LogEntry): Promise<void> | void;
}

export interface PersonaRepository {
  save(persona: StoredPersonaProfile): Promise<void>;
  getById(personaId: string): Promise<StoredPersonaProfile | null>;
}

export interface TripRepository {
  save(record: TripRecord): Promise<void>;
  getById(tripId: string): Promise<TripRecord | null>;
  listDueTrips(now: Date): Promise<TripRecord[]>;
}

export interface ArtifactStorePort {
  writeJsonArtifact(input: {
    tripId: string;
    artifactId: string;
    fileName: string;
    value: unknown;
  }): Promise<string>;
  writeBinaryArtifact(input: {
    tripId: string;
    artifactId: string;
    fileName: string;
    bytesBase64: string;
  }): Promise<string>;
}

export interface RuntimeHooks {
  afterPendingSaved?(record: TripRecord): Promise<void> | void;
  afterMessageSent?(
    record: TripRecord,
    receipt: SendReceipt,
  ): Promise<void> | void;
}

export interface OpenClawTravelCompanionServiceDependencies {
  personaRepository: PersonaRepository;
  tripRepository: TripRepository;
  artifactStore: ArtifactStorePort;
  scheduler: HostSchedulerPort;
  messenger: HostMessengerPort;
  grounding: GroundingPort;
  imageGeneration: ImageGenerationPort;
  clock: ClockPort;
  logger: LoggerPort;
  hooks?: RuntimeHooks;
}
