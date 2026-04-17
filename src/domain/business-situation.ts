import {
  CompanionStateAnchor,
  CompanionStateSnapshot,
  CompanionStateTimingWindow,
  CompanionBusinessSituation,
  CompanionBusinessPresence,
  CompanionBusinessScene,
  CompanionStateGroup,
  CompanionStateSubstate,
  ConversationCompanionState,
  InstantReplyWindow,
  ItineraryActivity,
  ResolvedAgentIdentity,
  ResolvedAgentPolicy,
  ResolvedAgentState,
  TimelineStep,
  TransitMode,
  TripRecord,
  StoredPersonaProfile,
} from "./types.js";
import { stableRange } from "./stable-random.js";
import { parseItineraryTimeToken } from "./itinerary-time.js";

type SeenPolicy =
  | { kind: "range"; minMinutes: number; maxMinutes: number }
  | { kind: "until_state_end" }
  | { kind: "defer_to_next_state" };

interface StateStrategy {
  seenPolicy: SeenPolicy;
  hotWindowMinutes: { min: number; max: number };
  instantReplyCap: { min: number; max: number };
}

interface DerivedStateResult {
  source?: "clock" | "anchor";
  situation: CompanionBusinessSituation;
  timing: CompanionStateTimingWindow;
  currentActivity?: ItineraryActivity;
  previousActivity?: ItineraryActivity;
  nextActivity?: ItineraryActivity;
  weatherForecast?: string;
  latestPostcardSentAt?: string;
}

const DEFAULT_SINGLE_SLOT_MINUTES = 30;

const TIME_ZONE_MAP: Array<[RegExp, string]> = [
  [/tokyo|東京/u, "Asia/Tokyo"],
  [/osaka|kyoto|京都|大阪/u, "Asia/Tokyo"],
  [/shanghai|上海|beijing|北京|tianjin|天津/u, "Asia/Shanghai"],
  [/hong\s*kong|香港/u, "Asia/Hong_Kong"],
  [/taipei|台北/u, "Asia/Taipei"],
  [/seoul|首爾|首尔/u, "Asia/Seoul"],
  [/singapore|新加坡/u, "Asia/Singapore"],
  [/istanbul|伊斯坦布尔/u, "Europe/Istanbul"],
  [/chiang\s*mai|清迈/u, "Asia/Bangkok"],
  [/paris|巴黎/u, "Europe/Paris"],
  [/london|伦敦/u, "Europe/London"],
  [/new\s*york|纽约/u, "America/New_York"],
  [/los\s*angeles|洛杉矶/u, "America/Los_Angeles"],
];

const STATE_STRATEGIES: Record<string, StateStrategy> = {
  "idle.idle": {
    seenPolicy: { kind: "range", minMinutes: 0, maxMinutes: 10 },
    hotWindowMinutes: { min: 1, max: 3 },
    instantReplyCap: { min: 3, max: 5 },
  },
  "plan.planning": {
    seenPolicy: { kind: "defer_to_next_state" },
    hotWindowMinutes: { min: 1, max: 3 },
    instantReplyCap: { min: 3, max: 5 },
  },
  "plan.packing": {
    seenPolicy: { kind: "range", minMinutes: 1, maxMinutes: 5 },
    hotWindowMinutes: { min: 1, max: 3 },
    instantReplyCap: { min: 3, max: 4 },
  },
  "departure.before_departure": {
    seenPolicy: { kind: "range", minMinutes: 1, maxMinutes: 5 },
    hotWindowMinutes: { min: 1, max: 2 },
    instantReplyCap: { min: 2, max: 4 },
  },
  "departure.departing": {
    seenPolicy: { kind: "until_state_end" },
    hotWindowMinutes: { min: 1, max: 2 },
    instantReplyCap: { min: 1, max: 3 },
  },
  "departure.arrive": {
    seenPolicy: { kind: "range", minMinutes: 3, maxMinutes: 5 },
    hotWindowMinutes: { min: 1, max: 3 },
    instantReplyCap: { min: 4, max: 6 },
  },
  "activities.freetime": {
    seenPolicy: { kind: "range", minMinutes: 1, maxMinutes: 3 },
    hotWindowMinutes: { min: 2, max: 3 },
    instantReplyCap: { min: 4, max: 6 },
  },
  "activities.moving_to_next_activity": {
    seenPolicy: { kind: "range", minMinutes: 1, maxMinutes: 3 },
    hotWindowMinutes: { min: 1, max: 2 },
    instantReplyCap: { min: 2, max: 4 },
  },
  "activities.transport": {
    seenPolicy: { kind: "range", minMinutes: 1, maxMinutes: 3 },
    hotWindowMinutes: { min: 1, max: 2 },
    instantReplyCap: { min: 1, max: 4 },
  },
  "activities.sightseeing": {
    seenPolicy: { kind: "range", minMinutes: 5, maxMinutes: 10 },
    hotWindowMinutes: { min: 1, max: 3 },
    instantReplyCap: { min: 3, max: 5 },
  },
  "activities.food": {
    seenPolicy: { kind: "range", minMinutes: 1, maxMinutes: 3 },
    hotWindowMinutes: { min: 1, max: 3 },
    instantReplyCap: { min: 4, max: 6 },
  },
  "activities.accommodation": {
    seenPolicy: { kind: "range", minMinutes: 1, maxMinutes: 3 },
    hotWindowMinutes: { min: 2, max: 3 },
    instantReplyCap: { min: 4, max: 6 },
  },
  "activities.shopping": {
    seenPolicy: { kind: "range", minMinutes: 5, maxMinutes: 10 },
    hotWindowMinutes: { min: 1, max: 3 },
    instantReplyCap: { min: 3, max: 5 },
  },
  "return.departing": {
    seenPolicy: { kind: "until_state_end" },
    hotWindowMinutes: { min: 1, max: 2 },
    instantReplyCap: { min: 1, max: 3 },
  },
  "return.arrive": {
    seenPolicy: { kind: "range", minMinutes: 1, maxMinutes: 3 },
    hotWindowMinutes: { min: 1, max: 3 },
    instantReplyCap: { min: 4, max: 6 },
  },
};

