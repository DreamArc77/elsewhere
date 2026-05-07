import {
  ActivityTiming,
  CompanionBusinessPresence,
  CompanionBusinessScene,
  CompanionStateGroup,
  CompanionStateSubstate,
  DailyItinerary,
  ItineraryActivity,
  RuntimeStepContext,
  TimelineStep,
  TripPhase,
  TripPlan,
} from "./types.js";
import { parseItineraryTimeToken } from "./itinerary-time.js";

const EXTRA_MESSAGE_THRESHOLD_MINUTES = 150;
const DEFAULT_SINGLE_SLOT_MINUTES = 30;
const DESTINATION_TIME_ZONE_MAP: Array<[RegExp, string]> = [
  [/tokyo|東京/u, "Asia/Tokyo"],
  [/osaka|kyoto|京都|大阪/u, "Asia/Tokyo"],
  [
    /shanghai|上海|beijing|北京|tianjin|天津|qingdao|青岛|chengdu|成都|guangzhou|广州|shenzhen|深圳|hangzhou|杭州|nanjing|南京|xiamen|厦门/u,
    "Asia/Shanghai",
  ],
  [/hong\s*kong|香港/u, "Asia/Hong_Kong"],
  [/taipei|台北/u, "Asia/Taipei"],
  [/seoul|首尔|首爾/u, "Asia/Seoul"],
  [/singapore|新加坡/u, "Asia/Singapore"],
  [/istanbul|伊斯坦布尔/u, "Europe/Istanbul"],
  [/chiang\s*mai|清迈/u, "Asia/Bangkok"],
  [/new\s*york|纽约|紐約/u, "America/New_York"],
  [/los\s*angeles|洛杉矶|洛杉磯/u, "America/Los_Angeles"],
  [/paris|巴黎/u, "Europe/Paris"],
  [/london|伦敦|倫敦/u, "Europe/London"],
];

function toId(phase: TripPhase, day: number, suffix: string): string {
  return `${phase}:${day}:${suffix}`;
}

