import { randomUUID } from "node:crypto";

import {
  ClockPort,
  ImageIntent,
  LogEntry,
  OpenClawTravelCompanionServiceDependencies,
  PersonaProfile,
  PhaseGroundingResult,
  Postcard,
  StoredPersonaProfile,
  TripPhase,
  TripPlan,
  TripRecord,
  TripRequest,
} from "../domain/types.js";
import {
  advanceAfterCurrentStep,
  buildTimeline,
  createInitialTripState,
  getCurrentStep,
  isPostcardStep,
  isTripDue,
} from "../domain/state-machine.js";
import { deriveImageIntent } from "../domain/image-intent.js";
import { buildDerivedGrounding } from "../domain/step-grounding.js";
import { renderImageGenerationPrompt } from "../prompting/travel-companion-prompts.js";

function nowIso(clock: ClockPort): string {
  return clock.now().toISOString();
}

function elapsedMs(startedAt: string, finishedAt: string): number {
  return new Date(finishedAt).getTime() - new Date(startedAt).getTime();
}

function detectImageExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/jpeg":
      return "jpg";
    default:
      return "bin";
  }
}

export class OpenClawTravelCompanionService {
  private readonly inFlightTripIds = new Set<string>();

  constructor(
    private readonly dependencies: OpenClawTravelCompanionServiceDependencies,
  ) {}

  async createPersona(profile: PersonaProfile): Promise<StoredPersonaProfile> {
    const persona: StoredPersonaProfile = {
      personaId: randomUUID(),
      createdAt: nowIso(this.dependencies.clock),
      ...profile,
    };

    await this.dependencies.personaRepository.save(persona);
    return persona;
  }

  async startTrip(request: TripRequest): Promise<TripRecord> {
    const startedAt = nowIso(this.dependencies.clock);
    const runId = randomUUID();
    const persona = await this.requirePersona(request.personaId);
    const tripId = randomUUID();

    try {
      const plan = await this.dependencies.grounding.planTrip({
        tripId,
        persona,
        request,
      });
      const normalizedPlan: TripPlan = {
        ...plan,
        tripId,
      };
      const planArtifactId = randomUUID();
      const planPath = await this.dependencies.artifactStore.writeJsonArtifact({
        tripId,
        artifactId: planArtifactId,
        fileName: "trip-plan.json",
        value: normalizedPlan,
      });

      const timeline = buildTimeline(
        normalizedPlan,
        this.dependencies.clock.now(),
      );
      const state = createInitialTripState(timeline, this.dependencies.clock.now());
      state.artifacts = [
        {
          artifactId: planArtifactId,
          kind: "plan",
          phase: "planning",
          path: planPath,
          createdAt: startedAt,
        },
      ];

      const record: TripRecord = {
        tripId,
        personaId: request.personaId,
        request,
        plan: normalizedPlan,
        state,
        timeline,
        timelineIndex: 0,
        pendingDispatch: null,
        createdAt: startedAt,
        updatedAt: startedAt,
        lastRunId: runId,
      };

      await this.dependencies.tripRepository.save(record);
      if (record.state.nextRunAt) {
        await this.dependencies.scheduler.scheduleTripTick({
          tripId: record.tripId,
          runAt: record.state.nextRunAt,
        });
      }

      await this.log({
        tripId,
        runId,
        phase: "planning",
        event: "trip.started",
        decision: "Created itinerary and scheduled first tick.",
        provider: "service",
        status: "success",
        startedAt,
        finishedAt: nowIso(this.dependencies.clock),
        details: { destinationCity: request.destinationCity },
      });

      return record;
    } catch (error) {
      await this.logFailure({
        tripId,
        runId,
        phase: "planning",
        event: "trip.start_failed",
        decision: "Failed to start trip.",
        provider: "service",
        startedAt,
        error,
      });
      throw error;
    }
  }

  async runDueTrips(): Promise<TripRecord[]> {
    const dueTrips = await this.dependencies.tripRepository.listDueTrips(
      this.dependencies.clock.now(),
    );

    const results: TripRecord[] = [];
    for (const trip of dueTrips) {
      results.push(await this.runTrip(trip.tripId));
    }
    return results;
  }

