import {
  ActivityTiming,
  DailyItinerary,
  ItineraryActivity,
  RuntimeStepContext,
  TimelineStep,
  TripPhase,
  TripPlan,
} from "./types.js";

const EXTRA_MESSAGE_THRESHOLD_MINUTES = 150;
const DEFAULT_SINGLE_SLOT_MINUTES = 30;
const SYNTHETIC_REFLECTION_DELAY_MINUTES = 120;

const DESTINATION_TIME_ZONE_MAP: Array<[RegExp, string]> = [
  [/tokyo|東京/u, "Asia/Tokyo"],
  [/osaka|kyoto|京都|大阪/u, "Asia/Tokyo"],
  [/shanghai|上海/u, "Asia/Shanghai"],
  [/hong\s*kong|香港/u, "Asia/Hong_Kong"],
  [/taipei|台北/u, "Asia/Taipei"],
  [/seoul|首尔|首爾/u, "Asia/Seoul"],
  [/singapore|新加坡/u, "Asia/Singapore"],
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

function parseTimeParts(time: string): { hour: number; minute: number } {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})$/u);
  if (!match) {
    throw new Error(`Invalid itinerary time: ${time}`);
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
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

function parseTimeToken(token: string): {
  hour: number;
  minute: number;
  dayOffset: number;
} {
  const match = token
    .trim()
    .match(/^(\d{1,2}:\d{2})(?:\s*\(\+(\d+)\))?$/u);
  if (!match) {
    throw new Error(`Invalid itinerary time: ${token}`);
  }

  const time = parseTimeParts(match[1]!);
  return {
    ...time,
    dayOffset: Number(match[2] ?? "0"),
  };
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
  const startParts = parseTimeToken((rangeMatch?.[1] ?? singleMatch?.[1])!);
  const endParts = rangeMatch
    ? parseTimeToken(rangeMatch[2]!)
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
  const destination = plan.metadata.destination.trim();
  for (const [pattern, timeZone] of DESTINATION_TIME_ZONE_MAP) {
    if (pattern.test(destination)) {
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
  const departure = plan.transportation.departure.departure;
  const firstDayWeather = plan.daily_itinerary[0]?.weather_forecast ?? "";
  return {
    time_slot: departure.time,
    location: `Departure prep near ${departure.station}`,
    address: departure.station,
    type: "transport",
    description: `Before leaving ${plan.metadata.origin} for ${plan.metadata.destination}, review the plan, pack lightly, and get ready to reach ${departure.station} before departure.`,
    arrival_context: {
      from_location: departure.station,
      transport_mode: plan.transportation.departure.transport_mode,
      duration_minutes: 0,
    },
    route: {
      from_location: departure.station,
      to_location: departure.station,
      transport_mode: plan.transportation.departure.transport_mode,
    },
    real_time_info: {
      live_update: firstDayWeather,
    },
  };
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
  const lastActivityStep = activitySteps[activitySteps.length - 1];
  if (!firstActivityStep?.context || !lastActivityStep?.context) {
    throw new Error("Trip plan must contain at least one activity.");
  }

  const reflectionAt = new Date(
    new Date(lastActivityStep.context.timing.endUtc).getTime() +
      SYNTHETIC_REFLECTION_DELAY_MINUTES * 60 * 1000,
  ).toISOString();
  const planningTiming = buildSyntheticTiming(now, timeZone);
  const planningActivity = buildPlanningActivity(plan);
  const firstDay = getDayItinerary(plan, firstActivityStep.day)!;

  return [
    {
      stepId: toId("planning", 0, "synthetic"),
      phase: "planning",
      day: 0,
      emitsPostcard: true,
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
        activityIndex: -1,
        activity: planningActivity,
        previousActivity: undefined,
        nextActivity: firstDay.activities[0],
        timing: planningTiming,
      }),
    },
    ...activitySteps,
    {
      stepId: toId("home_reflection", plan.metadata.days, "synthetic"),
      phase: "home_reflection",
      day: plan.metadata.days,
      emitsPostcard: true,
      scheduledAt: reflectionAt,
      context: buildSyntheticContext({
        kind: "home_reflection",
        phase: "home_reflection",
        itinerary: getDayItinerary(plan, lastActivityStep.day)!,
        activityIndex: lastActivityStep.context.activityIndex,
        activity: lastActivityStep.context.activity,
        previousActivity: lastActivityStep.context.previousActivity,
        nextActivity: undefined,
        timing: lastActivityStep.context.timing,
      }),
    },
  ];
}