function parseDateParts(date: string): {
  year: number;
  month: number;
  day: number;
} {
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
}): {
  year: number;
  month: number;
  day: number;
} {
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

function formatLocalIso(date: Date, timeZone: string): string {
  const parts = formatPartsInTimeZone(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
    parts.day,
  ).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(
    parts.minute,
  ).padStart(2, "0")}:00`;
}

function parseTimeSlot(
  date: string,
  timeSlot: string,
  timeZone: string,
): ActivityTiming {
  const rangeMatch = timeSlot.match(
    /^\s*(\d{1,2}:\d{2}(?:\s*\(\+\d+\))?)\s*-\s*(\d{1,2}:\d{2}(?:\s*\(\+\d+\))?)\s*$/u,
  );
  const singleMatch = timeSlot.match(
    /^\s*(\d{1,2}:\d{2}(?:\s*\(\+\d+\))?)\s*$/u,
  );
  if (!rangeMatch && !singleMatch) {
    throw new Error(`Unsupported itinerary time_slot: ${timeSlot}`);
  }

  const { year, month, day } = parseDateParts(date);
  const startParts = parseItineraryTimeToken(
    (rangeMatch?.[1] ?? singleMatch?.[1])!,
    { baseDate: date },
  );
  const endParts = rangeMatch
    ? parseItineraryTimeToken(rangeMatch[2]!, { baseDate: date })
    : {
        hour: startParts.hour,
        minute: startParts.minute + DEFAULT_SINGLE_SLOT_MINUTES,
        dayOffset: startParts.dayOffset,
      };

  const startDateParts = addDaysToDateParts({
    year,
    month,
    day,
    dayOffset: startParts.dayOffset,
  });

  const startUtcDate = toUtcDate({
    year: startDateParts.year,
    month: startDateParts.month,
    day: startDateParts.day,
    hour: startParts.hour,
    minute: startParts.minute,
    timeZone,
  });

  const normalizedEnd = new Date(startUtcDate);
  normalizedEnd.setUTCMinutes(
    normalizedEnd.getUTCMinutes() +
      (rangeMatch
        ? durationMinutesFromRange(startParts, endParts)
        : DEFAULT_SINGLE_SLOT_MINUTES),
  );

  return {
    rawDate: date,
    rawTimeSlot: timeSlot,
    timeZone,
    startLocal: formatLocalIso(startUtcDate, timeZone),
    endLocal: formatLocalIso(normalizedEnd, timeZone),
    startUtc: startUtcDate.toISOString(),
    endUtc: normalizedEnd.toISOString(),
    durationMinutes: Math.max(
      DEFAULT_SINGLE_SLOT_MINUTES,
      Math.round((normalizedEnd.getTime() - startUtcDate.getTime()) / 60000),
    ),
  };
}

function durationMinutesFromRange(
  start: { hour: number; minute: number; dayOffset?: number },
  end: { hour: number; minute: number; dayOffset?: number },
): number {
  const startMinutes = (start.dayOffset ?? 0) * 24 * 60 + start.hour * 60 + start.minute;
  const endMinutes = (end.dayOffset ?? 0) * 24 * 60 + end.hour * 60 + end.minute;
  return endMinutes >= startMinutes
    ? endMinutes - startMinutes
    : 24 * 60 - (start.hour * 60 + start.minute) + end.hour * 60 + end.minute;
}

export function inferDestinationTimeZone(plan: TripPlan): string {
  const destination = plan.metadata.destination.trim().toLowerCase();
  for (const [pattern, timeZone] of DESTINATION_TIME_ZONE_MAP) {
    if (pattern.test(destination)) {
      return timeZone;
    }
  }
  return "UTC";
}

function inferTimeZoneFromText(text: string): string {
  const normalized = text.trim().toLowerCase();
  for (const [pattern, timeZone] of DESTINATION_TIME_ZONE_MAP) {
    if (pattern.test(normalized)) {
      return timeZone;
    }
  }
  return "UTC";
}

export function getDayItinerary(
  plan: TripPlan,
  day: number,
): DailyItinerary | undefined {
  return plan.daily_itinerary.find((entry) => entry.day === day);
}

export function getAccommodationForDay(
  plan: TripPlan,
  day: number,
): ItineraryActivity | undefined {
  return getDayItinerary(plan, day)?.activities.find(
    (activity) => activity.type === "accommodation",
  );
}

function inferPhase(
  plan: TripPlan,
  day: number,
  activityIndex: number,
  activity: ItineraryActivity,
): TripPhase {
  if (activity.type === "transport") {
    if (day === 1 && activityIndex === 0) {
      return "departing";
    }
    if (day === plan.metadata.days) {
      return "returning";
    }
    return "in_transit";
  }

  if (activity.type === "accommodation") {
    if (day === 1) {
      return "arrival_checkin";
    }
    if (day === plan.metadata.days && looksLikeTerminalContext(activity)) {
      return "returning";
    }
  }

  return "day_exploration";
}

function looksLikeTerminalContext(activity: ItineraryActivity): boolean {
  const haystack = [
    activity.location,
    activity.address,
    activity.description,
    activity.route?.from_location,
    activity.route?.to_location,
    activity.arrival_context.from_location,
  ]
    .join(" ")
    .toLowerCase();

  return /airport|terminal|候机|候機|航站楼|航站樓|station|车站|車站/u.test(
    haystack,
  );
}

function transportScene(mode: string, labelSource: string): CompanionBusinessScene {
  if (
    mode === "airplane" ||
    /airport|terminal|gate|boarding|姗熷牬|鏈哄満|鑸珯/u.test(
      labelSource.toLowerCase(),
    )
  ) {
    return "airport";
  }
  return "transport";
}

function sceneForActivity(activity: ItineraryActivity): CompanionBusinessScene {
  if (activity.type === "transport") {
    return transportScene(
      activity.route?.transport_mode ?? activity.arrival_context.transport_mode,
      activity.location,
    );
  }
  if (activity.type === "accommodation") {
    return "hotel";
  }
  return activity.type as Exclude<
    CompanionBusinessScene,
    "idle" | "planning" | "airport" | "transport" | "hotel" | "reflection"
  >;
}

function presenceForActivity(
  activity: ItineraryActivity,
): CompanionBusinessPresence {
  if (activity.type === "transport") {
    return "moving";
  }
  if (activity.type === "accommodation") {
    return "resting";
  }
  return "available";
}

function buildActivityStateOverride(input: {
  activity: ItineraryActivity;
  phase: TripPhase;
}): TimelineStep["stateOverride"] {
  return {
    group: "activities",
    substate: input.activity.type,
    scene: sceneForActivity(input.activity),
    presence: presenceForActivity(input.activity),
    currentPhase: input.phase,
  };
}

function canSendExtraMessage(
  activity: ItineraryActivity,
  timing: ActivityTiming,
): boolean {
  return (
    (activity.type === "sightseeing" || activity.type === "shopping") &&
    timing.durationMinutes >= EXTRA_MESSAGE_THRESHOLD_MINUTES
  );
}

function buildActivityContext(input: {
  phase: TripPhase;
  itinerary: DailyItinerary;
  activityIndex: number;
  activity: ItineraryActivity;
  previousActivity?: ItineraryActivity;
  nextActivity?: ItineraryActivity;
  timing: ActivityTiming;
  isExtraMessage: boolean;
  sendMoment: "start" | "mid" | "summary";
}): RuntimeStepContext {
  return {
    kind: "activity",
    phase: input.phase,
    day: input.itinerary.day,
    date: input.itinerary.date,
    theme: input.itinerary.theme,
    activityIndex: input.activityIndex,
    isExtraMessage: input.isExtraMessage,
    sendMoment: input.sendMoment,
    activity: input.activity,
    previousActivity: input.previousActivity,
    nextActivity: input.nextActivity,
    timing: input.timing,
  };
}

function buildSyntheticContext(input: {
  kind: "planning" | "home_reflection";
  phase: TripPhase;
  itinerary: DailyItinerary;
  activityIndex: number;
  activity: ItineraryActivity;
  previousActivity?: ItineraryActivity;
  nextActivity?: ItineraryActivity;
  timing: ActivityTiming;
}): RuntimeStepContext {
  return {
    kind: input.kind,
    phase: input.phase,
    day: input.itinerary.day,
    date: input.itinerary.date,
    theme: input.itinerary.theme,
    activityIndex: input.activityIndex,
    isExtraMessage: false,
    sendMoment: input.kind === "planning" ? "summary" : "summary",
    activity: input.activity,
    previousActivity: input.previousActivity,
    nextActivity: input.nextActivity,
    timing: input.timing,
  };
}

function buildSyntheticTiming(now: Date, timeZone: string): ActivityTiming {
  const end = new Date(now.getTime() + DEFAULT_SINGLE_SLOT_MINUTES * 60 * 1000);
  const startLocal = formatLocalIso(now, timeZone);

  return {
    rawDate: startLocal.slice(0, 10),
    rawTimeSlot: startLocal.slice(11, 16),
    timeZone,
    startLocal,
    endLocal: formatLocalIso(end, timeZone),
    startUtc: now.toISOString(),
    endUtc: end.toISOString(),
    durationMinutes: DEFAULT_SINGLE_SLOT_MINUTES,
  };
}

function buildPlanningActivity(plan: TripPlan): ItineraryActivity {
  const origin = plan.metadata.origin;
  const firstDayWeather = plan.daily_itinerary[0]?.weather_forecast ?? "";
  return {
    time_slot: "00:00 - 00:30",
    location: `Planning trip in ${origin}`,
    address: origin,
    type: "accommodation",
    description: `At home in ${origin}, checking tickets and routes, comparing transport options, and making the travel plan for ${plan.metadata.destination}.`,
    arrival_context: {
      from_location: origin,
      transport_mode: "walk",
      duration_minutes: 0,
    },
    route: {
      from_location: origin,
      to_location: origin,
      transport_mode: "walk",
    },
    real_time_info: {
      live_update: firstDayWeather,
    },
  };
}

function buildPackingActivity(plan: TripPlan): ItineraryActivity {
  const origin = plan.metadata.origin;
  const firstDayWeather = plan.daily_itinerary[0]?.weather_forecast ?? "";
  return {
    time_slot: "00:00 - 00:30",
    location: `Final packing in ${origin}`,
    address: origin,
    type: "accommodation",
    description: `Pack the essentials, check the weather, and get ready to leave ${origin} for ${plan.metadata.destination}.`,
    arrival_context: {
      from_location: origin,
      transport_mode: "walk",
      duration_minutes: 0,
    },
    real_time_info: {
      live_update: firstDayWeather,
    },
  };
}

function buildBeforeDepartureActivity(plan: TripPlan): ItineraryActivity {
  const origin = plan.metadata.origin;
  const departureStation = plan.transportation.departure.departure.station;
  return {
    time_slot: "00:00 - 00:30",
    location: `On the way to ${departureStation}`,
    address: departureStation,
    type: "transport",
    description: `Head from ${origin} toward ${departureStation} and get ready for departure.`,
    arrival_context: {
      from_location: origin,
      transport_mode: "car",
      duration_minutes: 30,
    },
    route: {
      from_location: origin,
      to_location: departureStation,
      transport_mode: "car",
    },
    real_time_info: {
      live_update: `Leave enough time to reach ${departureStation}.`,
    },
  };
}

function buildMainDepartureActivity(plan: TripPlan): ItineraryActivity {
  const leg = plan.transportation.departure;
  return {
    time_slot: `${leg.departure.time} - ${leg.arrival.time}`,
    location: `${leg.departure.station} -> ${leg.arrival.station}`,
    address: leg.departure.station,
    type: "transport",
    description: `Take ${leg.operator} ${leg.identifier} from ${leg.departure.station} to ${leg.arrival.station}.`,
    arrival_context: {
      from_location: leg.departure.station,
      transport_mode: leg.transport_mode,
      duration_minutes: 0,
    },
    route: {
      from_location: leg.departure.station,
      to_location: leg.arrival.station,
      transport_mode: leg.transport_mode,
    },
    real_time_info: {
      live_update: `Main departure leg: ${leg.identifier}.`,
    },
  };
}

function buildArrivalActivity(plan: TripPlan): ItineraryActivity {
  const leg = plan.transportation.departure;
  const arrivalStation = leg.arrival.station;
  return {
    time_slot: leg.arrival.time,
    location: arrivalStation,
    address: arrivalStation,
    type: "transport",
    description: `Just arrived at ${arrivalStation} and stepped into ${plan.metadata.destination}.`,
    arrival_context: {
      from_location: leg.departure.station,
      transport_mode: leg.transport_mode,
      duration_minutes: 0,
    },
    route: {
      from_location: leg.departure.station,
      to_location: arrivalStation,
      transport_mode: leg.transport_mode,
    },
    real_time_info: {
      live_update: `Arrival complete at ${arrivalStation}.`,
    },
  };
}

function buildMainReturnActivity(plan: TripPlan): ItineraryActivity {
  const leg = plan.transportation.return;
  return {
    time_slot: `${leg.departure.time} - ${leg.arrival.time}`,
    location: `${leg.departure.station} -> ${leg.arrival.station}`,
    address: leg.departure.station,
    type: "transport",
    description: `Take ${leg.operator} ${leg.identifier} from ${leg.departure.station} back to ${leg.arrival.station}.`,
    arrival_context: {
      from_location: leg.departure.station,
      transport_mode: leg.transport_mode,
      duration_minutes: 0,
    },
    route: {
      from_location: leg.departure.station,
      to_location: leg.arrival.station,
      transport_mode: leg.transport_mode,
    },
    real_time_info: {
      live_update: `Main return leg: ${leg.identifier}.`,
    },
  };
}

function buildReturnArrivalActivity(plan: TripPlan): ItineraryActivity {
  const leg = plan.transportation.return;
  return {
    time_slot: leg.arrival.time,
    location: leg.arrival.station,
    address: leg.arrival.station,
    type: "transport",
    description: `Back at ${leg.arrival.station} after the trip.`,
    arrival_context: {
      from_location: leg.departure.station,
      transport_mode: leg.transport_mode,
      duration_minutes: 0,
    },
    route: {
      from_location: leg.departure.station,
      to_location: leg.arrival.station,
      transport_mode: leg.transport_mode,
    },
    real_time_info: {
      live_update: `Return arrival complete at ${leg.arrival.station}.`,
    },
  };
}

function createSyntheticStep(input: {
  stepId: string;
  phase: TripPhase;
  day: number;
  scheduledAt: string;
  context: RuntimeStepContext;
  stateOverride: TimelineStep["stateOverride"];
}): TimelineStep {
  return {
    stepId: input.stepId,
    phase: input.phase,
    day: input.day,
    emitsPostcard: true,
    scheduledAt: input.scheduledAt,
    context: input.context,
    stateOverride: input.stateOverride,
  };
}

function scheduleInWindow(start: Date, end: Date, fraction: number): string {
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (endMs <= startMs) {
    return start.toISOString();
  }
  return new Date(startMs + Math.floor((endMs - startMs) * fraction)).toISOString();
}

function resolveTransportWindow(input: {
  date: string;
  departureTime: string;
  arrivalTime: string;
  departureTimeZone: string;
  arrivalTimeZone: string;
  departureLeadHours?: number;
  arrivalTailMinutes?: number;
  referenceDirection: "departure" | "return";
}): {
  beforeStart: Date;
  departStart: Date;
  departAt: Date;
  arriveAt: Date;
  arriveEnd: Date;
} {
  const baseDate = parseDateParts(input.date);
  const arrivalToken = parseItineraryTimeToken(input.arrivalTime, {
    baseDate: input.date,
  });
  const arrivalDate = addDaysToDateParts({
    ...baseDate,
    dayOffset: arrivalToken.dayOffset,
  });
  const arriveAt = toUtcDate({
    ...arrivalDate,
    hour: arrivalToken.hour,
    minute: arrivalToken.minute,
    timeZone: input.arrivalTimeZone,
  });

  const departureToken = parseItineraryTimeToken(input.departureTime, {
    baseDate: input.date,
  });
  let departAt = arriveAt;
  const offsets =
    input.referenceDirection === "departure" ? [-2, -1, 0, 1] : [0, 1, 2];
  for (const offset of offsets) {
    const candidateDate = addDaysToDateParts({
      ...baseDate,
      dayOffset: offset + departureToken.dayOffset,
    });
    const candidate = toUtcDate({
      ...candidateDate,
      hour: departureToken.hour,
      minute: departureToken.minute,
      timeZone: input.departureTimeZone,
    });
    const valid =
      input.referenceDirection === "departure"
        ? candidate.getTime() <= arriveAt.getTime()
        : candidate.getTime() <= arriveAt.getTime();
    if (valid) {
      departAt = candidate;
      if (input.referenceDirection === "return" && candidate.getTime() <= arriveAt.getTime()) {
        break;
      }
    }
  }

  const beforeStart = new Date(
    departAt.getTime() - (input.departureLeadHours ?? 3) * 60 * 60 * 1000,
  );
  const departStart = new Date(departAt.getTime() - 15 * 60 * 1000);
  const arriveEnd = new Date(
    arriveAt.getTime() + (input.arrivalTailMinutes ?? 10) * 60 * 1000,
  );
  return { beforeStart, departStart, departAt, arriveAt, arriveEnd };
}

type TransportWindow = ReturnType<typeof resolveTransportWindow>;

function shiftIsoDate(date: string, dayOffset: number): string {
  const base = parseDateParts(date);
  const shifted = addDaysToDateParts({ ...base, dayOffset });
  return `${shifted.year}-${String(shifted.month).padStart(2, "0")}-${String(
    shifted.day,
  ).padStart(2, "0")}`;
}

function resolveDepartureWindow(input: {
  date: string;
  departureTime: string;
  arrivalTime: string;
  departureTimeZone: string;
  arrivalTimeZone: string;
  firstActivityStartsAt: Date;
}): TransportWindow {
  const candidates = [-3, -2, -1, 0, 1].map((dayOffset) =>
    resolveTransportWindow({
      date: shiftIsoDate(input.date, dayOffset),
      departureTime: input.departureTime,
      arrivalTime: input.arrivalTime,
      departureTimeZone: input.departureTimeZone,
      arrivalTimeZone: input.arrivalTimeZone,
      referenceDirection: "departure",
    }),
  );
  const arrivalsBeforeFirstActivity = candidates.filter(
    (candidate) =>
      candidate.arriveAt.getTime() <= input.firstActivityStartsAt.getTime(),
  );
  return (
    arrivalsBeforeFirstActivity.sort(
      (left, right) => right.arriveAt.getTime() - left.arriveAt.getTime(),
    )[0] ??
    candidates.sort(
      (left, right) =>
        Math.abs(left.arriveAt.getTime() - input.firstActivityStartsAt.getTime()) -
        Math.abs(right.arriveAt.getTime() - input.firstActivityStartsAt.getTime()),
    )[0]!
  );
}

function isReturnStagingActivity(
  plan: TripPlan,
  activity: ItineraryActivity,
): boolean {
  if (activity.type !== "transport" && activity.type !== "accommodation") {
    return false;
  }

  const station = plan.transportation.return.departure.station.trim().toLowerCase();
  const haystack = [
    activity.location,
    activity.address,
    activity.description,
    activity.route?.from_location,
    activity.route?.to_location,
    activity.arrival_context.from_location,
  ]
    .join(" ")
    .toLowerCase();

  return (
    (station.length > 0 && haystack.includes(station)) ||
    looksLikeTerminalContext(activity)
  );
}

function resolveReturnWindow(input: {
  date: string;
  departureTime: string;
  arrivalTime: string;
  departureTimeZone: string;
  arrivalTimeZone: string;
  afterActivityEndsAt?: Date;
}): TransportWindow {
  const candidates = [-1, 0, 1, 2, 3].map((dayOffset) =>
    resolveTransportWindow({
      date: shiftIsoDate(input.date, dayOffset),
      departureTime: input.departureTime,
      arrivalTime: input.arrivalTime,
      departureTimeZone: input.departureTimeZone,
      arrivalTimeZone: input.arrivalTimeZone,
      departureLeadHours: 0.25,
      referenceDirection: "return",
    }),
  );

  if (!input.afterActivityEndsAt) {
    return candidates[1]!;
  }

  const departuresAfterStaging = candidates.filter(
    (candidate) =>
      candidate.departAt.getTime() >= input.afterActivityEndsAt!.getTime(),
  );
  return (
    departuresAfterStaging.sort(
      (left, right) => left.departAt.getTime() - right.departAt.getTime(),
    )[0] ??
    candidates.sort(
      (left, right) =>
        Math.abs(left.departAt.getTime() - input.afterActivityEndsAt!.getTime()) -
        Math.abs(right.departAt.getTime() - input.afterActivityEndsAt!.getTime()),
    )[0]!
  );
}

export function buildTimeline(plan: TripPlan, now: Date): TimelineStep[] {
  const timeZone = inferDestinationTimeZone(plan);
  const itinerary = [...plan.daily_itinerary].sort((a, b) => a.day - b.day);
  const activitySteps: TimelineStep[] = [];

  for (const dayPlan of itinerary) {
    for (let index = 0; index < dayPlan.activities.length; index += 1) {
      const activity = dayPlan.activities[index]!;
      const timing = parseTimeSlot(dayPlan.date, activity.time_slot, timeZone);
      const phase = inferPhase(plan, dayPlan.day, index, activity);
      const previousActivity = index > 0 ? dayPlan.activities[index - 1] : undefined;
      const nextActivity =
        index < dayPlan.activities.length - 1
          ? dayPlan.activities[index + 1]
          : undefined;

      activitySteps.push({
        stepId: toId(phase, dayPlan.day, `${index}:start`),
        phase,
        day: dayPlan.day,
        emitsPostcard: true,
        scheduledAt: timing.startUtc,
        context: buildActivityContext({
          phase,
          itinerary: dayPlan,
          activityIndex: index,
          activity,
          previousActivity,
          nextActivity,
          timing,
          isExtraMessage: false,
          sendMoment: "start",
        }),
        stateOverride: buildActivityStateOverride({
          activity,
          phase,
        }),
      });

      if (canSendExtraMessage(activity, timing)) {
        const midpoint = new Date(
          new Date(timing.startUtc).getTime() +
            Math.floor(timing.durationMinutes / 2) * 60 * 1000,
        );
        activitySteps.push({
          stepId: toId(phase, dayPlan.day, `${index}:mid`),
          phase,
          day: dayPlan.day,
          emitsPostcard: true,
          scheduledAt: midpoint.toISOString(),
          context: buildActivityContext({
            phase,
            itinerary: dayPlan,
            activityIndex: index,
            activity,
            previousActivity,
            nextActivity,
            timing,
            isExtraMessage: true,
            sendMoment: "mid",
          }),
          stateOverride: buildActivityStateOverride({
            activity,
            phase,
          }),
        });
      }
    }
  }

  activitySteps.sort((left, right) => {
    const delta =
      new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime();
    return delta !== 0 ? delta : left.stepId.localeCompare(right.stepId);
  });

  const firstActivityStep = activitySteps[0];
  if (!firstActivityStep?.context) {
    throw new Error("Trip plan must contain at least one activity.");
  }

  const firstDay = getDayItinerary(plan, firstActivityStep.day)!;
  const lastDay = itinerary[itinerary.length - 1]!;
  const departureWindow = resolveDepartureWindow({
    date: firstDay.date,
    departureTime: plan.transportation.departure.departure.time,
    arrivalTime: plan.transportation.departure.arrival.time,
    departureTimeZone: inferTimeZoneFromText(plan.metadata.origin),
    arrivalTimeZone: inferTimeZoneFromText(plan.metadata.destination),
    firstActivityStartsAt: new Date(firstActivityStep.scheduledAt),
  });
  const lastReturnStagingStep = [...activitySteps].reverse().find(
    (step) =>
      step.day === lastDay.day &&
      step.context?.kind === "activity" &&
      isReturnStagingActivity(plan, step.context.activity),
  );
  const returnWindow = resolveReturnWindow({
    date: lastDay.date,
    departureTime: plan.transportation.return.departure.time,
    arrivalTime: plan.transportation.return.arrival.time,
    departureTimeZone: inferTimeZoneFromText(plan.metadata.destination),
    arrivalTimeZone: inferTimeZoneFromText(plan.metadata.origin),
    afterActivityEndsAt: lastReturnStagingStep?.context
      ? new Date(lastReturnStagingStep.context.timing.endUtc)
      : undefined,
  });
  const planningTiming = buildSyntheticTiming(now, inferTimeZoneFromText(plan.metadata.origin));
  const planningActivity = buildPlanningActivity(plan);
  const packingActivity = buildPackingActivity(plan);
  const beforeDepartureActivity = buildBeforeDepartureActivity(plan);
  const departureActivity = buildMainDepartureActivity(plan);
  const arrivalActivity = buildArrivalActivity(plan);
  const returnActivity = buildMainReturnActivity(plan);
  const returnArrivalActivity = buildReturnArrivalActivity(plan);
  const planningEndsAt = new Date(
    Math.min(
      now.getTime() + 60 * 1000,
      departureWindow.beforeStart.getTime(),
    ),
  );
  const hasPackingWindow =
    planningEndsAt.getTime() < departureWindow.beforeStart.getTime();
  const hasBeforeDepartureWindow =
    departureWindow.beforeStart.getTime() < departureWindow.departStart.getTime();
  const planningNextActivity = hasPackingWindow
    ? packingActivity
    : hasBeforeDepartureWindow
      ? beforeDepartureActivity
      : departureActivity;
  const packingPreviousActivity = planningActivity;
  const packingNextActivity = hasBeforeDepartureWindow
    ? beforeDepartureActivity
    : departureActivity;
  const beforeDeparturePreviousActivity = hasPackingWindow
    ? packingActivity
    : planningActivity;
  const departurePreviousActivity = hasBeforeDepartureWindow
    ? beforeDepartureActivity
    : hasPackingWindow
      ? packingActivity
      : planningActivity;
  const departureNextActivity = arrivalActivity;
  const arrivalPreviousActivity = departureActivity;
  const arrivalNextActivity = firstDay.activities[0];
  const syntheticSteps: TimelineStep[] = [
    createSyntheticStep({
      stepId: toId("planning", 0, "planning"),
      phase: "planning",
      day: 0,
      scheduledAt: now.toISOString(),
      context: buildSyntheticContext({
        kind: "planning",
        phase: "planning",
        itinerary: {
          day: 0,
          date: planningTiming.rawDate,
          weather_forecast: firstDay.weather_forecast,
          theme: `Preparing to leave for ${plan.metadata.destination}`,
          activities: [planningActivity],
        },
        activityIndex: -2,
        activity: planningActivity,
        previousActivity: undefined,
        nextActivity: planningNextActivity,
        timing: planningTiming,
      }),
      stateOverride: {
        group: "plan",
        substate: "planning",
        scene: "planning",
        presence: "busy",
        currentPhase: "planning",
      },
    }),
  ];

  if (planningEndsAt.getTime() < departureWindow.beforeStart.getTime()) {
    syntheticSteps.push(
      createSyntheticStep({
        stepId: toId("planning", 0, "packing"),
        phase: "planning",
        day: 0,
        scheduledAt: scheduleInWindow(
          planningEndsAt,
          departureWindow.beforeStart,
          0.25,
        ),
        context: buildSyntheticContext({
          kind: "planning",
          phase: "planning",
          itinerary: {
            day: 0,
            date: planningTiming.rawDate,
            weather_forecast: firstDay.weather_forecast,
            theme: `Packing for ${plan.metadata.destination}`,
            activities: [packingActivity],
          },
          activityIndex: -1,
          activity: packingActivity,
          previousActivity: packingPreviousActivity,
          nextActivity: packingNextActivity,
          timing: {
            ...planningTiming,
            startUtc: planningEndsAt.toISOString(),
            endUtc: departureWindow.beforeStart.toISOString(),
            startLocal: formatLocalIso(
              planningEndsAt,
              inferTimeZoneFromText(plan.metadata.origin),
            ),
            endLocal: formatLocalIso(
              departureWindow.beforeStart,
              inferTimeZoneFromText(plan.metadata.origin),
            ),
          },
        }),
        stateOverride: {
          group: "plan",
          substate: "packing",
          scene: "planning",
          presence: "busy",
          currentPhase: "planning",
        },
      }),
    );
  }

  if (departureWindow.beforeStart.getTime() < departureWindow.departStart.getTime()) {
    syntheticSteps.push(
      createSyntheticStep({
        stepId: toId("departing", 1, "before_departure"),
        phase: "departing",
        day: 1,
        scheduledAt: scheduleInWindow(
          departureWindow.beforeStart,
          departureWindow.departStart,
          0.25,
        ),
        context: buildActivityContext({
          phase: "departing",
          itinerary: firstDay,
          activityIndex: -1,
          activity: beforeDepartureActivity,
          previousActivity: beforeDeparturePreviousActivity,
          nextActivity: departureActivity,
          timing: {
            rawDate: firstDay.date,
            rawTimeSlot: `${plan.transportation.departure.departure.time}`,
            timeZone: inferTimeZoneFromText(plan.metadata.origin),
            startLocal: formatLocalIso(
              departureWindow.beforeStart,
              inferTimeZoneFromText(plan.metadata.origin),
            ),
            endLocal: formatLocalIso(
              departureWindow.departStart,
              inferTimeZoneFromText(plan.metadata.origin),
            ),
            startUtc: departureWindow.beforeStart.toISOString(),
            endUtc: departureWindow.departStart.toISOString(),
            durationMinutes: Math.max(
              1,
              Math.round(
                (departureWindow.departStart.getTime() -
                  departureWindow.beforeStart.getTime()) /
                  60000,
              ),
            ),
          },
          isExtraMessage: false,
          sendMoment: "summary",
        }),
        stateOverride: {
          group: "departure",
          substate: "before_departure",
          scene: "planning",
          presence: "busy",
          currentPhase: "departing",
        },
      }),
    );
  }

  syntheticSteps.push(
    createSyntheticStep({
      stepId: toId("departing", 1, "main_departing"),
      phase: "departing",
      day: 1,
      scheduledAt: departureWindow.departStart.toISOString(),
      context: buildActivityContext({
        phase: "departing",
        itinerary: firstDay,
        activityIndex: -1,
        activity: departureActivity,
        previousActivity: departurePreviousActivity,
        nextActivity: departureNextActivity,
        timing: {
          rawDate: firstDay.date,
          rawTimeSlot: `${plan.transportation.departure.departure.time} - ${plan.transportation.departure.arrival.time}`,
          timeZone: inferTimeZoneFromText(plan.metadata.origin),
          startLocal: formatLocalIso(
            departureWindow.departStart,
            inferTimeZoneFromText(plan.metadata.origin),
          ),
          endLocal: formatLocalIso(
            departureWindow.arriveAt,
            inferTimeZoneFromText(plan.metadata.destination),
          ),
          startUtc: departureWindow.departStart.toISOString(),
          endUtc: departureWindow.arriveAt.toISOString(),
          durationMinutes: Math.max(
            1,
            Math.round(
              (departureWindow.arriveAt.getTime() -
                departureWindow.departStart.getTime()) /
                60000,
            ),
          ),
        },
        isExtraMessage: false,
        sendMoment: "summary",
      }),
      stateOverride: {
        group: "departure",
        substate: "departing",
        scene: transportScene(
          plan.transportation.departure.transport_mode,
          plan.transportation.departure.departure.station,
        ),
        presence: "moving",
        currentPhase: "departing",
      },
    }),
  );

  if (plan.transportation.departure.transport_mode !== "airplane") {
    syntheticSteps.push(
      createSyntheticStep({
        stepId: toId("departing", 1, "main_departing_mid"),
        phase: "departing",
        day: 1,
        scheduledAt: scheduleInWindow(
          departureWindow.departStart,
          departureWindow.arriveAt,
          0.66,
        ),
        context: buildActivityContext({
          phase: "departing",
          itinerary: firstDay,
          activityIndex: -1,
          activity: departureActivity,
          previousActivity: departurePreviousActivity,
          nextActivity: departureNextActivity,
          timing: {
            rawDate: firstDay.date,
            rawTimeSlot: `${plan.transportation.departure.departure.time} - ${plan.transportation.departure.arrival.time}`,
            timeZone: inferTimeZoneFromText(plan.metadata.origin),
            startLocal: formatLocalIso(
              departureWindow.departStart,
              inferTimeZoneFromText(plan.metadata.origin),
            ),
            endLocal: formatLocalIso(
              departureWindow.arriveAt,
              inferTimeZoneFromText(plan.metadata.destination),
            ),
            startUtc: departureWindow.departStart.toISOString(),
            endUtc: departureWindow.arriveAt.toISOString(),
            durationMinutes: Math.max(
              1,
              Math.round(
                (departureWindow.arriveAt.getTime() -
                  departureWindow.departStart.getTime()) /
                  60000,
              ),
            ),
          },
          isExtraMessage: true,
          sendMoment: "mid",
        }),
        stateOverride: {
          group: "departure",
          substate: "departing",
          scene: transportScene(
            plan.transportation.departure.transport_mode,
            plan.transportation.departure.departure.station,
          ),
          presence: "moving",
          currentPhase: "departing",
        },
      }),
    );
  }

  syntheticSteps.push(
    createSyntheticStep({
      stepId: toId("arrival_checkin", 1, "arrival"),
      phase: "arrival_checkin",
      day: 1,
      scheduledAt: departureWindow.arriveAt.toISOString(),
      context: buildActivityContext({
        phase: "arrival_checkin",
        itinerary: firstDay,
        activityIndex: -1,
        activity: arrivalActivity,
        previousActivity: arrivalPreviousActivity,
        nextActivity: arrivalNextActivity,
        timing: {
          rawDate: firstDay.date,
          rawTimeSlot: `${plan.transportation.departure.arrival.time}`,
          timeZone: inferTimeZoneFromText(plan.metadata.destination),
          startLocal: formatLocalIso(
            departureWindow.arriveAt,
            inferTimeZoneFromText(plan.metadata.destination),
          ),
          endLocal: formatLocalIso(
            departureWindow.arriveEnd,
            inferTimeZoneFromText(plan.metadata.destination),
          ),
          startUtc: departureWindow.arriveAt.toISOString(),
          endUtc: departureWindow.arriveEnd.toISOString(),
          durationMinutes: Math.max(
            1,
            Math.round(
              (departureWindow.arriveEnd.getTime() -
                departureWindow.arriveAt.getTime()) /
                60000,
            ),
          ),
        },
        isExtraMessage: false,
        sendMoment: "summary",
      }),
      stateOverride: {
        group: "departure",
        substate: "arrive",
        scene: transportScene(
          plan.transportation.departure.transport_mode,
          plan.transportation.departure.arrival.station,
        ),
        presence: "available",
        currentPhase: "arrival_checkin",
      },
    }),
  );

  syntheticSteps.push(
    createSyntheticStep({
      stepId: toId("returning", plan.metadata.days, "main_return"),
      phase: "returning",
      day: plan.metadata.days,
      scheduledAt: returnWindow.departStart.toISOString(),
      context: buildActivityContext({
        phase: "returning",
        itinerary: lastDay,
        activityIndex: -1,
        activity: returnActivity,
        previousActivity: lastDay.activities[lastDay.activities.length - 1],
        nextActivity: returnArrivalActivity,
        timing: {
          rawDate: lastDay.date,
          rawTimeSlot: `${plan.transportation.return.departure.time} - ${plan.transportation.return.arrival.time}`,
          timeZone: inferTimeZoneFromText(plan.metadata.destination),
          startLocal: formatLocalIso(
            returnWindow.departStart,
            inferTimeZoneFromText(plan.metadata.destination),
          ),
          endLocal: formatLocalIso(
            returnWindow.arriveAt,
            inferTimeZoneFromText(plan.metadata.origin),
          ),
          startUtc: returnWindow.departStart.toISOString(),
          endUtc: returnWindow.arriveAt.toISOString(),
          durationMinutes: Math.max(
            1,
            Math.round(
              (returnWindow.arriveAt.getTime() -
                returnWindow.departStart.getTime()) /
                60000,
            ),
          ),
        },
        isExtraMessage: false,
        sendMoment: "summary",
      }),
      stateOverride: {
        group: "return",
        substate: "departing",
        scene: transportScene(
          plan.transportation.return.transport_mode,
          plan.transportation.return.departure.station,
        ),
        presence: "moving",
        currentPhase: "returning",
      },
    }),
  );

  if (plan.transportation.return.transport_mode !== "airplane") {
    syntheticSteps.push(
      createSyntheticStep({
        stepId: toId("returning", plan.metadata.days, "main_return_mid"),
        phase: "returning",
        day: plan.metadata.days,
        scheduledAt: scheduleInWindow(
          returnWindow.departStart,
          returnWindow.arriveAt,
          0.66,
        ),
        context: buildActivityContext({
          phase: "returning",
          itinerary: lastDay,
          activityIndex: -1,
          activity: returnActivity,
          previousActivity: lastDay.activities[lastDay.activities.length - 1],
          nextActivity: returnArrivalActivity,
          timing: {
            rawDate: lastDay.date,
            rawTimeSlot: `${plan.transportation.return.departure.time} - ${plan.transportation.return.arrival.time}`,
            timeZone: inferTimeZoneFromText(plan.metadata.destination),
            startLocal: formatLocalIso(
              returnWindow.departStart,
              inferTimeZoneFromText(plan.metadata.destination),
            ),
            endLocal: formatLocalIso(
              returnWindow.arriveAt,
              inferTimeZoneFromText(plan.metadata.origin),
            ),
            startUtc: returnWindow.departStart.toISOString(),
            endUtc: returnWindow.arriveAt.toISOString(),
            durationMinutes: Math.max(
              1,
              Math.round(
                (returnWindow.arriveAt.getTime() -
                  returnWindow.departStart.getTime()) /
                  60000,
              ),
            ),
          },
          isExtraMessage: true,
          sendMoment: "mid",
        }),
        stateOverride: {
          group: "return",
          substate: "departing",
          scene: transportScene(
            plan.transportation.return.transport_mode,
            plan.transportation.return.departure.station,
          ),
          presence: "moving",
          currentPhase: "returning",
        },
      }),
    );
  }

  syntheticSteps.push(
    createSyntheticStep({
      stepId: toId("returning", plan.metadata.days, "return_arrive"),
      phase: "returning",
      day: plan.metadata.days,
      scheduledAt: returnWindow.arriveAt.toISOString(),
      context: buildActivityContext({
        phase: "returning",
        itinerary: lastDay,
        activityIndex: -1,
        activity: returnArrivalActivity,
        previousActivity: returnActivity,
        nextActivity: undefined,
        timing: {
          rawDate: lastDay.date,
          rawTimeSlot: `${plan.transportation.return.arrival.time}`,
          timeZone: inferTimeZoneFromText(plan.metadata.origin),
          startLocal: formatLocalIso(
            returnWindow.arriveAt,
            inferTimeZoneFromText(plan.metadata.origin),
          ),
          endLocal: formatLocalIso(
            returnWindow.arriveEnd,
            inferTimeZoneFromText(plan.metadata.origin),
          ),
          startUtc: returnWindow.arriveAt.toISOString(),
          endUtc: returnWindow.arriveEnd.toISOString(),
          durationMinutes: Math.max(
            1,
            Math.round(
              (returnWindow.arriveEnd.getTime() -
                returnWindow.arriveAt.getTime()) /
                60000,
            ),
          ),
        },
        isExtraMessage: false,
        sendMoment: "summary",
      }),
      stateOverride: {
        group: "return",
        substate: "arrive",
        scene: transportScene(
          plan.transportation.return.transport_mode,
          plan.transportation.return.arrival.station,
        ),
        presence: "available",
        currentPhase: "returning",
      },
    }),
  );

  const sortedTimeline = [...syntheticSteps, ...activitySteps].sort((left, right) => {
    const delta =
      new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime();
    return delta !== 0 ? delta : left.stepId.localeCompare(right.stepId);
  });
  const planningStep = syntheticSteps.find(
    (step) => step.stepId === toId("planning", 0, "planning"),
  );
  if (!planningStep) {
    return sortedTimeline;
  }

  const nowMs = now.getTime();
  const futureSteps = sortedTimeline.filter(
    (step) =>
      step.stepId !== planningStep.stepId &&
      new Date(step.scheduledAt).getTime() > nowMs,
  );
  return [planningStep, ...futureSteps];
}
