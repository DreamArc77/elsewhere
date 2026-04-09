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
    weatherSummary: input.plan.search_summary.weather_forecast,
    transitSummary: activity.transport_memo,
    venueSummary: `${activity.description} ${liveUpdate}`.trim(),
    photoBrief: `${input.stepContext.sendMoment} phone-shot update at ${activity.location}.`,
    sensoryHighlights: uniqueHighlights([
      liveUpdate,
      activity.description,
      activity.transport_memo,
    ]),
    groundingSources: [],
  };
}
