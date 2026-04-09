import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  GeminiRestGroundingAdapter,
  GeminiRestImageAdapter,
} from "../src/infrastructure/gemini-rest-adapters.js";
import { deriveImageIntent } from "../src/domain/image-intent.js";
import { buildDerivedGrounding } from "../src/domain/step-grounding.js";
import { buildTimeline } from "../src/domain/state-machine.js";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9mA0QAAAAASUVORK5CYII=";

const liveEnabled =
  process.env.RUN_LIVE_GEMINI_SMOKE === "1" && Boolean(process.env.GEMINI_API_KEY);

describe.skipIf(!liveEnabled)("live Gemini smoke", () => {
  it("can generate one trip plan and one image", async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required");
    }

    const rootDir = await mkdtemp(join(tmpdir(), "openclaw-live-"));
    const referenceImageAsset = join(rootDir, "reference.png");
    await writeFile(referenceImageAsset, Buffer.from(tinyPngBase64, "base64"));

    const grounding = new GeminiRestGroundingAdapter({ apiKey });
    const image = new GeminiRestImageAdapter({ apiKey });
    const persona = {
      personaId: "persona-live",
      createdAt: new Date().toISOString(),
      name: "Aki",
      traits: ["gentle", "observant"],
      relationship: "travel soulmate",
      toneStyle: "soft",
      referenceImageAsset,
    };
    const request = {
      personaId: persona.personaId,
      originCity: "Tokyo",
      destinationCity: "New York",
    };

    const plan = await grounding.planTrip({
      tripId: "trip-live",
      persona,
      request,
    });
    expect(plan.metadata.days).toBeGreaterThanOrEqual(3);
    expect(plan.metadata.days).toBeLessThanOrEqual(5);

    const timeline = buildTimeline(plan, new Date());
    const planningStep = timeline[0];
    if (!planningStep?.context) {
      throw new Error("Planning step context is missing");
    }

    const phaseGrounding = buildDerivedGrounding({
      plan,
      phase: "planning",
      day: 0,
      stepContext: planningStep.context,
    });
    const imageIntent = deriveImageIntent({
      tripId: plan.tripId,
      stepId: planningStep.stepId,
      plan,
      stepContext: planningStep.context,
    });

    const imageResult = await image.generateImage({
      tripId: "trip-live",
      persona,
      request,
      plan,
      phase: "planning",
      day: 0,
      stepContext: planningStep.context,
      grounding: phaseGrounding,
      shotKind: imageIntent.shotKind,
      usesReferenceImage: imageIntent.usesReferenceImage,
      prompt: "Create a realistic airport departure selfie.",
    });

    expect(imageResult.bytesBase64.length).toBeGreaterThan(100);
  }, 120000);
});
