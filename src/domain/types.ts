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
  originCity?: string;
  /** @deprecated legacy alias kept only for compatibility migration */
  homeCity?: string;
  traits: string[];
  relationship: string;
  toneStyle: string;
  referenceImageAsset: string;
}

export type TravelCompanionTextProviderKind =
  | "host-default"
  | "gemini"
  | "openai-compatible";

export interface TravelCompanionTextProviderConfig {
  kind: TravelCompanionTextProviderKind;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export interface TravelCompanionGlobalConfig {
  geminiApiKey?: string;
  textProvider?: TravelCompanionTextProviderConfig;
  updatedAt: string;
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
export type TransitMode =
  | "airplane"
  | "train"
  | "car"
  | "subway"
  | "walk";
export type ActivityType =
  | "sightseeing"
  | "food"
  | "transport"
  | "shopping"
  | "accommodation";

export interface TransportEndpoint {
  station: string;
  time: string;
}

export interface TransportationLeg {
  type: TransportType;
  transport_mode: "airplane" | "train";
  identifier: string;
  operator: string;
  departure: TransportEndpoint;
  arrival: TransportEndpoint;
}

export interface ArrivalContext {
  from_location: string;
  transport_mode: TransitMode;
  duration_minutes: number;
}

export interface ActivityRoute {
  from_location: string;
  to_location: string;
  transport_mode: TransitMode;
}

export interface ItineraryActivity {
  time_slot: string;
  location: string;
  address: string;
  type: ActivityType;
  description: string;
  arrival_context: ArrivalContext;
  route?: ActivityRoute;
  real_time_info: {
    live_update: string;
  };
}

export interface DailyItinerary {
  day: number;
  date: string;
  weather_forecast: string;
  theme: string;
  activities: ItineraryActivity[];
}

export interface TripPlan {
  tripId: string;
  metadata: {
    origin: string;
    destination: string;
    days: number;
  };
  transportation: {
    departure: TransportationLeg;
    return: TransportationLeg;
  };
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
  activeStateAnchor?: CompanionStateAnchor | null;
}

export interface TimelineStep {
  stepId: string;
  phase: TripPhase;
  day: number;
  emitsPostcard: boolean;
  scheduledAt: string;
  context?: RuntimeStepContext;
  stateOverride?: {
    group: CompanionStateGroup;
    substate: CompanionStateSubstate;
    scene: CompanionBusinessScene;
    presence: CompanionBusinessPresence;
    currentPhase: TripPhase | "system";
  };
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
  weatherSummary: string;
  promptLocation: string;
  promptBehavior: string;
}

export interface ImageGenerationResult {
  mimeType: string;
  bytesBase64: string;
  provider: string;
  promptEcho?: string;
  imageSummary?: string;
}

export interface PendingDispatch {
  stepId: string;
  phase: TripPhase;
  day: number;
  shotKind: ShotKind;
  postcard: Postcard | null;
  dedupeKey: string;
  grounding: PhaseGroundingResult;
  imagePrompt: string;
  imageSummary?: string;
  imageAsset: string;
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

export interface RecentPostcardPhotoContext {
  tripId: string;
  sentAt: string;
  shotKind: ShotKind;
  caption: string;
  imageSummary?: string;
}

export type SetupStep =
  | "persona_intro"
  | "existing_persona_confirm"
  | "name"
  | "origin_city"
  | "traits"
  | "relationship"
  | "tone"
  | "persona_review"
  | "reference_photo_choice"
  | "reference_photo"
  | "text_provider"
  | "openai_base_url"
  | "openai_api_key"
  | "openai_model"
  | "gemini_api_key"
  | "complete";

export type SetupSessionKind = "persona" | "model";

export interface SetupSessionDraft {
  name?: string;
  originCity?: string;
  /** @deprecated legacy alias kept only for compatibility migration */
  homeCity?: string;
  traits?: string[];
  relationship?: string;
  toneStyle?: string;
  referenceImageAsset?: string;
  textProviderKind?: TravelCompanionTextProviderKind;
  openaiBaseUrl?: string;
  openaiApiKey?: string;
  openaiModel?: string;
}

export interface SetupSession {
  kind: SetupSessionKind;
  personaTargetId?: string;
  step: SetupStep;
  awaitingReferencePhoto: boolean;
  returnToReview?: boolean;
  draft: SetupSessionDraft;
  startedAt: string;
  updatedAt: string;
}

export interface PendingReplyDispatch {
  conversationKey: string;
  dedupeKey: string;
  dueAt: string;
  segments: string[];
  sourceMessageIds: string[];
  sentAt?: string;
  instantSeen?: boolean;
}

export interface CompanionReplyPlan {
  segments: string[];
  provider: string;
}

export type CompanionBusinessMode = "idle" | "traveling" | "trip-finished";
export type CompanionStateGroup =
  | "idle"
  | "plan"
  | "departure"
  | "activities"
  | "return";
export type CompanionStateSubstate =
  | "idle"
  | "planning"
  | "packing"
  | "before_departure"
  | "departing"
  | "arrive"
  | "freetime"
  | "moving_to_next_activity"
  | "transport"
  | "sightseeing"
  | "food"
  | "accommodation"
  | "shopping";
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
export type SeenPolicy =
  | { kind: "range"; minMinutes: number; maxMinutes: number }
  | { kind: "until_state_end" }
  | { kind: "defer_to_next_state" };

export type AgentStateBlockSourceKind =
  | "synthetic_plan"
  | "transportation_leg"
  | "activity"
  | "synthetic_gap"
  | "synthetic_transition"
  | "synthetic_idle";

export type ResolvedAgentStateSource = "clock" | "anchor";

export interface ResolvedAgentIdentity {
  personaId: string | null;
  personaSummary?: string;
  relationshipSummary?: string;
  memorySummary?: string;
  relationshipNotes?: string;
}

export interface ResolvedAgentPolicy {
  seenPolicy: SeenPolicy;
  hotWindowMinutes: { min: number; max: number };
  instantReplyCap: { min: number; max: number };
  allowCarryToNextState: boolean;
}

export interface AgentStateBlock {
  blockId: string;
  group: CompanionStateGroup;
  substate: CompanionStateSubstate;
  sourceKind: AgentStateBlockSourceKind;
  startedAtUtc: string;
  endsAtUtc?: string;
  day: number;
  timeZone: string;
  location?: string;
  address?: string;
  weatherForecast?: string;
  presence: CompanionBusinessPresence;
  currentActivity?: ItineraryActivity;
  previousActivity?: ItineraryActivity;
  nextActivity?: ItineraryActivity;
  arrivalContext?: ArrivalContext;
  route?: ActivityRoute;
  note?: string;
  phaseLabel?: TripPhase | "system";
  contextKind: RuntimeStepContext["kind"] | "none";
  sendMoment: RuntimeStepContext["sendMoment"] | "none";
  isExtraMessage: boolean;
  postcardEligible: boolean;
}

export interface ResolvedAgentStage {
  substate: CompanionStateSubstate;
  group?: CompanionStateGroup;
  startedAtUtc: string;
  endsAtUtc?: string;
  day: number;
  timeZone: string;
}

export interface ResolvedAgentStageState {
  location?: string;
  address?: string;
  weatherForecast?: string;
  presence: CompanionBusinessPresence;
  currentActivity?: ItineraryActivity;
  previousActivity?: ItineraryActivity;
  nextActivity?: ItineraryActivity;
  arrivalContext?: ArrivalContext;
  route?: ActivityRoute;
  note?: string;
  phaseLabel?: TripPhase | "system";
  source: ResolvedAgentStateSource;
}

export interface ResolvedAgentState {
  identity: ResolvedAgentIdentity;
  stage: ResolvedAgentStage;
  state: ResolvedAgentStageState;
  policy: ResolvedAgentPolicy;
  block: AgentStateBlock;
}

export interface CompanionBusinessSituation {
  mode: CompanionBusinessMode;
  state: CompanionStateGroup;
  substate: CompanionStateSubstate;
  scene: CompanionBusinessScene;
  presence: CompanionBusinessPresence;
  currentPhase: TripPhase | "system";
  currentDay: number;
  contextKind: RuntimeStepContext["kind"] | "none";
  sendMoment: RuntimeStepContext["sendMoment"] | "none";
  isExtraMessage: boolean;
  postcardEligible: boolean;
  replyDelayMs: number;
  stateStartedAt?: string;
  stateEndsAt?: string;
}

export interface CompanionStateTimingWindow {
  startedAt: string;
  endsAt?: string;
}

export interface CompanionStateSnapshot {
  situation: CompanionBusinessSituation;
  timing: CompanionStateTimingWindow;
  currentActivity?: ItineraryActivity;
  previousActivity?: ItineraryActivity;
  nextActivity?: ItineraryActivity;
  weatherForecast?: string;
}

export interface CompanionStateAnchor {
  source: "postcard";
  stepId: string;
  stateBlockId: string;
  sentAt: string;
  expiresAt: string;
  snapshot?: CompanionStateSnapshot;
}

export interface InstantReplyWindow {
  source: "reply" | "postcard";
  triggerAt: string;
  expiresAt: string;
  cap: number;
  usedCount: number;
}

export interface ConversationCompanionState {
  conversationKey: string;
  mode: ConversationMode;
  setupSession?: SetupSession;
  pendingUserMessages: InboundUserMessage[];
  pendingReplyDispatch: PendingReplyDispatch | null;
  instantReplyWindow: InstantReplyWindow | null;
  recentHandledCommandMessageIds: string[];
  recentTurns: CompanionTurn[];
  latestPostcardPhoto?: RecentPostcardPhotoContext;
  idleGuideSentAt?: string | null;
  awaitingDestination?: boolean;
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
    resolvedState: ResolvedAgentState;
    imagePrompt: string;
  }): Promise<{ caption: string; provider: string }>;
  composeCompanionReply(input: {
    conversationKey: string;
    persona: StoredPersonaProfile | null;
    pendingUserMessages: InboundUserMessage[];
    recentTurns: CompanionTurn[];
    latestPostcardPhoto?: RecentPostcardPhotoContext;
    activeTrip: TripRecord | null;
    resolvedState: ResolvedAgentState;
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

export interface GlobalConfigRepository {
  get(): Promise<TravelCompanionGlobalConfig>;
  save(config: TravelCompanionGlobalConfig): Promise<void>;
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