  async stopTrip(tripId: string): Promise<TripRecord> {
    const record = await this.requireTrip(tripId);
    const stoppedAt = nowIso(this.dependencies.clock);
    const runId = randomUUID();

    const stopped: TripRecord = {
      ...record,
      state: {
        ...record.state,
        status: "completed",
        nextRunAt: null,
        pendingPostcard: null,
      },
      pendingDispatch: null,
      updatedAt: stoppedAt,
      lastRunId: runId,
    };

    await this.dependencies.tripRepository.save(stopped);
    this.inFlightTripIds.delete(tripId);
    await this.log({
      tripId,
      runId,
      phase: record.state.currentPhase,
      event: "trip.stopped",
      decision: "Stopped trip manually for testing.",
      provider: "service",
      status: "success",
      startedAt: stoppedAt,
      finishedAt: stoppedAt,
      details: {
        previousStatus: record.state.status,
      },
    });

    return stopped;
  }

  async runTrip(
    tripId: string,
    options?: { ignoreSchedule?: boolean },
  ): Promise<TripRecord> {
    if (this.inFlightTripIds.has(tripId)) {
      return await this.requireTrip(tripId);
    }

    this.inFlightTripIds.add(tripId);
    const startedAt = nowIso(this.dependencies.clock);
    const runId = randomUUID();
    let currentStep: ReturnType<typeof getCurrentStep> | undefined;
    try {
      const record = await this.requireTrip(tripId);
      currentStep = getCurrentStep(record);

      if (!options?.ignoreSchedule && !isTripDue(record, this.dependencies.clock.now())) {
        await this.log({
          tripId,
          runId,
          phase: currentStep?.phase ?? "system",
          event: "trip.skipped",
          decision: "Trip is not due yet.",
          provider: "service",
          status: "skipped",
          startedAt,
          finishedAt: nowIso(this.dependencies.clock),
          scheduledAt: record.state.nextRunAt ?? undefined,
        });
        return record;
      }

      if (record.pendingDispatch) {
        return await this.dispatchPending(record, runId, startedAt);
      }

      if (!currentStep) {
        const completed: TripRecord = {
          ...record,
          state: {
            ...record.state,
            status: "completed",
            nextRunAt: null,
          },
          updatedAt: nowIso(this.dependencies.clock),
          lastRunId: runId,
        };
        await this.dependencies.tripRepository.save(completed);
        return completed;
      }

      if (isPostcardStep(currentStep)) {
        return await this.preparePostcard(record, runId, startedAt);
      }

      return await this.advanceSilently(record, runId, startedAt);
    } catch (error) {
      await this.logFailure({
        tripId,
        runId,
        phase: currentStep?.phase ?? "system",
        event: "trip.run_failed",
        decision: "Trip tick failed.",
        provider: "service",
        startedAt,
        error,
      });
      throw error;
    } finally {
      this.inFlightTripIds.delete(tripId);
    }
  }

