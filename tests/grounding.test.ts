import { describe, expect, it } from "vitest";

import { buildDerivedGrounding } from "../src/domain/step-grounding.js";
import { buildTimeline } from "../src/domain/state-machine.js";
import { buildFixtureTripPlan } from "../src/testing/fakes.js";

describe("derived grounding", () => {
  it("keeps planning grounding in a neutral planning state", () => {
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
    expect(grounding.locality).toBe("Planning trip in Hong Kong");
    expect(grounding.transitSummary).toBe("walk from Hong Kong in about 0 minutes");
    expect(grounding.venueSummary.toLowerCase()).not.toContain("airport");
  });
});
