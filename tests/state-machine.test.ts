import { describe, expect, it } from "vitest";

import {
  advanceAfterCurrentStep,
  buildTimeline,
  createInitialTripState,
} from "../src/domain/state-machine.js";
import { TripRecord } from "../src/domain/types.js";
import { buildFixtureTripPlan } from "../src/testing/fakes.js";

function buildPlan(days: number) {
  return buildFixtureTripPlan({
    tripId: "trip-1",
    originCity: "Hong Kong",
    destinationCity: "Tokyo",
    days,
  });
}

describe("state machine", () => {
  it("builds an activity-driven timeline for a 3-day trip", () => {
    const timeline = buildTimeline(
      buildPlan(3),
      new Date("2026-04-09T00:00:00.000Z"),
    );

    expect(timeline[0]?.phase).toBe("planning");
    expect(timeline[0]?.day).toBe(0);
    expect(timeline[0]?.context?.activity.description).toContain(
      "Before leaving Hong Kong for Tokyo",
    );
    expect(timeline[0]?.context?.activity.location).toContain("Departure prep");
    expect(timeline.at(-1)?.phase).toBe("home_reflection");
    expect(
      timeline.filter((step) => step.context?.isExtraMessage).length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      timeline.filter(
        (step) =>
          step.context?.kind === "activity" &&
          step.context.activity.type === "transport",
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("supports cross-day single-slot timestamps like 02:00 (+1)", () => {
    const plan = buildPlan(3);
    plan.daily_itinerary[1]!.activities[5]!.time_slot = "02:00 (+1)";

    const timeline = buildTimeline(
      plan,
      new Date("2026-04-09T00:00:00.000Z"),
    );
    const lateStep = timeline.find(
      (step) =>
        step.context?.kind === "activity" &&
        step.context.activity.location.includes("Central Hotel") &&
        step.day === 2,
    );

    expect(lateStep?.context?.timing.startLocal.includes("T02:00:00")).toBe(true);
    expect(lateStep?.context?.timing.timeZone).toBe("Asia/Tokyo");
  });

  it("uses the destination local time zone for Chinese mainland destinations", () => {
    const qingdaoPlan = buildFixtureTripPlan({
      tripId: "trip-qingdao",
      originCity: "Hong Kong",
      destinationCity: "Qingdao",
      days: 3,
    });

    const timeline = buildTimeline(
      qingdaoPlan,
      new Date("2026-04-09T00:00:00.000Z"),
    );
    const firstActivityStep = timeline.find(
      (candidate) => candidate.context?.kind === "activity",
    );

    expect(firstActivityStep?.context?.timing.timeZone).toBe("Asia/Shanghai");
  });

  it("creates at least one postcard step per activity", () => {
    const plan = buildPlan(5);
    const activityCount = plan.daily_itinerary.reduce(
      (sum, day) => sum + day.activities.length,
      0,
    );
    const timeline = buildTimeline(plan, new Date("2026-04-09T00:00:00.000Z"));
    const postcardSteps = timeline.filter((step) => step.emitsPostcard);

    expect(postcardSteps.length).toBeGreaterThan(activityCount);
    expect(
      postcardSteps.filter((step) => step.context?.sendMoment === "start").length,
    ).toBe(activityCount);
  });

  it("advances through steps and completes after the final reflection", () => {
    const plan = buildPlan(3);
    const timeline = buildTimeline(plan, new Date("2026-04-09T00:00:00.000Z"));
    let record: TripRecord = {
      tripId: plan.tripId,
      personaId: "persona-1",
      request: {
        personaId: "persona-1",
        originCity: "Hong Kong",
        destinationCity: "Tokyo",
      },
      plan,
      state: createInitialTripState(
        timeline,
        new Date("2026-04-09T00:00:00.000Z"),
      ),
      timeline,
      timelineIndex: 0,
      pendingDispatch: null,
      createdAt: "2026-04-09T00:00:00.000Z",
      updatedAt: "2026-04-09T00:00:00.000Z",
    };

    for (let index = 0; index < timeline.length; index += 1) {
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
