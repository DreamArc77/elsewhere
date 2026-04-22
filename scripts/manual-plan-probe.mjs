import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { GeminiRestGroundingAdapter } from "../dist/src/infrastructure/gemini-rest-adapters.js";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("GEMINI_API_KEY is required.");
}

const adapter = new GeminiRestGroundingAdapter({ apiKey });
const tripId = randomUUID();

const result = await adapter.planTrip({
  tripId,
  persona: {
    personaId: "test-persona",
    createdAt: new Date().toISOString(),
    name: "小美",
    traits: ["黏人", "敏感", "恋人感"],
    relationship: "恋人",
    toneStyle: "亲密",
    referenceImageAsset: "C:/placeholder.png",
  },
  request: {
    personaId: "test-persona",
    originCity: "北京",
    destinationCity: "天津",
    startWindow: "2-day short trip, prefer the nearest realistic departure window.",
  },
});

const outputPath = new URL("../docs/plan-test-beijing-tianjin-live.json", import.meta.url);
await writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");

console.log(JSON.stringify({
  output: outputPath.pathname,
  destination: result.metadata.destination,
  days: result.metadata.days,
}, null, 2));
