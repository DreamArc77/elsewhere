import { describe, expect, it } from "vitest";

import { OpenClawTravelCompanionService } from "../src/application/openclaw-travel-companion-service.js";
import { JsonArtifactStore, JsonPersonaRepository, JsonTripRepository } from "../src/infrastructure/json-file-repositories.js";
import { JsonlFileLogger } from "../src/infrastructure/jsonl-file-logger.js";
import { createTestRuntime } from "./helpers/runtime.js";

describe("service scheduling and crash recovery", () => {
  it("does not send duplicate postcards when the same trip is ticked concurrently", async () => {
    let releasePending: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releasePending = resolve;
    });

    const runtime = await createTestRuntime({
      hooks: {
        async afterPendingSaved() {
          await gate;
        },
      },
    });
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

    const firstRun = runtime.service.runTrip(trip.tripId);
    const secondRun = runtime.service.runTrip(trip.tripId);

    await Promise.resolve();
    releasePending?.();

    await Promise.all([firstRun, secondRun]);
    expect(runtime.messenger.sentMessages).toHaveLength(1);
  });

  it("does not run again before the next scheduled time", async () => {
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

    await runtime.service.runDueTrips();
    expect(runtime.messenger.sentMessages).toHaveLength(1);

    await runtime.service.runDueTrips();
    expect(runtime.messenger.sentMessages).toHaveLength(1);

    const updatedTrip = await runtime.tripRepository.getById(trip.tripId);
    expect(updatedTrip?.state.currentPhase).toBe("packing");
  });

  it("recovers after crashing after persisting a pending postcard", async () => {
    const runtime = await createTestRuntime({
      hooks: {
        afterPendingSaved() {
          throw new Error("boom-after-pending");
        },
      },
    });
    const persona = await runtime.service.createPersona({
      name: "Mori",
      traits: ["gentle"],
      relationship: "travel soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });
    const trip = await runtime.service.startTrip({
      personaId: persona.personaId,
      originCity: "Hong Kong",
      destinationCity: "Tokyo",
    });

    await expect(runtime.service.runTrip(trip.tripId)).rejects.toThrow(
      "boom-after-pending",
    );
    expect(runtime.messenger.sentMessages).toHaveLength(0);

    const resumedService = new OpenClawTravelCompanionService({
      personaRepository: new JsonPersonaRepository(runtime.paths.personasDir),
      tripRepository: new JsonTripRepository(runtime.paths.tripsDir),
      artifactStore: new JsonArtifactStore(runtime.paths.artifactsDir),
      scheduler: runtime.scheduler,
      messenger: runtime.messenger,
      grounding: runtime.grounding,
      imageGeneration: runtime.imageGeneration,
      clock: runtime.clock,
      logger: new JsonlFileLogger(runtime.paths.logsDir),
    });

    await resumedService.runTrip(trip.tripId);
    expect(runtime.messenger.sentMessages).toHaveLength(1);
  });

  it("deduplicates delivery after crashing after a message send", async () => {
    const runtime = await createTestRuntime({
      hooks: {
        afterMessageSent() {
          throw new Error("boom-after-send");
        },
      },
    });
    const persona = await runtime.service.createPersona({
      name: "Mori",
      traits: ["gentle"],
      relationship: "travel soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });
    const trip = await runtime.service.startTrip({
      personaId: persona.personaId,
      originCity: "Hong Kong",
      destinationCity: "Tokyo",
    });

    await expect(runtime.service.runTrip(trip.tripId)).rejects.toThrow(
      "boom-after-send",
    );
    expect(runtime.messenger.sentMessages).toHaveLength(1);

    const resumedService = new OpenClawTravelCompanionService({
      personaRepository: new JsonPersonaRepository(runtime.paths.personasDir),
      tripRepository: new JsonTripRepository(runtime.paths.tripsDir),
      artifactStore: new JsonArtifactStore(runtime.paths.artifactsDir),
      scheduler: runtime.scheduler,
      messenger: runtime.messenger,
      grounding: runtime.grounding,
      imageGeneration: runtime.imageGeneration,
      clock: runtime.clock,
      logger: new JsonlFileLogger(runtime.paths.logsDir),
    });

    await resumedService.runTrip(trip.tripId);
    expect(runtime.messenger.sentMessages).toHaveLength(1);
    expect(runtime.messenger.rawSendAttempts).toBe(2);
  });
});
