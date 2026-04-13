import { describe, expect, it } from "vitest";

import { deriveCompanionBusinessSituation } from "../src/domain/business-situation.js";
import { createTestRuntime } from "./helpers/runtime.js";

describe("companion business situation", () => {
  it("derives an idle situation when there is no active trip", () => {
    const situation = deriveCompanionBusinessSituation(null);

    expect(situation.mode).toBe("idle");
    expect(situation.scene).toBe("idle");
    expect(situation.presence).toBe("available");
    expect(situation.replyDelayMs).toBe(2 * 60 * 1000);
  });

  it("derives a planning situation before the trip leaves", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Mori",
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
    const situation = deriveCompanionBusinessSituation(record!);

    expect(situation.mode).toBe("traveling");
    expect(situation.scene).toBe("planning");
    expect(situation.presence).toBe("busy");
    expect(situation.replyDelayMs).toBe(3 * 60 * 1000);
  });

  it("derives a moving situation during departure and keeps the slower delay", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Mori",
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

    await runtime.service.runTrip(trip.tripId, { ignoreSchedule: true });
    const record = await runtime.tripRepository.getById(trip.tripId);
    const situation = deriveCompanionBusinessSituation(record!);

    expect(situation.currentPhase).toBe("departing");
    expect(situation.scene).toBe("airport");
    expect(situation.presence).toBe("moving");
    expect(situation.replyDelayMs).toBe(8 * 60 * 1000);
  });

  it("derives a regular exploration situation for non-transport travel steps", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Mori",
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

    await runtime.service.runTrip(trip.tripId, { ignoreSchedule: true });
    await runtime.service.runTrip(trip.tripId, { ignoreSchedule: true });
    await runtime.service.runTrip(trip.tripId, { ignoreSchedule: true });
    const record = await runtime.tripRepository.getById(trip.tripId);
    const situation = deriveCompanionBusinessSituation(record!);

    expect(situation.currentPhase).toBe("day_exploration");
    expect(situation.scene).toBe("shopping");
    expect(situation.presence).toBe("available");
    expect(situation.replyDelayMs).toBe(3 * 60 * 1000);
  });
});
