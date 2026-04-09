import { describe, expect, it } from "vitest";

import { deriveImageIntent } from "../src/domain/image-intent.js";
import { buildTimeline } from "../src/domain/state-machine.js";
import { buildFixtureTripPlan } from "../src/testing/fakes.js";

const plan = buildFixtureTripPlan({
  tripId: "trip-intent",
  originCity: "Hong Kong",
  destinationCity: "Tokyo",
  days: 3,
});

const timeline = buildTimeline(plan, new Date("2026-04-09T00:00:00.000Z"));
const step = timeline.find((candidate) => candidate.context?.kind === "activity")!;
const stepContext = step.context!;

describe("image intent", () => {
  it("is deterministic for the same trip step", () => {
    const first = deriveImageIntent({
      tripId: "trip-fixed",
      stepId: step.stepId,
      plan,
      stepContext,
    });
    const second = deriveImageIntent({
      tripId: "trip-fixed",
      stepId: step.stepId,
      plan,
      stepContext,
    });

    expect(second).toEqual(first);
  });

  it("uses a stable ratio close to 70 percent selfie", () => {
    let selfieCount = 0;

    for (let index = 0; index < 1000; index += 1) {
      const intent = deriveImageIntent({
        tripId: `trip-${index}`,
        stepId: step.stepId,
        plan,
        stepContext,
      });
      if (intent.shotKind === "selfie") {
        selfieCount += 1;
      }
    }

    expect(selfieCount).toBeGreaterThan(620);
    expect(selfieCount).toBeLessThan(780);
  });

  it("formats local time and reference-image usage consistently", () => {
    const intent = deriveImageIntent({
      tripId: "trip-format",
      stepId: step.stepId,
      plan,
      stepContext,
    });

    expect(intent.currentTimeLocal).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(intent.destinationWithLocation).toContain(plan.metadata.destination);
    expect(intent.destinationWithLocation).toContain(stepContext.activity.location);
    expect(intent.usesReferenceImage).toBe(intent.shotKind === "selfie");
  });
});
