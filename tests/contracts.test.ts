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

  it("rejects itinerary text that implies the user is traveling on-site", () => {
    const plan = buildFixtureTripPlan({
      tripId: "trip-2",
      originCity: "Hong Kong",
      destinationCity: "Tokyo",
      days: 3,
    });
    plan.daily_itinerary[0]!.activities[0]!.description =
      "和你一起落地以后去找酒店，然后牵着你的手去逛街。";

    expect(() =>
      parseModelJson(JSON.stringify(plan), tripPlanSchema, "trip plan"),
    ).toThrow(/must not imply the user is physically traveling together/i);
  });

  it("extracts JSON from fenced code blocks", () => {
    expect(extractLikelyJson("```json\n{\"ok\":true}\n```")).toBe('{"ok":true}');
  });
});