  private async preparePostcard(
    record: TripRecord,
    runId: string,
    startedAt: string,
  ): Promise<TripRecord> {
    const step = getCurrentStep(record);
    if (!step?.context) {
      return record;
    }

    const persona = await this.requirePersona(record.personaId);
    const grounding = buildDerivedGrounding({
      plan: record.plan,
      phase: step.phase,
      day: step.day,
      stepContext: step.context,
    });
    const imageIntent = deriveImageIntent({
      tripId: record.tripId,
      stepId: step.stepId,
      plan: record.plan,
      stepContext: step.context,
    });
    await this.log({
      tripId: record.tripId,
      runId,
      phase: step.phase,
      event: "grounding.derived",
      decision: "Derived postcard context from the current itinerary step.",
      provider: "service",
      status: "success",
      startedAt,
      finishedAt: nowIso(this.dependencies.clock),
      details: {
        day: step.day,
        locality: grounding.locality,
        shotKind: imageIntent.shotKind,
      },
    });

    const groundingArtifactId = randomUUID();
    const groundingPath = await this.dependencies.artifactStore.writeJsonArtifact({
      tripId: record.tripId,
      artifactId: groundingArtifactId,
      fileName: `${step.stepId}-grounding.json`,
      value: grounding,
    });

    const imagePrompt = await renderImageGenerationPrompt({
      persona,
      request: record.request,
      plan: record.plan,
      stepContext: step.context,
      grounding,
      imageIntent,
    });
    const image = await this.dependencies.imageGeneration.generateImage({
      tripId: record.tripId,
      persona,
      request: record.request,
      plan: record.plan,
      phase: step.phase,
      day: step.day,
      stepContext: step.context,
      grounding,
      shotKind: imageIntent.shotKind,
      usesReferenceImage: imageIntent.usesReferenceImage,
      prompt: imagePrompt,
    });
    await this.log({
      tripId: record.tripId,
      runId,
      phase: step.phase,
      event: "image.generated",
      decision: "Generated postcard image.",
      provider: image.provider,
      status: "success",
      startedAt,
      finishedAt: nowIso(this.dependencies.clock),
      details: {
        mimeType: image.mimeType,
        day: step.day,
        shotKind: imageIntent.shotKind,
      },
    });

    const imageArtifactId = randomUUID();
    const imagePath = await this.dependencies.artifactStore.writeBinaryArtifact({
      tripId: record.tripId,
      artifactId: imageArtifactId,
      fileName: `${step.stepId}-${imageIntent.shotKind}.${detectImageExtension(
        image.mimeType,
      )}`,
      bytesBase64: image.bytesBase64,
    });

    const captionResult = await this.dependencies.grounding.composeCaption({
      tripId: record.tripId,
      persona,
      request: record.request,
      plan: record.plan,
      phase: step.phase,
      day: step.day,
      stepContext: step.context,
      grounding,
      imagePrompt,
    });

    const pendingPostcard: Postcard = {
      tripId: record.tripId,
      phase: step.phase,
      caption: captionResult.caption,
      imageAsset: imagePath,
      sentAt: "",
    };

    const updatedRecord: TripRecord = {
      ...record,
      state: {
        ...record.state,
        pendingPostcard,
        artifacts: [
          ...record.state.artifacts,
          {
            artifactId: groundingArtifactId,
            kind: "grounding",
            phase: step.phase,
            path: groundingPath,
            day: step.day,
            createdAt: nowIso(this.dependencies.clock),
          },
          {
            artifactId: imageArtifactId,
            kind: "image",
            phase: step.phase,
            path: imagePath,
            day: step.day,
            createdAt: nowIso(this.dependencies.clock),
          },
        ],
      },
      pendingDispatch: {
        stepId: step.stepId,
        phase: step.phase,
        day: step.day,
        shotKind: imageIntent.shotKind,
        postcard: pendingPostcard,
        dedupeKey: `${record.tripId}:${step.stepId}`,
        grounding,
        imagePrompt,
        artifactIds: [groundingArtifactId, imageArtifactId],
      },
      updatedAt: nowIso(this.dependencies.clock),
      lastRunId: runId,
    };

    await this.dependencies.tripRepository.save(updatedRecord);
    await this.log({
      tripId: record.tripId,
      runId,
      phase: step.phase,
      event: "postcard.pending",
      decision: "Persisted postcard before delivery for idempotency.",
      provider: captionResult.provider,
      status: "success",
      startedAt,
      finishedAt: nowIso(this.dependencies.clock),
      details: {
        dedupeKey: `${record.tripId}:${step.stepId}`,
        shotKind: imageIntent.shotKind,
      },
    });

    await this.dependencies.hooks?.afterPendingSaved?.(updatedRecord);
    return this.dispatchPending(updatedRecord, runId, startedAt);
  }

