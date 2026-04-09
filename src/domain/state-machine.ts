import { TimelineStep, TripRecord, TripState } from "./types.js";

export { buildTimeline } from "./activity-plan.js";

export function createInitialTripState(
  timeline: TimelineStep[],
  _now: Date,
): TripState {
  const firstStep = timeline[0];
  if (!firstStep) {
    throw new Error("Timeline must contain at least one step.");
  }

  return {
    status: "planned",
    currentPhase: firstStep.phase,
    currentDay: firstStep.day,
    nextRunAt: firstStep.scheduledAt,
    pendingPostcard: null,
    artifacts: [],
  };
}

export function getCurrentStep(record: TripRecord): TimelineStep | null {
  return record.timeline[record.timelineIndex] ?? null;
}

export function isTripDue(record: TripRecord, now: Date): boolean {
  if (record.state.status === "completed" || !record.state.nextRunAt) {
    return false;
  }

  return new Date(record.state.nextRunAt).getTime() <= now.getTime();
}

export function isPostcardStep(step: TimelineStep): boolean {
  return step.emitsPostcard;
}

export function advanceAfterCurrentStep(
  record: TripRecord,
  now: Date,
): Pick<TripRecord, "state" | "timelineIndex"> {
  const current = getCurrentStep(record);
  if (!current) {
    return {
      state: {
        ...record.state,
        status: "completed",
        nextRunAt: null,
      },
      timelineIndex: record.timelineIndex,
    };
  }

  const nextIndex = record.timelineIndex + 1;
  const nextStep = record.timeline[nextIndex];

  if (!nextStep) {
    return {
      state: {
        ...record.state,
        status: "completed",
        currentPhase: current.phase,
        currentDay: current.day,
        nextRunAt: null,
        pendingPostcard: null,
      },
      timelineIndex: nextIndex,
    };
  }

  return {
    state: {
      ...record.state,
      status: "active",
      currentPhase: nextStep.phase,
      currentDay: nextStep.day,
      nextRunAt: nextStep.scheduledAt,
      pendingPostcard: null,
    },
    timelineIndex: nextIndex,
  };
}
