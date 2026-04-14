import { createHash } from "node:crypto";

import { ImageIntent, RuntimeStepContext, TripPlan } from "./types.js";

function stableBucket(seed: string): number {
  const digest = createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0) % 100;
}

function formatLocalTimestamp(localIso: string): string {
  return localIso.replace("T", " ").slice(0, 16);
}

function pickStable<T>(seed: string, values: T[]): T {
  const bucket = stableBucket(seed);
  return values[bucket % values.length]!;
}

function resolveWeatherSummary(input: {
  plan: TripPlan;
  stepContext: RuntimeStepContext;
}): string {
  const fallback =
    input.plan.daily_itinerary[0]?.weather_forecast?.trim() || "晴，18°C - 28°C";
  if (input.stepContext.phase === "planning") {
    return fallback;
  }

  return (
    input.plan.daily_itinerary.find((entry) => entry.day === input.stepContext.day)
      ?.weather_forecast?.trim() || fallback
  );
}

function resolvePromptLocation(input: {
  stepContext: RuntimeStepContext;
}): string {
  if (input.stepContext.phase === "planning") {
    return "自己的房间中";
  }

  return `${input.stepContext.activity.location.trim()} - ${input.stepContext.activity.description.trim()}`;
}

function resolveTransportBehavior(input: {
  routeMode?: string;
  toLocation?: string;
}): string {
  const suffix = input.toLocation ? `，前往${input.toLocation}` : "";
  switch (input.routeMode) {
    case "airplane":
      return `在飞机上${suffix}`;
    case "train":
      return `在高铁或火车上${suffix}`;
    case "subway":
      return `在地铁上${suffix}`;
    case "car":
      return `在车上${suffix}`;
    case "walk":
      return `步行前往下一个地方${suffix}`;
    default:
      return `正在路上${suffix}`;
  }
}

function resolvePromptBehavior(input: {
  tripId: string;
  stepId: string;
  plan: TripPlan;
  stepContext: RuntimeStepContext;
}): string {
  if (input.stepContext.phase === "planning") {
    return `打包行李，准备去${input.plan.metadata.destination}旅行`;
  }

  const activity = input.stepContext.activity;
  switch (activity.type) {
    case "sightseeing":
      return "观光打卡";
    case "shopping":
      return "逛街购物";
    case "food":
      return pickStable(`${input.tripId}:${input.stepId}:food`, [
        "吃饭",
        "等位吃饭",
        "点餐吃饭",
      ]);
    case "accommodation":
      return pickStable(`${input.tripId}:${input.stepId}:accommodation`, [
        "入住酒店",
        "回房间休息",
        "在住处休息",
      ]);
    case "transport":
      return resolveTransportBehavior({
        routeMode:
          activity.route?.transport_mode ?? activity.arrival_context.transport_mode,
        toLocation: activity.route?.to_location,
      });
    default:
      return activity.description.trim();
  }
}

export function deriveImageIntent(input: {
  tripId: string;
  stepId: string;
  plan: TripPlan;
  stepContext: RuntimeStepContext;
}): ImageIntent {
  const bucket = stableBucket(`${input.tripId}:${input.stepId}`);
  const shotKind = bucket < 70 ? "selfie" : "snapshot";
  const activityLocation = input.stepContext.activity.location.trim();
  const destinationWithLocation = `${input.plan.metadata.destination} ${activityLocation}`.trim();

  return {
    shotKind,
    usesReferenceImage: shotKind === "selfie",
    currentTimeLocal: formatLocalTimestamp(input.stepContext.timing.startLocal),
    destinationWithLocation,
    activityLocation,
    activityDescription: input.stepContext.activity.description.trim(),
    weatherSummary: resolveWeatherSummary(input),
    promptLocation: resolvePromptLocation(input),
    promptBehavior: resolvePromptBehavior(input),
  };
}
