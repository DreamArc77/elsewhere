import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GeminiRestGroundingAdapter } from "../src/infrastructure/gemini-rest-adapters.js";
import { buildFixtureTripPlan } from "../src/testing/fakes.js";
import { createTestRuntime } from "./helpers/runtime.js";

describe("structured logging", () => {
  it("writes required JSONL fields for trip creation and postcard delivery", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Aki",
      traits: ["observant"],
      relationship: "travel soulmate",
      toneStyle: "soft",
      referenceImageAsset: runtime.referenceImagePath,
    });

    const trip = await runtime.service.startTrip({
      personaId: persona.personaId,
      originCity: "Hong Kong",
      destinationCity: "Tokyo",
    });
    await runtime.service.runTrip(trip.tripId);

    const logPath = join(runtime.paths.logsDir, "2026-04-09.jsonl");
    const content = await readFile(logPath, "utf8");
    const entries = content
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(entries.length).toBeGreaterThanOrEqual(4);
    for (const entry of entries) {
      expect(entry.tripId).toBeTypeOf("string");
      expect(entry.runId).toBeTypeOf("string");
      expect(entry.phase).toBeDefined();
      expect(entry.event).toBeTypeOf("string");
      expect(entry.decision).toBeTypeOf("string");
      expect(entry.startedAt).toBeTypeOf("string");
      expect(entry.finishedAt).toBeTypeOf("string");
      expect(entry.status).toBeDefined();
      expect(entry.provider).toBeTypeOf("string");
      expect(entry.latencyMs).toBeTypeOf("number");
    }

    const imageEntry = entries.find((entry) => entry.event === "image.generated");
    expect(imageEntry?.details).toMatchObject({
      shotKind: expect.stringMatching(/^(selfie|snapshot)$/),
    });
  });

  it("logs planning request attempts and retries", async () => {
    const entries: Array<Record<string, unknown>> = [];
    const plan = buildFixtureTripPlan({
      tripId: "trip-logging",
      originCity: "Hong Kong",
      destinationCity: "Ho Chi Minh City",
      days: 4,
    });
    let callCount = 0;
    const adapter = new GeminiRestGroundingAdapter({
      apiKey: "test-key",
      logger: {
        log(entry) {
          entries.push(entry as unknown as Record<string, unknown>);
        },
      },
      fetchImpl: async () => {
        callCount += 1;
        if (callCount === 1) {
          return new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: "{ not-json" }] } }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify(plan) }],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const result = await adapter.planTrip({
      tripId: "trip-logging",
      persona: {
        personaId: "persona-1",
        createdAt: "2026-04-09T00:00:00.000Z",
        name: "Mori",
        traits: ["gentle"],
        relationship: "travel soulmate",
        toneStyle: "warm",
        referenceImageAsset: "/tmp/reference.png",
      },
      request: {
        personaId: "persona-1",
        originCity: "Hong Kong",
        destinationCity: "Ho Chi Minh City",
      },
    });

    expect(result.metadata.destination).toContain("Ho Chi Minh City");
    expect(entries.map((entry) => entry.event)).toEqual(
      expect.arrayContaining([
        "plan.request.started",
        "plan.request.retry",
        "plan.request.finished",
        "plan.parse.finished",
      ]),
    );
  });
});
