import { describe, expect, it } from "vitest";

import { deriveCompanionBusinessSituation } from "../src/domain/business-situation.js";
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

  it("derives before_departure in the final three hours before outbound transport", async () => {
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
});
