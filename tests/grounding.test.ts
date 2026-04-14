import { describe, expect, it } from "vitest";

import { buildDerivedGrounding } from "../src/domain/step-grounding.js";
import { buildTimeline } from "../src/domain/state-machine.js";
import { buildFixtureTripPlan } from "../src/testing/fakes.js";

describe("derived grounding", () => {
  it("does not describe planning transit as moving from the airport to the same airport", () => {
    const plan = buildFixtureTripPlan({
      tripId: "trip-grounding",
      originCity: "Hong Kong",
      destinationCity: "Tokyo",
      days: 3,
    });
    const timeline = buildTimeline(plan, new Date("2026-04-09T00:00:00.000Z"));
    const planningStep = timeline[0]!;

    const grounding = buildDerivedGrounding({
      plan,
      phase: planningStep.phase,
      day: planningStep.day,
      stepContext: planningStep.context!,
    });

    expect(grounding.phase).toBe("planning");
    expect(grounding.transitSummary).toContain("Preparing to depart from");
    expect(grounding.transitSummary).not.toContain("to 香港国际机场");
  });
});
