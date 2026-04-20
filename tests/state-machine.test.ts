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
      "checking tickets and routes",
    );
    expect(timeline[0]?.context?.activity.location).toBe(
      "Planning trip in Hong Kong",
    );
    expect(timeline.at(-1)?.phase).toBe("returning");
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

  it("builds the timeline even when transport legs contain full datetime strings", () => {
    const plan = buildPlan(3);
    plan.transportation.departure.departure.time = "2026-04-10 08:30";
    plan.transportation.departure.arrival.time = "2026-04-10 12:30";
    plan.transportation.return.departure.time = "2026-04-12 21:30";
    plan.transportation.return.arrival.time = "2026-04-13 01:10";

    const timeline = buildTimeline(
      plan,
      new Date("2026-04-09T00:00:00.000Z"),
    );

    expect(timeline[0]?.phase).toBe("planning");
    expect(timeline.find((step) => step.phase === "departing")).toBeTruthy();
    expect(timeline.find((step) => step.phase === "returning")).toBeTruthy();
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
      (candidate) =>
        candidate.context?.kind === "activity" &&
        candidate.context.activityIndex === 0 &&
        candidate.day === 1,
    );

    expect(firstActivityStep?.context?.timing.timeZone).toBe("Asia/Shanghai");
  });

  it("uses Chinese city names when resolving transport time zones", () => {
    const plan = buildFixtureTripPlan({
      tripId: "trip-beijing",
      originCity: "成都",
      destinationCity: "北京",
      days: 3,
    });

    const timeline = buildTimeline(
      plan,
      new Date("2026-04-11T08:00:00.000Z"),
    );
    const departureStep = timeline.find(
      (step) => step.stepId === "departing:1:main_departing",
    );

    expect(departureStep?.scheduledAt).toBe("2026-04-12T00:15:00.000Z");
    expect(departureStep?.context?.timing.timeZone).toBe("Asia/Shanghai");
  });

  it("does not queue overdue non-planning steps before a new trip planning step", () => {
    const plan = buildFixtureTripPlan({
      tripId: "trip-overdue",
      originCity: "成都",
      destinationCity: "北京",
      days: 3,
    });
    const now = new Date("2026-04-12T01:00:00.000Z");

    const timeline = buildTimeline(plan, now);

    expect(timeline[0]?.stepId).toBe("planning:0:planning");
    expect(
      timeline
        .slice(1)
        .every((step) => new Date(step.scheduledAt).getTime() > now.getTime()),
    ).toBe(true);
    expect(
      timeline.some((step) => step.stepId === "departing:1:main_departing"),
    ).toBe(false);
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

  it("keeps synthetic planning-state nextActivity inside the synthetic chain", () => {
    const plan = buildPlan(3);
    const timeline = buildTimeline(plan, new Date("2026-04-09T00:00:00.000Z"));
    const planningStep = timeline.find((step) => step.stepId === "planning:0:planning");
    const packingStep = timeline.find((step) => step.stepId === "planning:0:packing");
    const beforeDepartureStep = timeline.find(
      (step) => step.stepId === "departing:1:before_departure",
    );

    expect(planningStep?.context?.nextActivity?.location).toBe(
      packingStep?.context?.activity.location,
    );
    expect(packingStep?.context?.nextActivity?.location).toBe(
      beforeDepartureStep?.context?.activity.location,
    );
    expect(beforeDepartureStep?.context?.nextActivity?.location).toBe(
      `${plan.transportation.departure.departure.station} -> ${plan.transportation.departure.arrival.station}`,
    );
  });

  it("advances through steps and completes after the final postcard", () => {
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
