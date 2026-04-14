import { describe, expect, it } from "vitest";
import type {
  PhaseGroundingResult,
  RuntimeStepContext,
  TripPlan,
  TripRecord,
} from "../src/domain/types.js";

import { resolveAgentStateForTimelineStep } from "../src/domain/business-situation.js";
import { deriveImageIntent } from "../src/domain/image-intent.js";
import { buildTimeline } from "../src/domain/state-machine.js";
import {
  renderCaptionPrompt,
  renderCompanionReplyPrompt,
  renderImageGenerationPrompt,
  renderTripPlanPrompt,
} from "../src/prompting/travel-companion-prompts.js";
import { buildFixtureTripPlan } from "../src/testing/fakes.js";

const persona = {
  personaId: "persona-1",
  createdAt: "2026-04-09T00:00:00.000Z",
  name: "Mori",
  traits: ["gentle", "curious"],
  relationship: "soulmate",
  toneStyle: "warm",
  referenceImageAsset: "/tmp/reference.png",
};

const request = {
  personaId: persona.personaId,
  originCity: "Hong Kong",
  destinationCity: "Tokyo",
  startWindow: "next weekend",
};

const plan: TripPlan = buildFixtureTripPlan({
  tripId: "trip-base",
  originCity: request.originCity,
  destinationCity: request.destinationCity,
  days: 3,
});

const timeline = buildTimeline(plan, new Date("2026-04-09T00:00:00.000Z"));
const step = timeline.find(
  (candidate) =>
    candidate.context?.kind === "activity" &&
    candidate.phase === "day_exploration",
)!;
const stepContext = step.context as RuntimeStepContext;

const record: TripRecord = {
  tripId: "trip-base",
  personaId: persona.personaId,
  request,
  plan,
  state: {
    status: "planned",
    currentPhase: "planning",
    currentDay: 0,
    nextRunAt: timeline[0]!.scheduledAt,
    pendingPostcard: null,
    artifacts: [],
    activeStateAnchor: null,
  },
  timeline,
  timelineIndex: 0,
  pendingDispatch: null,
  createdAt: "2026-04-09T00:00:00.000Z",
  updatedAt: "2026-04-09T00:00:00.000Z",
};

const resolvedState = resolveAgentStateForTimelineStep({
  record,
  step,
  persona,
});

const grounding: PhaseGroundingResult = {
  phase: "day_exploration",
  day: 2,
  locality: "Asakusa",
  weatherSummary: "Sunny with light wind",
  transitSummary: "Short subway ride",
  venueSummary: "Temple street and nearby cafe",
  photoBrief: "Mirror selfie near a lantern-lined alley",
  sensoryHighlights: ["incense", "crowd chatter"],
  groundingSources: [{ title: "Guide", uri: "https://example.com/guide" }],
};

function findImageIntent(kind: "selfie" | "snapshot") {
  for (let index = 0; index < 200; index += 1) {
    const intent = deriveImageIntent({
      tripId: `trip-${kind}-${index}`,
      stepId: step.stepId,
      plan,
      stepContext,
    });
    if (intent.shotKind === kind) {
      return intent;
    }
  }

  throw new Error(`Could not find ${kind} image intent fixture`);
}

describe("travel companion prompts", () => {
  it("renders all editable templates without unresolved placeholders", async () => {
    const selfieIntent = findImageIntent("selfie");
    const snapshotIntent = findImageIntent("snapshot");
    const selfieImagePrompt = await renderImageGenerationPrompt({
      persona,
      request,
      plan,
      stepContext,
      grounding,
      imageIntent: selfieIntent,
    });

    const prompts = await Promise.all([
      renderTripPlanPrompt({ tripId: "trip-1", persona, request }),
      renderCaptionPrompt({
        persona,
        request,
        phase: "day_exploration",
        day: stepContext.day,
        stepContext,
        grounding,
        resolvedState,
        currentStateSummary: JSON.stringify(
          {
            stage: resolvedState.stage,
            state: resolvedState.state,
          },
          null,
          2,
        ),
        currentStateGrounding: JSON.stringify(
          {
            currentActivity: resolvedState.state.currentActivity,
            previousActivity: resolvedState.state.previousActivity,
            nextActivity: resolvedState.state.nextActivity,
          },
          null,
          2,
        ),
        imagePrompt: selfieImagePrompt,
      }),
      Promise.resolve(selfieImagePrompt),
      renderImageGenerationPrompt({
        persona,
        request,
        plan,
        stepContext,
        grounding,
        imageIntent: snapshotIntent,
      }),
    ]);

    for (const prompt of prompts) {
      expect(prompt).not.toContain("{{");
      expect(prompt.length).toBeGreaterThan(40);
    }

    expect(prompts[0]).toContain(request.originCity);
    expect(prompts[0]).toContain(request.destinationCity);
    expect(prompts[0]).toContain(persona.name);

    expect(prompts[1]).toContain(request.destinationCity);
    expect(prompts[1]).toContain(selfieImagePrompt);
    expect(prompts[1]).toContain("当前中心状态摘要");
    expect(prompts[1]).toContain("当前中心状态 grounding");
    expect(prompts[1]).toContain("不要把旅行写成“去找用户”");

    expect(prompts[2]).toContain("reference image");
    expect(prompts[2]).toContain("Do not include any companion");
    expect(prompts[2]).toContain(selfieIntent.currentTimeLocal);
    expect(prompts[2]).toContain(selfieIntent.destinationWithLocation);

    expect(prompts[3]).toContain(snapshotIntent.currentTimeLocal);
    expect(prompts[3]).toContain(snapshotIntent.destinationWithLocation);
    expect(prompts[3]).toContain(snapshotIntent.activityDescription);
  });

  it("renders companion reply prompt with state grounding and latest user message time", async () => {
    const prompt = await renderCompanionReplyPrompt({
      persona,
      conversationKey: "telegram::1::1::main",
      pendingUserMessages: JSON.stringify(
        [
          {
            messageId: "msg-1",
            content: "你现在在哪",
            receivedAt: "2026-04-13T10:15:00.000Z",
          },
        ],
        null,
        2,
      ),
      recentTurns: JSON.stringify(
        [
          {
            role: "companion",
            text: "刚落地。",
            createdAt: "2026-04-13T10:10:00.000Z",
          },
        ],
        null,
        2,
      ),
      activeTripSummary: JSON.stringify(
        {
          tripId: "trip-1",
          destination: "Tokyo",
          phase: "day_exploration",
        },
        null,
        2,
      ),
      currentStateSummary: JSON.stringify(
        {
          stage: {
            substate: "food",
          },
          state: {
            presence: "available",
          },
        },
        null,
        2,
      ),
      currentStateGrounding: JSON.stringify(
        {
          weatherForecast: "22C, light rain",
          currentActivity: {
            location: "成桂西餐厅",
            description: "正在吃午饭。",
          },
        },
        null,
        2,
      ),
      now: "2026-04-13T10:18:00.000Z",
      latestUserMessageAt: "2026-04-13T10:15:00.000Z",
    });

    expect(prompt).toContain("Current companion state:");
    expect(prompt).toContain('"substate": "food"');
    expect(prompt).toContain("You are traveling alone.");
    expect(prompt).toContain("Do not describe the trip as moving toward the user");
    expect(prompt).toContain("Current state grounding:");
    expect(prompt).toContain("成桂西餐厅");
    expect(prompt).toContain("Latest pending user message time:");
    expect(prompt).toContain("2026-04-13T10:15:00.000Z");
  });
});
