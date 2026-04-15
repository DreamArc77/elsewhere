import { describe, expect, it } from "vitest";

import { createTestRuntime } from "./helpers/runtime.js";

describe("end-to-end fixture trip", () => {
  it("completes a 3-day trip with postcards and artifacts", async () => {
    const runtime = await createTestRuntime({ days: 3 });
    const persona = await runtime.service.createPersona({
      name: "Haru",
      homeCity: "Hong Kong",
      traits: ["playful", "steady"],
      relationship: "travel soulmate",
      toneStyle: "gentle",
      referenceImageAsset: runtime.referenceImagePath,
    });

    const trip = await runtime.service.startTrip({
      personaId: persona.personaId,
      originCity: "Hong Kong",
      destinationCity: "Tokyo",
    });

    let record = await runtime.tripRepository.getById(trip.tripId);
    while (record?.state.status !== "completed") {
      if (record?.state.nextRunAt) {
        runtime.clock.set(new Date(record.state.nextRunAt));
      }
      await runtime.service.runDueTrips();
      record = await runtime.tripRepository.getById(trip.tripId);
    }

    const expectedPostcards = record?.timeline.length ?? 0;
    expect(runtime.messenger.sentMessages).toHaveLength(expectedPostcards);
    expect(record?.state.status).toBe("completed");
    expect(record?.state.artifacts.length).toBe(1 + expectedPostcards * 3);
    expect(
      record?.state.artifacts.filter((artifact) => artifact.kind === "image").length,
    ).toBe(expectedPostcards);
    expect(
      record?.state.artifacts.filter((artifact) => artifact.kind === "grounding")
        .length,
    ).toBe(expectedPostcards);
  });
});