function inferTimeZoneFromText(text: string): string {
  const normalized = text.trim().toLowerCase();
  if (normalized.includes("qingdao")) {
    return "Asia/Shanghai";
  }
  for (const [pattern, timeZone] of TIME_ZONE_MAP) {
    if (pattern.test(normalized)) {
      return timeZone;
    }
  }
  return "UTC";
}

function parseDateParts(date: string): { year: number; month: number; day: number } {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) {
    throw new Error(`Invalid itinerary date: ${date}`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function addDaysToDateParts(input: {
  year: number;
  month: number;
  day: number;
  dayOffset: number;
}): { year: number; month: number; day: number } {
  const shifted = new Date(
    Date.UTC(input.year, input.month - 1, input.day + input.dayOffset),
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function formatPartsInTimeZone(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const partValue = (type: string): number => {
    const part = parts.find((entry) => entry.type === type)?.value;
    if (!part) {
      throw new Error(`Missing formatted time zone part: ${type}`);
    }
    return Number(part);
  };

  return {
    year: partValue("year"),
    month: partValue("month"),
    day: partValue("day"),
    hour: partValue("hour"),
    minute: partValue("minute"),
  };
}

function toUtcDate(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
}): Date {
  let guess = new Date(
    Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute),
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = formatPartsInTimeZone(guess, input.timeZone);
    const targetAsUtc = Date.UTC(
      input.year,
      input.month - 1,
      input.day,
      input.hour,
      input.minute,
    );
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    const delta = targetAsUtc - actualAsUtc;
    if (delta === 0) {
      break;
    }
    guess = new Date(guess.getTime() + delta);
  }

  return guess;
}

function durationMinutesFromRange(
  start: { hour: number; minute: number; dayOffset?: number },
  end: { hour: number; minute: number; dayOffset?: number },
): number {
  const startMinutes =
    (start.dayOffset ?? 0) * 24 * 60 + start.hour * 60 + start.minute;
  const endMinutes =
    (end.dayOffset ?? 0) * 24 * 60 + end.hour * 60 + end.minute;
  return endMinutes >= startMinutes
    ? endMinutes - startMinutes
    : 24 * 60 - (start.hour * 60 + start.minute) + end.hour * 60 + end.minute;
}

function resolveActivityWindow(input: {
  date: string;
  timeSlot: string;
  timeZone: string;
}): { startUtc: Date; endUtc: Date } {
  const rangeMatch = input.timeSlot.match(
    /^\s*(\d{1,2}:\d{2}(?:\s*\(\+\d+\))?)\s*-\s*(\d{1,2}:\d{2}(?:\s*\(\+\d+\))?)\s*$/u,
  );
  const singleMatch = input.timeSlot.match(
    /^\s*(\d{1,2}:\d{2}(?:\s*\(\+\d+\))?)\s*$/u,
  );
  if (!rangeMatch && !singleMatch) {
    throw new Error(`Unsupported itinerary time_slot: ${input.timeSlot}`);
  }

  const baseDate = parseDateParts(input.date);
  const startParts = parseItineraryTimeToken(
    (rangeMatch?.[1] ?? singleMatch?.[1])!,
    { baseDate: input.date },
  );
  const endParts = rangeMatch
    ? parseItineraryTimeToken(rangeMatch[2]!, { baseDate: input.date })
    : {
        hour: startParts.hour,
        minute: startParts.minute + DEFAULT_SINGLE_SLOT_MINUTES,
        dayOffset: startParts.dayOffset,
      };

  const startDate = addDaysToDateParts({
    ...baseDate,
    dayOffset: startParts.dayOffset,
  });
  const startUtc = toUtcDate({
    ...startDate,
    hour: startParts.hour,
    minute: startParts.minute,
    timeZone: input.timeZone,
  });

  const durationMinutes = rangeMatch
    ? durationMinutesFromRange(startParts, endParts)
    : DEFAULT_SINGLE_SLOT_MINUTES;
  const endUtc = new Date(startUtc.getTime() + durationMinutes * 60 * 1000);

  return { startUtc, endUtc };
}

function resolveDepartureWindow(record: TripRecord): {
  beforeStart: Date;
  departStart: Date;
  arriveAt: Date;
  arriveEnd: Date;
  transportMode: TransitMode;
} {
  const firstDate = record.plan.daily_itinerary[0]!.date;
  const departureLeg = record.plan.transportation.departure;
  const departureTimeZone = inferTimeZoneFromText(record.request.originCity);
  const arrivalTimeZone = inferTimeZoneFromText(record.request.destinationCity);

  const arrivalToken = parseItineraryTimeToken(departureLeg.arrival.time, {
    baseDate: firstDate,
  });
  const arrivalDate = addDaysToDateParts({
    ...parseDateParts(firstDate),
    dayOffset: arrivalToken.dayOffset,
  });
  const arriveAt = toUtcDate({
    ...arrivalDate,
    hour: arrivalToken.hour,
    minute: arrivalToken.minute,
    timeZone: arrivalTimeZone,
  });

  const departureToken = parseItineraryTimeToken(departureLeg.departure.time, {
    baseDate: firstDate,
  });
  let departAt = arriveAt;
  for (const offset of [-2, -1, 0, 1]) {
    const candidateDate = addDaysToDateParts({
      ...parseDateParts(firstDate),
      dayOffset: offset + departureToken.dayOffset,
    });
    const candidate = toUtcDate({
      ...candidateDate,
      hour: departureToken.hour,
      minute: departureToken.minute,
      timeZone: departureTimeZone,
    });
    if (candidate.getTime() <= arriveAt.getTime()) {
      departAt = candidate;
    }
  }

  return {
    beforeStart: new Date(departAt.getTime() - 3 * 60 * 60 * 1000),
    departStart: new Date(departAt.getTime() - 15 * 60 * 1000),
    arriveAt,
    arriveEnd: new Date(arriveAt.getTime() + 10 * 60 * 1000),
    transportMode: departureLeg.transport_mode,
  };
}

function resolveReturnWindow(record: TripRecord): {
  departStart: Date;
  arriveAt: Date;
  arriveEnd: Date;
  transportMode: TransitMode;
} {
  const lastDate = record.plan.daily_itinerary[record.plan.daily_itinerary.length - 1]!.date;
  const returnLeg = record.plan.transportation.return;
  const departureTimeZone = inferTimeZoneFromText(record.request.destinationCity);
  const arrivalTimeZone = inferTimeZoneFromText(record.request.originCity);

  const departureToken = parseItineraryTimeToken(returnLeg.departure.time, {
    baseDate: lastDate,
  });
  const departureDate = addDaysToDateParts({
    ...parseDateParts(lastDate),
    dayOffset: departureToken.dayOffset,
  });
  const departAt = toUtcDate({
    ...departureDate,
    hour: departureToken.hour,
    minute: departureToken.minute,
    timeZone: departureTimeZone,
  });

  const arrivalToken = parseItineraryTimeToken(returnLeg.arrival.time, {
    baseDate: lastDate,
  });
  let arriveAt = departAt;
  for (const offset of [0, 1, 2]) {
    const candidateDate = addDaysToDateParts({
      ...parseDateParts(lastDate),
      dayOffset: offset + arrivalToken.dayOffset,
    });
    const candidate = toUtcDate({
      ...candidateDate,
      hour: arrivalToken.hour,
      minute: arrivalToken.minute,
      timeZone: arrivalTimeZone,
    });
    if (candidate.getTime() >= departAt.getTime()) {
      arriveAt = candidate;
      break;
    }
  }

  return {
    departStart: new Date(departAt.getTime() - 15 * 60 * 1000),
    arriveAt,
    arriveEnd: new Date(arriveAt.getTime() + 10 * 60 * 1000),
    transportMode: returnLeg.transport_mode,
  };
}

function looksLikeAirport(activityOrText: ItineraryActivity | string): boolean {
  const haystack =
    typeof activityOrText === "string"
      ? activityOrText
      : [
          activityOrText.location,
          activityOrText.address,
          activityOrText.description,
          activityOrText.route?.from_location,
          activityOrText.route?.to_location,
          activityOrText.arrival_context.from_location,
        ]
          .filter(Boolean)
          .join(" ");

  return /airport|terminal|gate|boarding|機場|机场|航站/u.test(
    haystack.toLowerCase(),
  );
}

function latestPostcardSentAt(activeTrip: TripRecord | null): string | undefined {
  if (!activeTrip) {
    return undefined;
  }
  return activeTrip.state.artifacts
    .filter((artifact) => artifact.kind === "delivery")
    .map((artifact) => artifact.createdAt)
    .sort()
    .at(-1);
}

function makeSituation(input: {
  mode: CompanionBusinessSituation["mode"];
  state: CompanionStateGroup;
  substate: CompanionStateSubstate;
  scene: CompanionBusinessScene;
  presence: CompanionBusinessPresence;
  currentPhase: CompanionBusinessSituation["currentPhase"];
  currentDay: number;
  contextKind: CompanionBusinessSituation["contextKind"];
  sendMoment: CompanionBusinessSituation["sendMoment"];
  isExtraMessage: boolean;
  postcardEligible: boolean;
  timing: CompanionStateTimingWindow;
}): CompanionBusinessSituation {
  const strategy = requireStrategy(input.state, input.substate);
  const replyDelayMs =
    strategy.seenPolicy.kind === "range"
      ? Math.round(
          ((strategy.seenPolicy.minMinutes + strategy.seenPolicy.maxMinutes) / 2) *
            60 *
            1000,
        )
      : 0;
  return {
    mode: input.mode,
    state: input.state,
    substate: input.substate,
    scene: input.scene,
    presence: input.presence,
    currentPhase: input.currentPhase,
    currentDay: input.currentDay,
    contextKind: input.contextKind,
    sendMoment: input.sendMoment,
    isExtraMessage: input.isExtraMessage,
    postcardEligible: input.postcardEligible,
    replyDelayMs,
    stateStartedAt: input.timing.startedAt,
    stateEndsAt: input.timing.endsAt,
  };
}

function strategyFor(situation: CompanionBusinessSituation): StateStrategy {
  return requireStrategy(situation.state, situation.substate);
}

function requireStrategy(
  state: CompanionStateGroup,
  substate: CompanionStateSubstate,
): StateStrategy {
  const strategy = STATE_STRATEGIES[`${state}.${substate}`];
  if (!strategy) {
    throw new Error(`Missing state strategy for ${state}.${substate}`);
  }
  return strategy;
}

function buildStateBlockId(input: {
  state: CompanionStateGroup;
  substate: CompanionStateSubstate;
  day: number;
  startedAt: string;
  endsAt?: string;
  location?: string;
}): string {
  return [
    input.state,
    input.substate,
    input.day,
    input.startedAt,
    input.endsAt ?? "open",
    input.location ?? "none",
  ].join("::");
}

function resolvePersonaOriginCity(
  persona?: StoredPersonaProfile | null,
): string | undefined {
  if (!persona) {
    return undefined;
  }

  return persona.originCity || persona.homeCity;
}

function buildResolvedIdentity(input: {
  activeTrip: TripRecord | null;
  conversationState?: ConversationCompanionState | null;
  persona?: StoredPersonaProfile | null;
}): ResolvedAgentIdentity {
  return {
    personaId: input.persona?.personaId ?? input.activeTrip?.personaId ?? null,
      personaSummary: input.persona
        ? [
            `Name: ${input.persona.name}`,
            `Residence city: ${resolvePersonaOriginCity(input.persona) ?? "unknown"}`,
            `Personality traits: ${input.persona.traits.join(", ")}`,
            `Tone style: ${input.persona.toneStyle}`,
            `Relationship to user: ${input.persona.relationship}`,
            `How you address the user: ${input.persona.userAddressing || "未设置"}`,
        ].join("\n")
      : undefined,
    relationshipSummary: input.persona?.relationship,
    memorySummary: input.conversationState?.memorySummary,
  };
}

function buildResolvedPolicy(
  situation: CompanionBusinessSituation,
): ResolvedAgentPolicy {
  const strategy = strategyFor(situation);
  return {
    seenPolicy: strategy.seenPolicy,
    hotWindowMinutes: strategy.hotWindowMinutes,
    instantReplyCap: strategy.instantReplyCap,
    allowCarryToNextState: strategy.seenPolicy.kind !== "range",
  };
}

function resolveStateLocation(input: {
  activeTrip: TripRecord | null;
  derived: DerivedStateResult;
  persona?: StoredPersonaProfile | null;
}): string | undefined {
  if (input.derived.currentActivity?.location) {
    return input.derived.currentActivity.location;
  }

  if (input.derived.previousActivity?.location) {
    return input.derived.previousActivity.location;
  }

  switch (input.derived.situation.state) {
    case "plan":
      return (
        resolvePersonaOriginCity(input.persona) ??
        input.activeTrip?.request.originCity ??
        undefined
      );
    case "departure":
      return input.derived.situation.substate === "arrive"
        ? input.activeTrip?.request.destinationCity ??
            input.activeTrip?.plan.metadata.destination
        : input.activeTrip?.request.originCity;
    case "return":
      return input.derived.situation.substate === "arrive"
        ? input.activeTrip?.request.originCity
        : input.activeTrip?.request.destinationCity ??
            input.activeTrip?.plan.metadata.destination;
    case "idle":
      return (
        resolvePersonaOriginCity(input.persona) ??
        input.activeTrip?.request.originCity ??
        undefined
      );
    default:
      return (
        resolvePersonaOriginCity(input.persona) ??
        input.activeTrip?.request.originCity ??
        undefined
      );
  }
}

function buildResolvedStateFromDerived(input: {
  activeTrip: TripRecord | null;
  derived: DerivedStateResult;
  conversationState?: ConversationCompanionState | null;
  persona?: StoredPersonaProfile | null;
}): ResolvedAgentState {
  const location = resolveStateLocation({
    activeTrip: input.activeTrip,
    derived: input.derived,
    persona: input.persona,
  });
  const timeZone =
    input.derived.currentActivity?.route?.transport_mode === "airplane" &&
    input.derived.situation.state === "return"
      ? inferTimeZoneFromText(input.activeTrip?.request.originCity ?? "UTC")
      : inferTimeZoneFromText(
          input.derived.currentActivity?.location ??
            location ??
            input.activeTrip?.plan.metadata.destination ??
            input.activeTrip?.request.destinationCity ??
            input.activeTrip?.request.originCity ??
            "UTC",
        );
  const blockId = buildStateBlockId({
    state: input.derived.situation.state,
    substate: input.derived.situation.substate,
    day: input.derived.situation.currentDay,
    startedAt: input.derived.timing.startedAt,
    endsAt: input.derived.timing.endsAt,
    location,
  });

  return {
    identity: buildResolvedIdentity({
      activeTrip: input.activeTrip,
      conversationState: input.conversationState,
      persona: input.persona,
    }),
    stage: {
      substate: input.derived.situation.substate,
      group: input.derived.situation.state,
      startedAtUtc: input.derived.timing.startedAt,
      endsAtUtc: input.derived.timing.endsAt,
      day: input.derived.situation.currentDay,
      timeZone,
    },
    state: {
      location,
      address:
        input.derived.currentActivity?.address ??
        input.derived.previousActivity?.address,
      weatherForecast: input.derived.weatherForecast,
      presence: input.derived.situation.presence,
      currentActivity: input.derived.currentActivity,
      previousActivity: input.derived.previousActivity,
      nextActivity: input.derived.nextActivity,
      arrivalContext: input.derived.currentActivity?.arrival_context,
      route: input.derived.currentActivity?.route,
      note: input.derived.currentActivity?.description,
      phaseLabel: input.derived.situation.currentPhase,
      source: input.derived.source ?? "clock",
    },
    policy: buildResolvedPolicy(input.derived.situation),
    block: {
      blockId,
      group: input.derived.situation.state,
      substate: input.derived.situation.substate,
      sourceKind:
        input.derived.situation.contextKind === "planning"
          ? "synthetic_plan"
          : input.derived.situation.contextKind === "activity" &&
              input.derived.currentActivity
            ? "activity"
            : input.derived.situation.state === "idle"
              ? "synthetic_idle"
              : input.derived.situation.substate === "freetime"
                ? "synthetic_gap"
                : input.derived.situation.substate === "moving_to_next_activity"
                  ? "synthetic_transition"
                  : "transportation_leg",
      startedAtUtc: input.derived.timing.startedAt,
      endsAtUtc: input.derived.timing.endsAt,
      day: input.derived.situation.currentDay,
      timeZone,
      location,
      address:
        input.derived.currentActivity?.address ??
        input.derived.previousActivity?.address,
      weatherForecast: input.derived.weatherForecast,
      presence: input.derived.situation.presence,
      currentActivity: input.derived.currentActivity,
      previousActivity: input.derived.previousActivity,
      nextActivity: input.derived.nextActivity,
      arrivalContext: input.derived.currentActivity?.arrival_context,
      route: input.derived.currentActivity?.route,
      note: input.derived.currentActivity?.description,
      phaseLabel: input.derived.situation.currentPhase,
      contextKind: input.derived.situation.contextKind,
      sendMoment: input.derived.situation.sendMoment,
      isExtraMessage: input.derived.situation.isExtraMessage,
      postcardEligible: input.derived.situation.postcardEligible,
    },
  };
}

function transportScene(mode: TransitMode, labelSource: string): CompanionBusinessScene {
  if (mode === "airplane" || looksLikeAirport(labelSource)) {
    return "airport";
  }
  return "transport";
}

function makeSnapshot(input: {
  situation: CompanionBusinessSituation;
  timing: CompanionStateTimingWindow;
  currentActivity?: ItineraryActivity;
  previousActivity?: ItineraryActivity;
  nextActivity?: ItineraryActivity;
  weatherForecast?: string;
}): CompanionStateSnapshot {
  return {
    situation: input.situation,
    timing: input.timing,
    currentActivity: input.currentActivity,
    previousActivity: input.previousActivity,
    nextActivity: input.nextActivity,
    weatherForecast: input.weatherForecast,
  };
}

function deriveSnapshotFromTimelineStep(
  record: TripRecord,
  step: TimelineStep,
): CompanionStateSnapshot | null {
  const context = step.context;
  if (!context) {
    return null;
  }

  const weatherForecast =
    record.plan.daily_itinerary.find((entry) => entry.day === step.day)
      ?.weather_forecast;

  if (step.stateOverride) {
    const timing = {
      startedAt: context.timing.startUtc,
      endsAt: context.timing.endUtc,
    };
    const isPlanState = step.stateOverride.group === "plan";
    return makeSnapshot({
      situation: makeSituation({
        mode:
          step.stateOverride.group === "idle"
            ? "idle"
            : step.stateOverride.group === "return" &&
                step.stateOverride.substate === "arrive"
              ? "trip-finished"
              : "traveling",
        state: step.stateOverride.group,
        substate: step.stateOverride.substate,
        scene: step.stateOverride.scene,
        presence: step.stateOverride.presence,
        currentPhase: step.stateOverride.currentPhase,
        currentDay: step.day,
        contextKind: context.kind,
        sendMoment: context.sendMoment,
        isExtraMessage: context.isExtraMessage,
        postcardEligible: step.emitsPostcard,
        timing,
      }),
      timing,
      currentActivity: isPlanState ? undefined : context.activity,
      previousActivity: isPlanState ? undefined : context.previousActivity,
      nextActivity: context.nextActivity,
      weatherForecast,
    });
  }

  if (context.kind === "planning") {
    const timing = {
      startedAt: context.timing.startUtc,
      endsAt: context.timing.endUtc,
    };
    return makeSnapshot({
      situation: makeSituation({
        mode: "traveling",
        state: "plan",
        substate: "packing",
        scene: "planning",
        presence: "busy",
        currentPhase: "planning",
        currentDay: 0,
        contextKind: "planning",
        sendMoment: context.sendMoment,
        isExtraMessage: context.isExtraMessage,
        postcardEligible: true,
        timing,
      }),
      timing,
      currentActivity: undefined,
      previousActivity: undefined,
      nextActivity: context.nextActivity,
      weatherForecast,
    });
  }

  if (context.kind === "home_reflection") {
    const timing = {
      startedAt: context.timing.startUtc,
      endsAt: context.timing.endUtc,
    };
    return makeSnapshot({
      situation: makeSituation({
        mode: "trip-finished",
        state: "return",
        substate: "arrive",
        scene: "reflection",
        presence: "available",
        currentPhase: "home_reflection",
        currentDay: step.day,
        contextKind: "home_reflection",
        sendMoment: context.sendMoment,
        isExtraMessage: context.isExtraMessage,
        postcardEligible: true,
        timing,
      }),
      timing,
      currentActivity: context.activity,
      previousActivity: context.previousActivity,
      nextActivity: context.nextActivity,
      weatherForecast,
    });
  }

  const activity = context.activity;
  const substate = activity.type;
  const scene =
    activity.type === "transport"
      ? transportScene(
          activity.route?.transport_mode ?? activity.arrival_context.transport_mode,
          activity.location,
        )
      : activity.type === "accommodation"
        ? "hotel"
        : (activity.type as Exclude<
            CompanionBusinessScene,
            "idle" | "planning" | "airport" | "transport" | "hotel" | "reflection"
          >);
  const presence: CompanionBusinessPresence =
    activity.type === "transport"
      ? "moving"
      : activity.type === "accommodation"
        ? "resting"
        : "available";
  const state =
    activity.type === "transport" && step.phase === "returning"
      ? "return"
      : activity.type === "transport" ||
          activity.type === "sightseeing" ||
          activity.type === "food" ||
          activity.type === "accommodation" ||
          activity.type === "shopping"
        ? "activities"
        : "activities";
  const timing = {
    startedAt: context.timing.startUtc,
    endsAt: context.timing.endUtc,
  };
  const derivedSubstate = state === "return" ? "departing" : substate;

  return makeSnapshot({
    situation: makeSituation({
      mode: "traveling",
      state,
      substate: derivedSubstate,
      scene,
      presence,
      currentPhase: step.phase,
      currentDay: step.day,
      contextKind: context.kind,
      sendMoment: context.sendMoment,
      isExtraMessage: context.isExtraMessage,
      postcardEligible: step.emitsPostcard,
      timing,
    }),
    timing,
    currentActivity: activity,
    previousActivity: context.previousActivity,
    nextActivity: context.nextActivity,
    weatherForecast,
  });
}

export function createStateAnchorFromTimelineStep(input: {
  record: TripRecord;
  step: TimelineStep;
  sentAt: string;
}): CompanionStateAnchor | null {
  const snapshot = deriveSnapshotFromTimelineStep(input.record, input.step);
  if (!snapshot) {
    return null;
  }

  const sentAtMs = new Date(input.sentAt).getTime();
  const naturalEndMs = snapshot.timing.endsAt
    ? new Date(snapshot.timing.endsAt).getTime()
    : Number.POSITIVE_INFINITY;
  const expiresAtMs = Math.min(naturalEndMs, sentAtMs + 30 * 60 * 1000);

  return {
    source: "postcard",
    stepId: input.step.stepId,
    stateBlockId: buildStateBlockId({
      state: snapshot.situation.state,
      substate: snapshot.situation.substate,
      day: snapshot.situation.currentDay,
      startedAt: snapshot.timing.startedAt,
      endsAt: snapshot.timing.endsAt,
      location:
        snapshot.currentActivity?.location ?? snapshot.previousActivity?.location,
    }),
    sentAt: input.sentAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
    snapshot,
  };
}

export function resolveAgentState(input: {
  activeTrip: TripRecord | null;
  conversationState?: ConversationCompanionState | null;
  now?: Date;
  persona?: StoredPersonaProfile | null;
}): ResolvedAgentState {
  const derived = deriveCompanionState(
    input.activeTrip,
    input.now ?? new Date(),
  );
  return buildResolvedStateFromDerived({
    activeTrip: input.activeTrip,
    derived,
    conversationState: input.conversationState,
    persona: input.persona,
  });
}

export function resolveAgentStateForTimelineStep(input: {
  record: TripRecord;
  step: TimelineStep;
  conversationState?: ConversationCompanionState | null;
  persona?: StoredPersonaProfile | null;
}): ResolvedAgentState {
  const snapshot = deriveSnapshotFromTimelineStep(input.record, input.step);
  if (snapshot) {
    const derived: DerivedStateResult = {
      source: "clock",
      situation: snapshot.situation,
      timing: snapshot.timing,
      currentActivity: snapshot.currentActivity,
      previousActivity: snapshot.previousActivity,
      nextActivity: snapshot.nextActivity,
      weatherForecast: snapshot.weatherForecast,
    };
    const resolved = buildResolvedStateFromDerived({
      activeTrip: input.record,
      derived,
      conversationState: input.conversationState,
      persona: input.persona,
    });
    return resolved;
  }

  return resolveAgentState({
    activeTrip: input.record,
    conversationState: input.conversationState,
    now: new Date(input.step.scheduledAt),
    persona: input.persona,
  });
}

export function deriveCompanionBusinessSituation(
  activeTrip: TripRecord | null,
  now: Date = new Date(),
): CompanionBusinessSituation {
  return deriveCompanionState(activeTrip, now).situation;
}

export function deriveCompanionState(
  activeTrip: TripRecord | null,
  now: Date = new Date(),
): DerivedStateResult {
  if (!activeTrip) {
    return {
      situation: makeSituation({
        mode: "idle",
        state: "idle",
        substate: "idle",
        scene: "idle",
        presence: "available",
        currentPhase: "system",
        currentDay: 0,
        contextKind: "none",
        sendMoment: "none",
        isExtraMessage: false,
        postcardEligible: false,
        timing: { startedAt: now.toISOString() },
      }),
      timing: { startedAt: now.toISOString() },
    };
  }

  const latestDelivery = latestPostcardSentAt(activeTrip);
  const anchor = activeTrip.state.activeStateAnchor;
  if (
    anchor?.snapshot &&
    new Date(anchor.expiresAt).getTime() > now.getTime()
  ) {
    return {
      source: "anchor",
      ...anchor.snapshot,
      latestPostcardSentAt: latestDelivery,
    };
  }

  const departureWindow = resolveDepartureWindow(activeTrip);
  const returnWindow = resolveReturnWindow(activeTrip);
  const tripCreatedAt = new Date(activeTrip.createdAt);
  const planningEndsAt = new Date(
    Math.min(
      tripCreatedAt.getTime() + 60 * 1000,
      departureWindow.beforeStart.getTime(),
    ),
  );

  if (now.getTime() < planningEndsAt.getTime()) {
    const timing = {
      startedAt: tripCreatedAt.toISOString(),
      endsAt: planningEndsAt.toISOString(),
    };
    return {
      situation: makeSituation({
        mode: "traveling",
        state: "plan",
        substate: "planning",
        scene: "planning",
        presence: "busy",
        currentPhase: "planning",
        currentDay: 0,
        contextKind: "planning",
        sendMoment: "summary",
        isExtraMessage: false,
        postcardEligible: true,
        timing,
      }),
      timing,
      weatherForecast: activeTrip.plan.daily_itinerary[0]?.weather_forecast,
      latestPostcardSentAt: latestDelivery,
    };
  }

  if (now.getTime() < departureWindow.beforeStart.getTime()) {
    const timing = {
      startedAt: planningEndsAt.toISOString(),
      endsAt: departureWindow.beforeStart.toISOString(),
    };
    return {
      situation: makeSituation({
        mode: "traveling",
        state: "plan",
        substate: "packing",
        scene: "planning",
        presence: "busy",
        currentPhase: "planning",
        currentDay: 0,
        contextKind: "planning",
        sendMoment: "summary",
        isExtraMessage: false,
        postcardEligible: true,
        timing,
      }),
      timing,
      weatherForecast: activeTrip.plan.daily_itinerary[0]?.weather_forecast,
      latestPostcardSentAt: latestDelivery,
    };
  }

  if (now.getTime() < departureWindow.departStart.getTime()) {
    const timing = {
      startedAt: departureWindow.beforeStart.toISOString(),
      endsAt: departureWindow.departStart.toISOString(),
    };
    return {
      situation: makeSituation({
        mode: "traveling",
        state: "departure",
        substate: "before_departure",
        scene: "planning",
        presence: "busy",
        currentPhase: "departing",
        currentDay: 1,
        contextKind: "planning",
        sendMoment: "summary",
        isExtraMessage: false,
        postcardEligible: true,
        timing,
      }),
      timing,
      weatherForecast: activeTrip.plan.daily_itinerary[0]?.weather_forecast,
      latestPostcardSentAt: latestDelivery,
    };
  }

  if (now.getTime() < departureWindow.arriveAt.getTime()) {
    const timing = {
      startedAt: departureWindow.departStart.toISOString(),
      endsAt: departureWindow.arriveAt.toISOString(),
    };
    return {
      situation: makeSituation({
        mode: "traveling",
        state: "departure",
        substate: "departing",
        scene: transportScene(
          departureWindow.transportMode,
          activeTrip.plan.transportation.departure.departure.station,
        ),
        presence: "moving",
        currentPhase: "departing",
        currentDay: 1,
        contextKind: "planning",
        sendMoment: "summary",
        isExtraMessage: false,
        postcardEligible: true,
        timing,
      }),
      timing,
      weatherForecast: activeTrip.plan.daily_itinerary[0]?.weather_forecast,
      latestPostcardSentAt: latestDelivery,
    };
  }

  if (now.getTime() < departureWindow.arriveEnd.getTime()) {
    const timing = {
      startedAt: departureWindow.arriveAt.toISOString(),
      endsAt: departureWindow.arriveEnd.toISOString(),
    };
    return {
      situation: makeSituation({
        mode: "traveling",
        state: "departure",
        substate: "arrive",
        scene: transportScene(
          departureWindow.transportMode,
          activeTrip.plan.transportation.departure.arrival.station,
        ),
        presence: "available",
        currentPhase: "arrival_checkin",
        currentDay: 1,
        contextKind: "activity",
        sendMoment: "start",
        isExtraMessage: false,
        postcardEligible: true,
        timing,
      }),
      timing,
      weatherForecast: activeTrip.plan.daily_itinerary[0]?.weather_forecast,
      latestPostcardSentAt: latestDelivery,
    };
  }

  const timeZone = inferTimeZoneFromText(activeTrip.plan.metadata.destination);
  let cursor = departureWindow.arriveEnd;
  let previousActivity: ItineraryActivity | undefined;

  for (const day of activeTrip.plan.daily_itinerary) {
    const weatherForecast = day.weather_forecast;
    for (let index = 0; index < day.activities.length; index += 1) {
      const activity = day.activities[index]!;
      const nextActivity =
        index < day.activities.length - 1 ? day.activities[index + 1] : undefined;
      const window = resolveActivityWindow({
        date: day.date,
        timeSlot: activity.time_slot,
        timeZone,
      });
      const movingStart = new Date(
        window.startUtc.getTime() -
          activity.arrival_context.duration_minutes * 60 * 1000,
      );

      if (cursor.getTime() < movingStart.getTime()) {
        const gapSubstate =
          previousActivity?.type === "accommodation" ? "accommodation" : "freetime";
        const gapScene = gapSubstate === "accommodation" ? "hotel" : "idle";
        const gapPresence =
          gapSubstate === "accommodation" ? "resting" : "available";
        if (now.getTime() >= cursor.getTime() && now.getTime() < movingStart.getTime()) {
          const timing = {
            startedAt: cursor.toISOString(),
            endsAt: movingStart.toISOString(),
          };
          return {
            situation: makeSituation({
              mode: "traveling",
              state: "activities",
              substate: gapSubstate,
              scene: gapScene,
              presence: gapPresence,
              currentPhase: "day_exploration",
              currentDay: day.day,
              contextKind: "activity",
              sendMoment: "none",
              isExtraMessage: false,
              postcardEligible: false,
              timing,
            }),
            timing,
            currentActivity: previousActivity,
            nextActivity: activity,
            weatherForecast,
            latestPostcardSentAt: latestDelivery,
          };
        }
      }

      const movingSegmentStart = new Date(
        Math.max(cursor.getTime(), movingStart.getTime()),
      );
      if (movingSegmentStart.getTime() < window.startUtc.getTime()) {
        if (
          now.getTime() >= movingSegmentStart.getTime() &&
          now.getTime() < window.startUtc.getTime()
        ) {
          const timing = {
            startedAt: movingSegmentStart.toISOString(),
            endsAt: window.startUtc.toISOString(),
          };
          return {
            situation: makeSituation({
              mode: "traveling",
              state: "activities",
              substate: "moving_to_next_activity",
              scene: "transport",
              presence: "moving",
              currentPhase: "day_exploration",
              currentDay: day.day,
              contextKind: "activity",
              sendMoment: "none",
              isExtraMessage: false,
              postcardEligible: false,
              timing,
            }),
            timing,
            currentActivity: activity,
            previousActivity,
            nextActivity,
            weatherForecast,
            latestPostcardSentAt: latestDelivery,
          };
        }
      }

      if (now.getTime() >= window.startUtc.getTime() && now.getTime() < window.endUtc.getTime()) {
        const substate = activity.type;
        const scene =
          activity.type === "transport"
            ? transportScene(
                activity.route?.transport_mode ?? activity.arrival_context.transport_mode,
                activity.location,
              )
            : activity.type === "accommodation"
              ? "hotel"
              : (activity.type as Exclude<
                  CompanionBusinessScene,
                  "idle" | "planning" | "airport" | "transport" | "hotel" | "reflection"
                >);
        const presence: CompanionBusinessPresence =
          activity.type === "transport"
            ? "moving"
            : activity.type === "accommodation"
              ? "resting"
              : "available";
        const phase =
          activity.type === "accommodation" && day.day === 1
            ? "arrival_checkin"
            : activity.type === "transport" && day.day === activeTrip.plan.metadata.days
              ? "returning"
              : "day_exploration";
        const timing = {
          startedAt: window.startUtc.toISOString(),
          endsAt: window.endUtc.toISOString(),
        };
        return {
          situation: makeSituation({
            mode: "traveling",
            state: "activities",
            substate,
            scene,
            presence,
            currentPhase: phase,
            currentDay: day.day,
            contextKind: "activity",
            sendMoment: "start",
            isExtraMessage: false,
            postcardEligible: true,
            timing,
          }),
          timing,
          currentActivity: activity,
          previousActivity,
          nextActivity,
          weatherForecast,
          latestPostcardSentAt: latestDelivery,
        };
      }

      cursor = window.endUtc;
      previousActivity = activity;
    }
  }

  if (cursor.getTime() < returnWindow.departStart.getTime()) {
    if (now.getTime() >= cursor.getTime() && now.getTime() < returnWindow.departStart.getTime()) {
      const timing = {
        startedAt: cursor.toISOString(),
        endsAt: returnWindow.departStart.toISOString(),
      };
      return {
        situation: makeSituation({
          mode: "traveling",
          state: "activities",
          substate: previousActivity?.type === "accommodation" ? "accommodation" : "freetime",
          scene: previousActivity?.type === "accommodation" ? "hotel" : "idle",
          presence: previousActivity?.type === "accommodation" ? "resting" : "available",
          currentPhase: "day_exploration",
          currentDay: activeTrip.plan.metadata.days,
          contextKind: "activity",
          sendMoment: "none",
          isExtraMessage: false,
          postcardEligible: false,
          timing,
        }),
        timing,
        currentActivity: previousActivity,
        weatherForecast:
          activeTrip.plan.daily_itinerary[activeTrip.plan.daily_itinerary.length - 1]
            ?.weather_forecast,
        latestPostcardSentAt: latestDelivery,
      };
    }
  }

  if (now.getTime() < returnWindow.arriveAt.getTime()) {
    const timing = {
      startedAt: returnWindow.departStart.toISOString(),
      endsAt: returnWindow.arriveAt.toISOString(),
    };
    return {
      situation: makeSituation({
        mode: "traveling",
        state: "return",
        substate: "departing",
        scene: transportScene(
          returnWindow.transportMode,
          activeTrip.plan.transportation.return.departure.station,
        ),
        presence: "moving",
        currentPhase: "returning",
        currentDay: activeTrip.plan.metadata.days,
        contextKind: "activity",
        sendMoment: "summary",
        isExtraMessage: false,
        postcardEligible: true,
        timing,
      }),
      timing,
      weatherForecast:
        activeTrip.plan.daily_itinerary[activeTrip.plan.daily_itinerary.length - 1]
          ?.weather_forecast,
      latestPostcardSentAt: latestDelivery,
    };
  }

  if (now.getTime() < returnWindow.arriveEnd.getTime()) {
    const timing = {
      startedAt: returnWindow.arriveAt.toISOString(),
      endsAt: returnWindow.arriveEnd.toISOString(),
    };
    return {
      situation: makeSituation({
        mode: "trip-finished",
        state: "return",
        substate: "arrive",
        scene: transportScene(
          returnWindow.transportMode,
          activeTrip.plan.transportation.return.arrival.station,
        ),
        presence: "available",
        currentPhase: "returning",
        currentDay: activeTrip.plan.metadata.days,
        contextKind: "activity",
        sendMoment: "summary",
        isExtraMessage: false,
        postcardEligible: true,
        timing,
      }),
      timing,
      weatherForecast:
        activeTrip.plan.daily_itinerary[activeTrip.plan.daily_itinerary.length - 1]
          ?.weather_forecast,
      latestPostcardSentAt: latestDelivery,
    };
  }

  const timing = {
    startedAt: returnWindow.arriveEnd.toISOString(),
  };
  return {
    situation: makeSituation({
      mode: "idle",
      state: "idle",
      substate: "idle",
      scene: "idle",
      presence: "available",
      currentPhase: "system",
      currentDay: 0,
      contextKind: "none",
      sendMoment: "none",
      isExtraMessage: false,
      postcardEligible: false,
      timing,
    }),
    timing,
    latestPostcardSentAt: latestDelivery,
  };
}

function deriveInstantReplyWindow(input: {
  conversationKey: string;
  now: Date;
  businessSituation: CompanionBusinessSituation;
  conversationState: ConversationCompanionState;
  latestPostcardSentAt?: string;
}): InstantReplyWindow | null {
  const latestReplyAt = input.conversationState.lastCompanionReplyAt;
  const latestPostcardAt = input.latestPostcardSentAt;

  const chosen =
    !latestReplyAt && !latestPostcardAt
      ? null
      : !latestPostcardAt
        ? { source: "reply" as const, triggerAt: latestReplyAt! }
        : !latestReplyAt
          ? { source: "postcard" as const, triggerAt: latestPostcardAt }
          : new Date(latestReplyAt).getTime() >= new Date(latestPostcardAt).getTime()
            ? { source: "reply" as const, triggerAt: latestReplyAt }
            : { source: "postcard" as const, triggerAt: latestPostcardAt };

  if (!chosen) {
    return null;
  }

  const existing = input.conversationState.instantReplyWindow;
  if (
    existing &&
    existing.triggerAt === chosen.triggerAt &&
    new Date(existing.expiresAt).getTime() > input.now.getTime()
  ) {
    return existing;
  }

  const strategy = strategyFor(input.businessSituation);
  const minutes = stableRange(
    `${input.conversationKey}:${chosen.source}:${chosen.triggerAt}:${input.businessSituation.state}.${input.businessSituation.substate}:hot`,
    strategy.hotWindowMinutes.min,
    strategy.hotWindowMinutes.max,
  );
  const expiresAt = new Date(
    new Date(chosen.triggerAt).getTime() + minutes * 60 * 1000,
  );
  if (expiresAt.getTime() <= input.now.getTime()) {
    return null;
  }

  return {
    source: chosen.source,
    triggerAt: chosen.triggerAt,
    expiresAt: expiresAt.toISOString(),
    cap: stableRange(
      `${input.conversationKey}:${chosen.source}:${chosen.triggerAt}:${input.businessSituation.state}.${input.businessSituation.substate}:cap`,
      strategy.instantReplyCap.min,
      strategy.instantReplyCap.max,
    ),
    usedCount: 0,
  };
}

export function deriveReplyDueAt(input: {
  conversationKey: string;
  messageId: string;
  now: Date;
  activeTrip: TripRecord | null;
  conversationState: ConversationCompanionState;
}): {
  dueAt: string;
  instantSeen: boolean;
  businessSituation: CompanionBusinessSituation;
  instantReplyWindow: InstantReplyWindow | null;
} {
  const derived = deriveCompanionState(input.activeTrip, input.now);
  const situation = derived.situation;
  const strategy = strategyFor(situation);
  const activeWindow = deriveInstantReplyWindow({
    conversationKey: input.conversationKey,
    now: input.now,
    businessSituation: situation,
    conversationState: input.conversationState,
    latestPostcardSentAt: derived.latestPostcardSentAt,
  });

  if (activeWindow && activeWindow.usedCount < activeWindow.cap) {
    return {
      dueAt: input.now.toISOString(),
      instantSeen: true,
      businessSituation: situation,
      instantReplyWindow: {
        ...activeWindow,
        usedCount: activeWindow.usedCount + 1,
      },
    };
  }

  const stateEndAt = situation.stateEndsAt
    ? new Date(situation.stateEndsAt).getTime()
    : undefined;

  let dueAtMs = input.now.getTime();
  switch (strategy.seenPolicy.kind) {
    case "defer_to_next_state":
    case "until_state_end":
      dueAtMs = stateEndAt ?? input.now.getTime();
      break;
    case "range": {
      const minutes = stableRange(
        `${input.conversationKey}:${input.messageId}:${situation.state}.${situation.substate}:seen`,
        strategy.seenPolicy.minMinutes,
        strategy.seenPolicy.maxMinutes,
      );
      dueAtMs = input.now.getTime() + minutes * 60 * 1000;
      if (stateEndAt && dueAtMs > stateEndAt) {
        dueAtMs = stateEndAt;
      }
      break;
    }
  }

  return {
    dueAt: new Date(dueAtMs).toISOString(),
    instantSeen: false,
    businessSituation: situation,
    instantReplyWindow: activeWindow,
  };
}

export function createReplyHotWindow(input: {
  conversationKey: string;
  resolvedState: ResolvedAgentState;
  triggerAt: string;
  source: "reply";
}): InstantReplyWindow {
  const minutes = stableRange(
    `${input.conversationKey}:${input.source}:${input.triggerAt}:${input.resolvedState.stage.group}.${input.resolvedState.stage.substate}:hot`,
    input.resolvedState.policy.hotWindowMinutes.min,
    input.resolvedState.policy.hotWindowMinutes.max,
  );
  return {
    source: input.source,
    triggerAt: input.triggerAt,
    expiresAt: new Date(
      new Date(input.triggerAt).getTime() + minutes * 60 * 1000,
    ).toISOString(),
    cap: stableRange(
      `${input.conversationKey}:${input.source}:${input.triggerAt}:${input.resolvedState.stage.group}.${input.resolvedState.stage.substate}:cap`,
      input.resolvedState.policy.instantReplyCap.min,
      input.resolvedState.policy.instantReplyCap.max,
    ),
    usedCount: 0,
  };
}