  private async dispatchPending(
    record: TripRecord,
    runId: string,
    startedAt: string,
  ): Promise<TripRecord> {
    const pending = record.pendingDispatch;
    if (!pending) {
      return record;
    }

    const sentAt = nowIso(this.dependencies.clock);
    const receipt = await this.dependencies.messenger.sendPostcard({
      personaId: record.personaId,
      dedupeKey: pending.dedupeKey,
      postcard: {
        ...pending.postcard,
        sentAt,
      },
    });

    await this.dependencies.hooks?.afterMessageSent?.(record, receipt);

    const deliveryArtifactId = randomUUID();
    const deliveryPath = await this.dependencies.artifactStore.writeJsonArtifact({
      tripId: record.tripId,
      artifactId: deliveryArtifactId,
      fileName: `${pending.stepId}-delivery.json`,
      value: receipt,
    });

    const advanced = advanceAfterCurrentStep(record, this.dependencies.clock.now());
    const nextRecord: TripRecord = {
      ...record,
      state: {
        ...advanced.state,
        artifacts: [
          ...record.state.artifacts,
          {
            artifactId: deliveryArtifactId,
            kind: "delivery",
            phase: pending.phase,
            path: deliveryPath,
            day: pending.day,
            createdAt: sentAt,
          },
        ],
      },
      timelineIndex: advanced.timelineIndex,
      pendingDispatch: null,
      updatedAt: sentAt,
      lastRunId: runId,
    };

    await this.dependencies.tripRepository.save(nextRecord);
    await this.log({
      tripId: record.tripId,
      runId,
      phase: pending.phase,
      event: "postcard.sent",
      decision: receipt.deduped
        ? "Delivery was deduplicated by host messenger."
        : "Delivered postcard to host messenger.",
      provider: receipt.provider,
      status: "success",
      startedAt,
      finishedAt: sentAt,
      details: {
        dedupeKey: pending.dedupeKey,
        messageId: receipt.messageId,
        shotKind: pending.shotKind,
      },
    });

    if (nextRecord.state.nextRunAt) {
      await this.dependencies.scheduler.scheduleTripTick({
        tripId: nextRecord.tripId,
        runAt: nextRecord.state.nextRunAt,
      });
    }

    return nextRecord;
  }

  private async advanceSilently(
    record: TripRecord,
    runId: string,
    startedAt: string,
  ): Promise<TripRecord> {
    const step = getCurrentStep(record);
    if (!step) {
      return record;
    }

    const advanced = advanceAfterCurrentStep(record, this.dependencies.clock.now());
    const updated: TripRecord = {
      ...record,
      state: advanced.state,
      timelineIndex: advanced.timelineIndex,
      updatedAt: nowIso(this.dependencies.clock),
      lastRunId: runId,
    };

    await this.dependencies.tripRepository.save(updated);
    await this.log({
      tripId: record.tripId,
      runId,
      phase: step.phase,
      event: "state.advanced",
      decision: "Advanced through a silent phase without sending a postcard.",
      provider: "service",
      status: "success",
      startedAt,
      finishedAt: nowIso(this.dependencies.clock),
      details: { nextPhase: updated.state.currentPhase },
    });

    if (updated.state.nextRunAt) {
      await this.dependencies.scheduler.scheduleTripTick({
        tripId: updated.tripId,
        runAt: updated.state.nextRunAt,
      });
    }

    return updated;
  }

  private async requirePersona(personaId: string): Promise<StoredPersonaProfile> {
    const persona = await this.dependencies.personaRepository.getById(personaId);
    if (!persona) {
      throw new Error(`Persona not found: ${personaId}`);
    }
    return persona;
  }

  private async requireTrip(tripId: string): Promise<TripRecord> {
    const record = await this.dependencies.tripRepository.getById(tripId);
    if (!record) {
      throw new Error(`Trip not found: ${tripId}`);
    }
    return record;
  }

  private async log(input: Omit<LogEntry, "latencyMs">): Promise<void> {
    const entry: LogEntry = {
      ...input,
      latencyMs: elapsedMs(input.startedAt, input.finishedAt),
    };
    await this.dependencies.logger.log(entry);
  }

  private async logFailure(input: {
    tripId: string;
    runId: string;
    phase: TripPhase | "system";
    event: string;
    decision: string;
    provider: string;
    startedAt: string;
    error: unknown;
  }): Promise<void> {
    const finishedAt = nowIso(this.dependencies.clock);
    await this.log({
      tripId: input.tripId,
      runId: input.runId,
      phase: input.phase,
      event: input.event,
      decision: input.decision,
      provider: input.provider,
      status: "failure",
      startedAt: input.startedAt,
      finishedAt,
      errorCode: errorCode(input.error),
      details: {
        message: errorMessage(input.error),
      },
    });
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name;
  }
  return "UnknownError";
}
