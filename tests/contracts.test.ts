import { describe, expect, it } from "vitest";

import {
  extractLikelyJson,
  parseModelJson,
  phaseGroundingSchema,
  tripPlanSchema,
} from "../src/contracts/schemas.js";

describe("Gemini contracts", () => {
  it("parses a valid trip plan JSON payload", () => {
    const raw = JSON.stringify({
      tripId: "trip-1",
      days: 3,
      transport: {
        summary: "Flight",
        departure: "HKG",
        arrival: "NRT",
      },
      hotel: {
        name: "Tokyo Central",
        district: "Asakusa",
      },
      dailyAgenda: [
        {
          day: 1,
          dateLabel: "Day 1",
          headline: "Arrival",
          morning: ["Airport train"],
          afternoon: ["Check in"],
          evening: ["Dinner"],
          notes: "Light day",
        },
        {
          day: 2,
          dateLabel: "Day 2",
          headline: "Museums",
          morning: ["Coffee"],
          afternoon: ["Museum"],
          evening: ["River walk"],
          notes: "Slow day",
        },
        {
          day: 3,
          dateLabel: "Day 3",
          headline: "Return",
          morning: ["Breakfast"],
          afternoon: ["Station"],
          evening: ["Flight"],
          notes: "Travel home",
        },
      ],
      groundingSources: [{ title: "Official tourism", uri: "https://example.com" }],
      weatherSummary: "Mild",
      recommendedPostingMoments: [
        "planning",
        "departing",
        "arrival_checkin",
        "day_exploration",
      ],
    });

    const parsed = parseModelJson(raw, tripPlanSchema, "trip plan");
    expect(parsed.days).toBe(3);
  });

  it("rejects invalid JSON contracts", () => {
    expect(() =>
      parseModelJson('{"tripId":"x"}', tripPlanSchema, "trip plan"),
    ).toThrow(/failed schema validation/i);
  });

  it("extracts JSON from fenced code blocks", () => {
    expect(extractLikelyJson("```json\n{\"ok\":true}\n```")).toBe('{"ok":true}');
  });

  it("rejects incomplete grounding payloads", () => {
    expect(() =>
      parseModelJson(
        JSON.stringify({
          phase: "planning",
          day: 0,
        }),
        phaseGroundingSchema,
        "phase grounding",
      ),
    ).toThrow(/failed schema validation/i);
  });
});
