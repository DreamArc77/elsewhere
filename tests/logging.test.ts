import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { GeminiRestGroundingAdapter } from "../src/infrastructure/gemini-rest-adapters.js";
import { JsonlFileLogger } from "../src/infrastructure/jsonl-file-logger.js";
import { buildFixtureTripPlan } from "../src/testing/fakes.js";
import { createTestRuntime } from "./helpers/runtime.js";

describe("structured logging", () => {
  it("writes required JSONL fields for trip creation and postcard delivery", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Aki",
      homeCity: "Hong Kong",
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
        homeCity: "Hong Kong",
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
        "plan.prompt.rendered",
        "plan.request.started",
        "plan.request.retry",
        "plan.request.finished",
        "plan.parse.finished",
      ]),
    );
    const promptEntry = entries.find(
      (entry) => entry.event === "plan.prompt.rendered",
    );
    const finishedEntry = entries.find(
      (entry) => entry.event === "plan.request.finished",
    );
    const retryEntry = entries.find((entry) => entry.event === "plan.request.retry");
    expect(promptEntry?.details).toMatchObject({
      promptLength: expect.any(Number),
      renderedPrompt: expect.any(String),
    });
    expect(finishedEntry?.details).toMatchObject({
      responseTextLength: expect.any(Number),
      responseTextPreviewHead: expect.any(String),
      responseTextPreviewTail: expect.any(String),
      responseTextLooksJsonComplete: expect.any(Boolean),
    });
    expect(retryEntry?.details).toMatchObject({
      responseTextLength: expect.any(Number),
      responseTextPreviewHead: expect.any(String),
      responseTextPreviewTail: expect.any(String),
      responseTextLooksJsonComplete: expect.any(Boolean),
    });
  });

  it("redacts rendered prompts and raw previews in safe log mode", async () => {
    const logsDir = await mkdtemp(join(tmpdir(), "travel-log-safe-"));
    const logger = new JsonlFileLogger(logsDir, "safe");

    await logger.log({
      tripId: "trip-safe",
      runId: "run-safe",
      phase: "planning",
      event: "plan.prompt.rendered",
      decision: "test",
      provider: "gemini",
      status: "success",
      startedAt: "2026-04-09T00:00:00.000Z",
      finishedAt: "2026-04-09T00:00:00.000Z",
      latencyMs: 0,
      details: {
        promptLength: 123,
        renderedPrompt: "FULL PROMPT",
        responseTextPreviewHead: "HEAD",
        responseTextPreviewTail: "TAIL",
      },
    });

    const content = await readFile(join(logsDir, "2026-04-09.jsonl"), "utf8");
    const entry = JSON.parse(content.trim()) as { details: Record<string, unknown> };
    expect(entry.details.promptLength).toBe(123);
    expect(entry.details.renderedPrompt).toBeUndefined();
    expect(entry.details.responseTextPreviewHead).toBeUndefined();
    expect(entry.details.responseTextPreviewTail).toBeUndefined();
    expect(entry.details.redacted).toBe(true);
  });

  it("keeps rendered prompts in debug log mode", async () => {
    const logsDir = await mkdtemp(join(tmpdir(), "travel-log-debug-"));
    const logger = new JsonlFileLogger(logsDir, "debug");

    await logger.log({
      tripId: "trip-debug",
      runId: "run-debug",
      phase: "planning",
      event: "plan.prompt.rendered",
      decision: "test",
      provider: "gemini",
      status: "success",
      startedAt: "2026-04-09T00:00:00.000Z",
      finishedAt: "2026-04-09T00:00:00.000Z",
      latencyMs: 0,
      details: {
        promptLength: 123,
        renderedPrompt: "FULL PROMPT",
      },
    });

    const content = await readFile(join(logsDir, "2026-04-09.jsonl"), "utf8");
    const entry = JSON.parse(content.trim()) as { details: Record<string, unknown> };
    expect(entry.details.renderedPrompt).toBe("FULL PROMPT");
    expect(entry.details.redacted).toBeUndefined();
  });
});
