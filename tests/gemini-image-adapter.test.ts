import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { deriveImageIntent } from "../src/domain/image-intent.js";
import { buildDerivedGrounding } from "../src/domain/step-grounding.js";
import { buildTimeline } from "../src/domain/state-machine.js";
import { GeminiRestImageAdapter } from "../src/infrastructure/gemini-rest-adapters.js";
import { buildFixtureTripPlan } from "../src/testing/fakes.js";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9mA0QAAAAASUVORK5CYII=";

async function createReferenceImage(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "openclaw-image-adapter-"));
  const referenceImageAsset = join(rootDir, "reference.png");
  await writeFile(referenceImageAsset, Buffer.from(tinyPngBase64, "base64"));
  return referenceImageAsset;
}

function makeFixture(referenceImageAsset: string) {
  const plan = buildFixtureTripPlan({
    tripId: "trip-adapter",
    originCity: "Hong Kong",
    destinationCity: "Tokyo",
    days: 3,
  });
  const timeline = buildTimeline(plan, new Date("2026-04-09T00:00:00.000Z"));
  const step = timeline.find((candidate) => candidate.context?.kind === "activity")!;
  const stepContext = step.context!;
  const grounding = buildDerivedGrounding({
    plan,
    phase: step.phase,
    day: step.day,
    stepContext,
  });

  return {
    plan,
    step,
    stepContext,
    grounding,
    persona: {
      personaId: "persona-1",
      createdAt: "2026-04-09T00:00:00.000Z",
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle", "curious"],
      relationship: "soulmate",
      toneStyle: "warm",
      referenceImageAsset,
    },
    request: {
      personaId: "persona-1",
      originCity: "Hong Kong",
      destinationCity: "Tokyo",
    },
  };
}

function makeImageResponse(): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: tinyPngBase64,
                  mimeType: "image/png",
                },
              },
            ],
          },
        },
      ],
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

function makeImageAndSummaryResponse(): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                text: '{"scene":"hotel room corner","otherPeopleVisible":"none","notableDetails":["desk lamp","rainy window"]}',
              },
              {
                inlineData: {
                  data: tinyPngBase64,
                  mimeType: "image/png",
                },
              },
            ],
          },
        },
      ],
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

function findIntent(kind: "selfie" | "snapshot", fixture: ReturnType<typeof makeFixture>) {
  for (let index = 0; index < 200; index += 1) {
    const intent = deriveImageIntent({
      tripId: `trip-${kind}-${index}`,
      stepId: fixture.step.stepId,
      plan: fixture.plan,
      stepContext: fixture.stepContext,
    });
    if (intent.shotKind === kind) {
      return intent;
    }
  }

  throw new Error(`Expected ${kind} fixture`);
}

describe("Gemini image adapter", () => {
  it("attaches the reference image for selfie shots", async () => {
    const referenceImageAsset = await createReferenceImage();
    const fixture = makeFixture(referenceImageAsset);
    const requestBodies: Array<Record<string, unknown>> = [];
    const adapter = new GeminiRestImageAdapter({
      apiKey: "test-key",
      fetchImpl: async (_url, init) => {
        requestBodies.push(JSON.parse(String(init?.body)));
        return makeImageResponse();
      },
    });

    const intent = findIntent("selfie", fixture);

    await adapter.generateImage({
      tripId: fixture.plan.tripId,
      persona: fixture.persona,
      request: fixture.request,
      plan: fixture.plan,
      phase: fixture.step.phase,
      day: fixture.step.day,
      stepContext: fixture.stepContext,
      grounding: fixture.grounding,
      shotKind: intent.shotKind,
      usesReferenceImage: intent.usesReferenceImage,
      prompt: "selfie prompt",
    });

    const parts = (((requestBodies[0]?.contents as Array<Record<string, unknown>>)?.[0]
      ?.parts as Array<Record<string, unknown>>) ?? []);
    expect(parts).toHaveLength(2);
    expect(parts[1]).toHaveProperty("inline_data");
  });

  it("omits the reference image for snapshot shots", async () => {
    const referenceImageAsset = await createReferenceImage();
    const fixture = makeFixture(referenceImageAsset);
    const requestBodies: Array<Record<string, unknown>> = [];
    const adapter = new GeminiRestImageAdapter({
      apiKey: "test-key",
      fetchImpl: async (_url, init) => {
        requestBodies.push(JSON.parse(String(init?.body)));
        return makeImageResponse();
      },
    });

    const intent = findIntent("snapshot", fixture);

    await adapter.generateImage({
      tripId: fixture.plan.tripId,
      persona: fixture.persona,
      request: fixture.request,
      plan: fixture.plan,
      phase: fixture.step.phase,
      day: fixture.step.day,
      stepContext: fixture.stepContext,
      grounding: fixture.grounding,
      shotKind: intent.shotKind,
      usesReferenceImage: intent.usesReferenceImage,
      prompt: "snapshot prompt",
    });

    const parts = (((requestBodies[0]?.contents as Array<Record<string, unknown>>)?.[0]
      ?.parts as Array<Record<string, unknown>>) ?? []);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveProperty("text");
  });

  it("extracts image summary text when the image model returns text and image together", async () => {
    const referenceImageAsset = await createReferenceImage();
    const fixture = makeFixture(referenceImageAsset);
    const adapter = new GeminiRestImageAdapter({
      apiKey: "test-key",
      fetchImpl: async () => makeImageAndSummaryResponse(),
    });

    const intent = findIntent("snapshot", fixture);

    const result = await adapter.generateImage({
      tripId: fixture.plan.tripId,
      persona: fixture.persona,
      request: fixture.request,
      plan: fixture.plan,
      phase: fixture.step.phase,
      day: fixture.step.day,
      stepContext: fixture.stepContext,
      grounding: fixture.grounding,
      shotKind: intent.shotKind,
      usesReferenceImage: intent.usesReferenceImage,
      prompt: "snapshot prompt",
    });

    expect(result.imageSummary).toContain('"scene":"hotel room corner"');
    expect(result.imageSummary).toContain('"otherPeopleVisible":"none"');
  });

  it("logs the rendered image prompt when a logger is provided", async () => {
    const referenceImageAsset = await createReferenceImage();
    const fixture = makeFixture(referenceImageAsset);
    const entries: Array<Record<string, unknown>> = [];
    const adapter = new GeminiRestImageAdapter({
      apiKey: "test-key",
      logger: {
        log(entry) {
          entries.push(entry as unknown as Record<string, unknown>);
        },
      },
      fetchImpl: async () => makeImageResponse(),
    });

    const intent = findIntent("snapshot", fixture);

    await adapter.generateImage({
      tripId: fixture.plan.tripId,
      persona: fixture.persona,
      request: fixture.request,
      plan: fixture.plan,
      phase: fixture.step.phase,
      day: fixture.step.day,
      stepContext: fixture.stepContext,
      grounding: fixture.grounding,
      shotKind: intent.shotKind,
      usesReferenceImage: intent.usesReferenceImage,
      prompt: "snapshot prompt",
    });

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "image.prompt.rendered",
          details: expect.objectContaining({
            renderedPrompt: "snapshot prompt",
            promptLength: "snapshot prompt".length,
          }),
        }),
      ]),
    );
  });
});
