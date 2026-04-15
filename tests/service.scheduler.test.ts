import { describe, expect, it } from "vitest";

import { OpenClawTravelCompanionService } from "../src/application/openclaw-travel-companion-service.js";
import type { TripPlan } from "../src/domain/types.js";
import { JsonArtifactStore, JsonPersonaRepository, JsonTripRepository } from "../src/infrastructure/json-file-repositories.js";
import { JsonlFileLogger } from "../src/infrastructure/jsonl-file-logger.js";
import { createTestRuntime } from "./helpers/runtime.js";
import { buildFixtureTripPlan } from "../src/testing/fakes.js";

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

    const firstRun = runtime.service.runTrip(trip.tripId);
    const secondRun = runtime.service.runTrip(trip.tripId);

    await Promise.resolve();
    releasePending?.();

    await Promise.all([firstRun, secondRun]);
    expect(runtime.messenger.sentMessages).toHaveLength(1);
  });

  it("does not send duplicate postcards across separate service instances", async () => {
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

    const siblingService = new OpenClawTravelCompanionService({
      personaRepository: new JsonPersonaRepository(runtime.paths.personasDir),
      tripRepository: new JsonTripRepository(runtime.paths.tripsDir),
      artifactStore: new JsonArtifactStore(runtime.paths.artifactsDir),
      scheduler: runtime.scheduler,
      messenger: runtime.messenger,
      grounding: runtime.grounding,
      imageGeneration: runtime.imageGeneration,
      clock: runtime.clock,
      logger: new JsonlFileLogger(runtime.paths.logsDir),
      hooks: {
        async afterPendingSaved() {
          await gate;
        },
      },
    });

    const firstRun = runtime.service.runTrip(trip.tripId);
    const secondRun = siblingService.runTrip(trip.tripId);

    await Promise.resolve();
    releasePending?.();

    await Promise.all([firstRun, secondRun]);
    expect(runtime.messenger.sentMessages).toHaveLength(1);
  });

  it("does not run again before the next scheduled time", async () => {
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

    await runtime.service.runDueTrips();
    expect(runtime.messenger.sentMessages).toHaveLength(1);

    await runtime.service.runDueTrips();
    expect(runtime.messenger.sentMessages).toHaveLength(1);

    const updatedTrip = await runtime.tripRepository.getById(trip.tripId);
    expect(updatedTrip?.state.currentPhase).toBe("planning");
  });

  it("can force the next step immediately for manual testing", async () => {
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

    await runtime.service.runDueTrips();
    expect(runtime.messenger.sentMessages).toHaveLength(1);

    await runtime.service.runTrip(trip.tripId, { ignoreSchedule: true });
    expect(runtime.messenger.sentMessages).toHaveLength(2);

    const updatedTrip = await runtime.tripRepository.getById(trip.tripId);
    expect(updatedTrip?.state.currentPhase).toBe("departing");
  });

  it("can stop an old trip so it no longer schedules messages", async () => {
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

    const stopped = await runtime.service.stopTrip(trip.tripId);
    expect(stopped.state.status).toBe("completed");
    expect(stopped.state.nextRunAt).toBeNull();

    await runtime.service.runDueTrips();
    expect(runtime.messenger.sentMessages).toHaveLength(0);
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
      homeCity: "Hong Kong",
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
      homeCity: "Hong Kong",
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

  it("normalizes boundary arrival context for the first and last activities", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle"],
      relationship: "travel soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });

    const brokenPlan: TripPlan = buildFixtureTripPlan({
      tripId: "trip-broken",
      originCity: "Hong Kong",
      destinationCity: "Qingdao",
      days: 3,
    });
    brokenPlan.daily_itinerary[0]!.activities[0]!.arrival_context.from_location =
      "Hong Kong International Airport";
    brokenPlan.daily_itinerary[0]!.activities[0]!.arrival_context.transport_mode =
      "airplane";
    brokenPlan.daily_itinerary[0]!.activities[0]!.route!.from_location =
      "Hong Kong International Airport";
    brokenPlan.daily_itinerary[0]!.activities[0]!.location =
      "Hong Kong International Airport -> Qingdao Central Hotel";
    brokenPlan.daily_itinerary[2]!.activities[2]!.route!.to_location =
      "Some Wrong Place";
    brokenPlan.daily_itinerary[2]!.activities[2]!.location =
      "Qingdao Downtown -> Some Wrong Place";

    runtime.grounding.planTrip = async ({ tripId }) => ({
      ...brokenPlan,
      tripId,
    });

    const trip = await runtime.service.startTrip({
      personaId: persona.personaId,
      originCity: "Hong Kong",
      destinationCity: "Qingdao",
    });

    expect(
      trip.plan.daily_itinerary[0]!.activities[0]!.arrival_context.from_location,
    ).toBe("Qingdao International Airport");
    expect(trip.plan.daily_itinerary[0]!.activities[0]!.route?.from_location).toBe(
      "Qingdao International Airport",
    );
    expect(trip.plan.daily_itinerary[2]!.activities[2]!.route?.to_location).toBe(
      "Qingdao International Airport",
    );
  });

  it("keeps the image summary instruction out of compose-caption while preserving it for image generation", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle"],
      relationship: "travel soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });

    let generatedImagePrompt = "";
    let captionImagePrompt = "";

    const originalGenerateImage =
      runtime.imageGeneration.generateImage.bind(runtime.imageGeneration);
    runtime.imageGeneration.generateImage = async (input) => {
      generatedImagePrompt = input.prompt;
      return await originalGenerateImage(input);
    };

    const originalComposeCaption =
      runtime.grounding.composeCaption.bind(runtime.grounding);
    runtime.grounding.composeCaption = async (input) => {
      captionImagePrompt = input.imagePrompt;
      return await originalComposeCaption(input);
    };

    const trip = await runtime.service.startTrip({
      personaId: persona.personaId,
      originCity: "Hong Kong",
      destinationCity: "Tokyo",
    });

    await runtime.service.runTrip(trip.tripId, { ignoreSchedule: true });

    expect(generatedImagePrompt).toContain("输出该图片的提要信息");
    expect(captionImagePrompt).not.toContain("输出该图片的提要信息");
    expect(captionImagePrompt).not.toContain('"otherPeopleVisible"');
  });
});
