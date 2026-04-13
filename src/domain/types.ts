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

export type TransportType = "flight" | "train";
export type ActivityType =
  | "sightseeing"
  | "food"
  | "transport"
  | "shopping"
  | "accommodation";

export interface TransportEndpoint {
  airport_station: string;
  time: string;
}

export interface TransportationLeg {
  type: TransportType;
  identifier: string;
  airline_operator?: string;
  departure: TransportEndpoint;
  arrival: TransportEndpoint;
}

export interface SearchSummary {
  weather_forecast: string;
  major_events: string[];
}

export interface ItineraryActivity {
  time_slot: string;
  location: string;
  address: string;
  type: ActivityType;
  description: string;
  transport_memo: string;
  real_time_info: {
    live_update: string;
  };
}

export interface DailyItinerary {
  day: number;
  date: string;
  theme: string;
  activities: ItineraryActivity[];
}

export interface TripPlan {
  tripId: string;
  metadata: {
    destination: string;
    days: number;
  };
  transportation: {
    outbound: TransportationLeg;
    return: TransportationLeg;
  };
  search_summary: SearchSummary;
  daily_itinerary: DailyItinerary[];
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
  scheduledAt: string;
  context?: RuntimeStepContext;
}

export interface ActivityTiming {
  rawDate: string;
  rawTimeSlot: string;
  timeZone: string;
  startLocal: string;
  endLocal: string;
  startUtc: string;
  endUtc: string;
  durationMinutes: number;
}

export interface RuntimeStepContext {
  kind: "planning" | "activity" | "home_reflection";
  phase: TripPhase;
  day: number;
  date: string;
  theme: string;
  activityIndex: number;
  isExtraMessage: boolean;
  sendMoment: "start" | "mid" | "summary";
  activity: ItineraryActivity;
  previousActivity?: ItineraryActivity;
  nextActivity?: ItineraryActivity;
  timing: ActivityTiming;
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

export type ShotKind = "selfie" | "snapshot";

export interface ImageIntent {
  shotKind: ShotKind;
  usesReferenceImage: boolean;
  currentTimeLocal: string;
  destinationWithLocation: string;
  activityLocation: string;
  activityDescription: string;
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
  shotKind: ShotKind;
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

export type ConversationMode = "default" | "companion-exclusive";

export interface ConversationBindingRecord extends DeliveryBinding {
  key: string;
  defaultPersonaId?: string;
  lastTripId?: string;
  mode: ConversationMode;
}

export interface InboundUserMessage {
  messageId: string;
  content: string;
  receivedAt: string;
  senderId?: string;
  senderName?: string;
  senderUsername?: string;
}

export interface CompanionTurn {
  role: "user" | "companion";
  text: string;
  createdAt: string;
  tripId?: string;
}

export interface PendingReplyDispatch {
  conversationKey: string;
  dedupeKey: string;
  dueAt: string;
  segments: string[];
  sourceMessageIds: string[];
  sentAt?: string;
}

export interface CompanionReplyPlan {
  segments: string[];
  provider: string;
}

export type CompanionBusinessMode = "idle" | "traveling" | "trip-finished";
export type CompanionBusinessScene =
  | "idle"
  | "planning"
  | "airport"
  | "transport"
  | "hotel"
  | "food"
  | "sightseeing"
  | "shopping"
  | "reflection";
export type CompanionBusinessPresence =
  | "available"
  | "busy"
  | "moving"
  | "resting";

export interface CompanionBusinessSituation {
  mode: CompanionBusinessMode;
  scene: CompanionBusinessScene;
  presence: CompanionBusinessPresence;
  currentPhase: TripPhase | "system";
  currentDay: number;
  contextKind: RuntimeStepContext["kind"] | "none";
  sendMoment: RuntimeStepContext["sendMoment"] | "none";
  isExtraMessage: boolean;
  postcardEligible: boolean;
  replyDelayMs: number;
}

export interface ConversationCompanionState {
  conversationKey: string;
  mode: ConversationMode;
  pendingUserMessages: InboundUserMessage[];
  pendingReplyDispatch: PendingReplyDispatch | null;
  recentHandledCommandMessageIds: string[];
  recentTurns: CompanionTurn[];
  lastUserMessageAt: string | null;
  lastCompanionReplyAt: string | null;
  memorySummary?: string;
  updatedAt: string;
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
  sendTextReply(input: {
    binding: DeliveryBinding;
    text: string;
    dedupeKey: string;
  }): Promise<SendReceipt>;
}

export interface GroundingPort {
  planTrip(input: {
    tripId: string;
    persona: StoredPersonaProfile;
    request: TripRequest;
  }): Promise<TripPlan>;
  composeCaption(input: {
    tripId: string;
    persona: StoredPersonaProfile;
    request: TripRequest;
    plan: TripPlan;
    phase: TripPhase;
    day: number;
    stepContext: RuntimeStepContext;
    grounding: PhaseGroundingResult;
    imagePrompt: string;
  }): Promise<{ caption: string; provider: string }>;
  composeCompanionReply(input: {
    conversationKey: string;
    persona: StoredPersonaProfile | null;
    pendingUserMessages: InboundUserMessage[];
    recentTurns: CompanionTurn[];
    activeTrip: TripRecord | null;
    businessSituation: CompanionBusinessSituation;
    now: string;
  }): Promise<CompanionReplyPlan>;
}

export interface ImageGenerationPort {
  generateImage(input: {
    tripId: string;
    persona: StoredPersonaProfile;
    request: TripRequest;
    plan: TripPlan;
    phase: TripPhase;
    day: number;
    stepContext: RuntimeStepContext;
    grounding: PhaseGroundingResult;
    shotKind: ShotKind;
    usesReferenceImage: boolean;
    prompt: string;
  }): Promise<ImageGenerationResult>;
}

export interface ClockPort {
  now(): Date;
}

export interface LoggerPort {
  log(entry: LogEntry): Promise<void> | void;
}

export interface ConversationBindingStore {
  get(key: string): Promise<ConversationBindingRecord | null>;
  list(): Promise<ConversationBindingRecord[]>;
  upsert(record: ConversationBindingRecord): Promise<void>;
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

export interface ConversationStateRepository {
  save(record: ConversationCompanionState): Promise<void>;
  getByKey(conversationKey: string): Promise<ConversationCompanionState | null>;
  listDueConversations(now: Date): Promise<ConversationCompanionState[]>;
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
