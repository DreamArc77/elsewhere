import { describe, expect, it } from "vitest";

import {
  advanceAfterCurrentStep,
  buildTimeline,
  createInitialTripState,
} from "../src/domain/state-machine.js";
import { TripPlan, TripRecord } from "../src/domain/types.js";

function buildPlan(days: number): TripPlan {
  return {
    tripId: "trip-1",
    days,
    transport: {
      summary: "Flight",
      departure: "Hong Kong",
      arrival: "Tokyo",
    },
    hotel: {
      name: "Central Hotel",
      district: "Shinjuku",
    },
    dailyAgenda: Array.from({ length: days }, (_, index) => ({
      day: index + 1,
      dateLabel: `Day ${index + 1}`,
      headline: `Headline ${index + 1}`,
      morning: ["Coffee"],
      afternoon: ["Museum"],
      evening: ["Walk"],
      notes: "Slow pace",
    })),
    groundingSources: [{ title: "Source", uri: "https://example.com" }],
    weatherSummary: "Sunny",
    recommendedPostingMoments: [
      "planning",
      "departing",
      "arrival_checkin",
      "day_exploration",
      "returning",
      "home_reflection",
    ],
  };
}

describe("state machine", () => {
  it("builds a deterministic timeline for a 3-day trip", () => {
    const timeline = buildTimeline(buildPlan(3));

    expect(timeline.map((step) => `${step.phase}:${step.day}`)).toEqual([
      "planning:0",
      "packing:0",
      "departing:0",
      "in_transit:0",
      "arrival_checkin:1",
      "day_exploration:1",
      "day_exploration:2",
      "day_exploration:3",
      "returning:3",
      "home_reflection:3",
    ]);
  });

  it("repeats day exploration for every itinerary day", () => {
    const timeline = buildTimeline(buildPlan(5));
    const daySteps = timeline.filter((step) => step.phase === "day_exploration");
    expect(daySteps).toHaveLength(5);
    expect(daySteps.map((step) => step.day)).toEqual([1, 2, 3, 4, 5]);
  });

  it("advances through phases and completes after the last postcard", () => {
    const plan = buildPlan(3);
    const timeline = buildTimeline(plan);
    let record: TripRecord = {
      tripId: plan.tripId,
      personaId: "persona-1",
      request: {
        personaId: "persona-1",
        originCity: "Hong Kong",
        destinationCity: "Tokyo",
      },
      plan,
      state: createInitialTripState(timeline, new Date("2026-04-09T00:00:00.000Z")),
      timeline,
      timelineIndex: 0,
      pendingDispatch: null,
      createdAt: "2026-04-09T00:00:00.000Z",
      updatedAt: "2026-04-09T00:00:00.000Z",
    };

    for (let i = 0; i < timeline.length; i += 1) {
      const advanced = advanceAfterCurrentStep(
        record,
        new Date("2026-04-09T00:00:00.000Z"),
      );
      record = {
        ...record,
        state: advanced.state,
        timelineIndex: advanced.timelineIndex,
      };
    }

    expect(record.state.status).toBe("completed");
    expect(record.state.nextRunAt).toBeNull();
  });
});
