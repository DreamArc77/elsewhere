import {
  TimelineStep,
  TripPhase,
  TripPlan,
  TripRecord,
  TripState,
  publicPostcardPhases,
} from "./types.js";

function stepId(phase: TripPhase, day: number): string {
  return `${phase}:${day}`;
}

function stepDelayHours(phase: TripPhase, day: number, totalDays: number): number {
  switch (phase) {
    case "planning":
      return 4;
    case "packing":
      return 12;
    case "departing":
      return 6;
    case "in_transit":
      return 4;
    case "arrival_checkin":
      return 14;
    case "day_exploration":
      return day >= totalDays ? 18 : 24;
    case "returning":
      return 12;
    case "home_reflection":
      return 0;
  }
}

export function buildTimeline(plan: TripPlan): TimelineStep[] {
  const steps: TimelineStep[] = [
    {
      stepId: stepId("planning", 0),
      phase: "planning",
      day: 0,
      emitsPostcard: true,
      delayHours: stepDelayHours("planning", 0, plan.days),
    },
    {
      stepId: stepId("packing", 0),
      phase: "packing",
      day: 0,
      emitsPostcard: false,
      delayHours: stepDelayHours("packing", 0, plan.days),
    },
    {
      stepId: stepId("departing", 0),
      phase: "departing",
      day: 0,
      emitsPostcard: true,
      delayHours: stepDelayHours("departing", 0, plan.days),
    },
    {
      stepId: stepId("in_transit", 0),
      phase: "in_transit",
      day: 0,
      emitsPostcard: false,
      delayHours: stepDelayHours("in_transit", 0, plan.days),
    },
    {
      stepId: stepId("arrival_checkin", 1),
      phase: "arrival_checkin",
      day: 1,
      emitsPostcard: true,
      delayHours: stepDelayHours("arrival_checkin", 1, plan.days),
    },
  ];

  for (let day = 1; day <= plan.days; day += 1) {
    steps.push({
      stepId: stepId("day_exploration", day),
      phase: "day_exploration",
      day,
      emitsPostcard: true,
      delayHours: stepDelayHours("day_exploration", day, plan.days),
    });
  }

  steps.push(
    {
      stepId: stepId("returning", 0),
      phase: "returning",
      day: plan.days,
      emitsPostcard: true,
      delayHours: stepDelayHours("returning", 0, plan.days),
    },
    {
      stepId: stepId("home_reflection", 0),
      phase: "home_reflection",
      day: plan.days,
      emitsPostcard: true,
      delayHours: stepDelayHours("home_reflection", 0, plan.days),
    },
  );

  return steps;
}

export function createInitialTripState(
  timeline: TimelineStep[],
  now: Date,
): TripState {
  const firstStep = timeline[0];
  if (!firstStep) {
    throw new Error("Timeline must contain at least one step.");
  }

  return {
    status: "planned",
    currentPhase: firstStep.phase,
    currentDay: firstStep.day,
    nextRunAt: now.toISOString(),
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
  return publicPostcardPhases.has(step.phase) && step.emitsPostcard;
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

  const nextRunAt = new Date(
    now.getTime() + current.delayHours * 60 * 60 * 1000,
  ).toISOString();

  return {
    state: {
      ...record.state,
      status: "active",
      currentPhase: nextStep.phase,
      currentDay: nextStep.day,
      nextRunAt,
      pendingPostcard: null,
    },
    timelineIndex: nextIndex,
  };
}
