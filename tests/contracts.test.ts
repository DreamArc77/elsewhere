import { describe, expect, it } from "vitest";

import {
  extractLikelyJson,
  parseModelJson,
  tripPlanSchema,
} from "../src/contracts/schemas.js";
import { buildFixtureTripPlan } from "../src/testing/fakes.js";

describe("Gemini contracts", () => {
  it("parses a valid itinerary-shaped trip plan JSON payload", () => {
    const raw = JSON.stringify(
      buildFixtureTripPlan({
        tripId: "trip-1",
        originCity: "Hong Kong",
        destinationCity: "Tokyo",
        days: 3,
      }),
    );

    const parsed = parseModelJson(raw, tripPlanSchema, "trip plan");
    expect(parsed.metadata.days).toBe(3);
    expect(parsed.daily_itinerary).toHaveLength(3);
    expect(parsed.daily_itinerary[1]?.activities.at(-1)?.type).toBe(
      "accommodation",
    );
  });

  it("rejects invalid JSON contracts", () => {
    expect(() =>
      parseModelJson('{"tripId":"x"}', tripPlanSchema, "trip plan"),
    ).toThrow(/failed schema validation/i);
  });

  it("rejects transport timestamps that include full dates", () => {
    const plan = buildFixtureTripPlan({
      tripId: "trip-1",
      originCity: "Hong Kong",
      destinationCity: "Tokyo",
      days: 3,
    });
    plan.transportation.departure.departure.time = "2026-04-20 08:30";

    expect(() =>
      parseModelJson(JSON.stringify(plan), tripPlanSchema, "trip plan"),
    ).toThrow(/failed schema validation/i);
  });

  it("extracts JSON from fenced code blocks", () => {
    expect(extractLikelyJson("```json\n{\"ok\":true}\n```")).toBe('{"ok":true}');
  });
});
