import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

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
  });
});
