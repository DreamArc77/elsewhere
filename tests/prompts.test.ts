import { describe, expect, it } from "vitest";
import type {
  PhaseGroundingResult,
  RuntimeStepContext,
  TripPlan,
} from "../src/domain/types.js";

import { deriveImageIntent } from "../src/domain/image-intent.js";
import { buildTimeline } from "../src/domain/state-machine.js";
import {
  renderCaptionPrompt,
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

    expect(prompts[1]).toContain("你刚刚拍了一张照片");
    expect(prompts[1]).toContain(selfieImagePrompt);
    expect(prompts[2]).toContain("参考图中的人物");
    expect(prompts[2]).toContain(selfieIntent.currentTimeLocal);
    expect(prompts[3]).toContain("没有主体人物");
    expect(prompts[3]).toContain(snapshotIntent.activityDescription);
  });
});
