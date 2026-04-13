import {
  PhaseGroundingResult,
  RuntimeStepContext,
  TripPhase,
  TripPlan,
} from "./types.js";

function uniqueHighlights(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(0, 3);
}

export function buildDerivedGrounding(input: {
  plan: TripPlan;
  phase: TripPhase;
  day: number;
  stepContext: RuntimeStepContext;
}): PhaseGroundingResult {
  const activity = input.stepContext.activity;
  const liveUpdate = activity.real_time_info.live_update.trim();

  return {
    phase: input.phase,
    day: input.day,
    locality: activity.location,
    weatherSummary:
      input.plan.daily_itinerary.find((entry) => entry.day === input.day)
        ?.weather_forecast ?? "",
    transitSummary: buildTransitSummary(activity),
    venueSummary: `${activity.description} ${liveUpdate}`.trim(),
    photoBrief: `${input.stepContext.sendMoment} phone-shot update at ${activity.location}.`,
    sensoryHighlights: uniqueHighlights([
      liveUpdate,
      activity.description,
      buildTransitSummary(activity),
    ]),
    groundingSources: [],
  };
}

function buildTransitSummary(activity: RuntimeStepContext["activity"]): string {
  if (activity.type === "transport" && activity.route) {
    return `${activity.route.transport_mode} from ${activity.route.from_location} to ${activity.route.to_location}`;
  }

  return `${activity.arrival_context.transport_mode} from ${activity.arrival_context.from_location} in about ${activity.arrival_context.duration_minutes} minutes`;
}
