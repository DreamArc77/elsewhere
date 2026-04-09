import { createHash } from "node:crypto";

import {
  ImageIntent,
  RuntimeStepContext,
  TripPlan,
} from "./types.js";

function stableBucket(seed: string): number {
  const digest = createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0) % 100;
}

function formatLocalTimestamp(localIso: string): string {
  return localIso.replace("T", " ").slice(0, 16);
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
  };
}
