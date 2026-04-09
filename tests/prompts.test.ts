import { describe, expect, it } from "vitest";
import type { PhaseGroundingResult, TripPlan } from "../src/domain/types.js";

import {
  renderCaptionPrompt,
  renderImageGenerationPrompt,
  renderPhaseGroundingPrompt,
  renderTripPlanPrompt,
} from "../src/prompting/travel-companion-prompts.js";

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

const plan: TripPlan = {
  tripId: "trip-1",
  days: 3,
  transport: {
    summary: "Morning flight",
    departure: "HKG",
    arrival: "NRT",
  },
  hotel: {
    name: "Tokyo Central Hotel",
    district: "Shinjuku",
  },
  dailyAgenda: [
    {
      day: 1,
      dateLabel: "Day 1",
      headline: "Arrival day",
      morning: ["flight"],
      afternoon: ["check-in"],
      evening: ["walk"],
      notes: "take it slow",
    },
  ],
  groundingSources: [{ title: "Example", uri: "https://example.com" }],
  weatherSummary: "Warm and breezy",
  recommendedPostingMoments: [
    "planning",
    "departing",
    "arrival_checkin",
    "day_exploration",
    "returning",
    "home_reflection",
  ],
};

const grounding: PhaseGroundingResult = {
  phase: "day_exploration",
  day: 1,
  locality: "Asakusa",
  weatherSummary: "Sunny with light wind",
  transitSummary: "Short subway ride",
  venueSummary: "Temple street and nearby cafe",
  photoBrief: "Mirror selfie near a lantern-lined alley",
  sensoryHighlights: ["incense", "crowd chatter"],
  groundingSources: [{ title: "Guide", uri: "https://example.com/guide" }],
};

describe("travel companion prompts", () => {
  it("renders all editable templates without unresolved placeholders", async () => {
    const prompts = await Promise.all([
      renderTripPlanPrompt({ tripId: "trip-1", persona, request }),
      renderPhaseGroundingPrompt({
        tripId: "trip-1",
        persona,
        request,
        plan,
        phase: "day_exploration",
        day: 1,
        agenda: plan.dailyAgenda[0],
      }),
      renderCaptionPrompt({
        persona,
        request,
        phase: "day_exploration",
        day: 1,
        grounding,
      }),
      renderImageGenerationPrompt({
        persona,
        request,
        plan,
        grounding,
      }),
    ]);

    for (const prompt of prompts) {
      expect(prompt).not.toContain("{{");
      expect(prompt.length).toBeGreaterThan(40);
    }
  });
});
