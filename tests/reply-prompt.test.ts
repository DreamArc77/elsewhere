import { describe, expect, it } from "vitest";

import { renderCompanionReplyPrompt } from "../src/prompting/travel-companion-prompts.js";

const persona = {
  personaId: "persona-1",
  createdAt: "2026-04-09T00:00:00.000Z",
  name: "Mori",
  traits: ["gentle", "curious"],
  relationship: "soulmate",
  toneStyle: "warm",
  referenceImageAsset: "/tmp/reference.png",
};

describe("reply prompt", () => {
  it("includes current transport details and the recent photo context when provided", async () => {
    const prompt = await renderCompanionReplyPrompt({
      persona,
      conversationKey: "telegram::1::1::main",
      pendingUserMessages: "[]",
      recentTurns: "[]",
      recentPhotoContext:
        '{"available":true,"imageSummary":{"scene":"car interior","otherPeopleVisible":"blurred_background_only"}}',
      activeTripSummary: '{"tripId":"trip-1"}',
      currentStateSummary: '{"substate":"before_departure"}',
      currentStateGrounding: '{"location":"自己的房间中"}',
      currentTransportDetails:
        '{"relevant":true,"identifier":"MU5478","departure":{"time":"09:15"}}',
      now: "2026-04-14T08:00:00.000Z",
      latestUserMessageAt: "2026-04-14T07:58:00.000Z",
    });

    expect(prompt).toContain("Current transport details:");
    expect(prompt).toContain('"identifier":"MU5478"');
    expect(prompt).toContain('"time":"09:15"');
    expect(prompt).toContain("Recent photo you sent:");
    expect(prompt).toContain('"scene":"car interior"');
  });
});
