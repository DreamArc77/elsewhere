import { describe, expect, it } from "vitest";

import {
  createStateAnchorFromTimelineStep,
  deriveCompanionBusinessSituation,
  resolveAgentState,
} from "../src/domain/business-situation.js";
import { createTestRuntime } from "./helpers/runtime.js";

describe("companion business situation", () => {
  it("derives idle when there is no active trip", () => {
    const situation = deriveCompanionBusinessSituation(null);

    expect(situation.state).toBe("idle");
    expect(situation.substate).toBe("idle");
    expect(situation.mode).toBe("idle");
  });

  it("starts in planning right after trip creation", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle", "curious"],
      relationship: "travel soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });

    const trip = await runtime.service.startTrip({
      personaId: persona.personaId,
      originCity: "Hong Kong",
      destinationCity: "Tokyo",
    });

    const record = await runtime.tripRepository.getById(trip.tripId);
    const situation = deriveCompanionBusinessSituation(
      record!,
      new Date(record!.createdAt),
    );

    expect(situation.state).toBe("plan");
    expect(situation.substate).toBe("planning");
  });

  it("moves into packing after the short planning state", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle", "curious"],
      relationship: "travel soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });

    const trip = await runtime.service.startTrip({
      personaId: persona.personaId,
      originCity: "Hong Kong",
      destinationCity: "Tokyo",
    });

    const record = await runtime.tripRepository.getById(trip.tripId);
    const situation = deriveCompanionBusinessSituation(
      record!,
      new Date(new Date(record!.createdAt).getTime() + 2 * 60 * 1000),
    );

    expect(situation.state).toBe("plan");
    expect(situation.substate).toBe("packing");
  });

  it("keeps state resolution working when transport legs contain full datetime strings", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle", "curious"],
      relationship: "travel soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });

    const trip = await runtime.service.startTrip({
      personaId: persona.personaId,
      originCity: "Hong Kong",
      destinationCity: "Tokyo",
    });

    const record = await runtime.tripRepository.getById(trip.tripId);
    record!.plan.transportation.departure.departure.time = "2026-04-11 08:30";
    record!.plan.transportation.departure.arrival.time = "2026-04-11 12:30";
    record!.plan.transportation.return.departure.time = "2026-04-13 21:30";
    record!.plan.transportation.return.arrival.time = "2026-04-14 01:10";

    const situation = deriveCompanionBusinessSituation(
      record!,
      new Date(record!.createdAt),
    );

    expect(situation.state).toBe("plan");
    expect(situation.substate).toBe("planning");
  });

  it("uses persona home city as stateLocation during planning-like states", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Osaka",
      traits: ["gentle", "curious"],
      relationship: "travel soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });

    const trip = await runtime.service.startTrip({
      personaId: persona.personaId,
      originCity: "Hong Kong",
      destinationCity: "Tokyo",
    });

    const record = await runtime.tripRepository.getById(trip.tripId);
    const resolvedState = resolveAgentState({
      activeTrip: record!,
      now: new Date(new Date(record!.createdAt).getTime() + 2 * 60 * 1000),
      persona,
    });

    expect(resolvedState.stage.substate).toBe("packing");
    expect(resolvedState.state.location).toBe("Osaka");
  });

  it("derives before_departure in the final three hours before outbound transport", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle", "curious"],
      relationship: "travel soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });

    const trip = await runtime.service.startTrip({
      personaId: persona.personaId,
      originCity: "Hong Kong",
      destinationCity: "Tokyo",
    });

    const record = await runtime.tripRepository.getById(trip.tripId);
    const situation = deriveCompanionBusinessSituation(
      record!,
      new Date("2026-04-11T22:00:00.000Z"),
    );

    expect(situation.state).toBe("departure");
    expect(situation.substate).toBe("before_departure");
  });

  it("derives freetime between finished activity and next moving window", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle", "curious"],
      relationship: "travel soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });

    const trip = await runtime.service.startTrip({
      personaId: persona.personaId,
      originCity: "Hong Kong",
      destinationCity: "Tokyo",
    });

    const record = await runtime.tripRepository.getById(trip.tripId);
    const situation = deriveCompanionBusinessSituation(
      record!,
      new Date("2026-04-13T03:05:00.000Z"),
    );

    expect(situation.state).toBe("activities");
    expect(situation.substate).toBe("freetime");
  });

  it("derives moving_to_next_activity right before a timed activity", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle", "curious"],
      relationship: "travel soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });

    const trip = await runtime.service.startTrip({
      personaId: persona.personaId,
      originCity: "Hong Kong",
      destinationCity: "Tokyo",
    });

    const record = await runtime.tripRepository.getById(trip.tripId);
    const situation = deriveCompanionBusinessSituation(
      record!,
      new Date("2026-04-13T03:12:00.000Z"),
    );

    expect(situation.state).toBe("activities");
    expect(situation.substate).toBe("moving_to_next_activity");
  });

  it("derives food during an active food activity", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle", "curious"],
      relationship: "travel soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });

    const trip = await runtime.service.startTrip({
      personaId: persona.personaId,
      originCity: "Hong Kong",
      destinationCity: "Tokyo",
    });

    const record = await runtime.tripRepository.getById(trip.tripId);
    const situation = deriveCompanionBusinessSituation(
      record!,
      new Date("2026-04-13T03:20:00.000Z"),
    );

    expect(situation.state).toBe("activities");
    expect(situation.substate).toBe("food");
    expect(situation.scene).toBe("food");
  });

  it("prefers the latest postcard state anchor over wall-clock planning state", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle", "curious"],
      relationship: "travel soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });

    const trip = await runtime.service.startTrip({
      personaId: persona.personaId,
      originCity: "Hong Kong",
      destinationCity: "Qingdao",
    });

    await runtime.service.runTrip(trip.tripId, { ignoreSchedule: true });
    await runtime.service.runTrip(trip.tripId, { ignoreSchedule: true });

    const record = await runtime.tripRepository.getById(trip.tripId);
    const situation = deriveCompanionBusinessSituation(
      record!,
      runtime.clock.now(),
    );

    expect(record?.state.activeStateAnchor?.source).toBe("postcard");
    expect(situation.state).toBe("plan");
    expect(situation.substate).toBe("packing");
  });

  it("does not carry synthetic airport activity into planning anchors", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle", "curious"],
      relationship: "travel soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });

    const trip = await runtime.service.startTrip({
      personaId: persona.personaId,
      originCity: "Hong Kong",
      destinationCity: "Qingdao",
    });

    const record = await runtime.tripRepository.getById(trip.tripId);
    const planningStep = record?.timeline[0];
    expect(planningStep?.phase).toBe("planning");

    const anchor = createStateAnchorFromTimelineStep({
      record: record!,
      step: planningStep!,
      sentAt: planningStep!.scheduledAt,
    });

    expect(anchor?.snapshot?.situation.substate).toBe("planning");
    expect(anchor?.snapshot?.currentActivity).toBeUndefined();
    expect(anchor?.snapshot?.nextActivity?.location).toBe(
      "Final packing in Hong Kong",
    );
  });
});
