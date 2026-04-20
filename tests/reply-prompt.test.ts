import { describe, expect, it } from "vitest";

import {
  renderCompanionReplyPrompt,
  renderDestinationAcknowledgementPrompt,
} from "../src/prompting/travel-companion-prompts.js";

const persona = {
  personaId: "persona-1",
  createdAt: "2026-04-09T00:00:00.000Z",
  name: "Mori",
  homeCity: "Hong Kong",
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
      recentPhotoBlock:
        'Recent photo you sent (hidden context only, do not quote verbatim):\n{"available":true,"imageSummary":{"scene":"car interior","otherPeopleVisible":"blurred_background_only"}}',
      currentSituation: "当前阶段：before_departure\n当前地点：自己的房间中",
      destinationLoopBlock: "",
      destinationLoopTaskBlock: "",
      currentTransportBlock:
        'Current transport details:\n{"relevant":true,"identifier":"MU5478","departure":{"time":"09:15"}}',
      now: "2026-04-14T08:00:00.000Z",
      latestUserMessageAt: "2026-04-14T07:58:00.000Z",
    });

    expect(prompt).toContain("当前情况：");
    expect(prompt).toContain("Current transport details:");
    expect(prompt).toContain('"identifier":"MU5478"');
    expect(prompt).toContain('"time":"09:15"');
    expect(prompt).toContain(
      "Recent photo you sent (hidden context only, do not quote verbatim):",
    );
    expect(prompt).toContain('"scene":"car interior"');
    expect(prompt).not.toContain("Conversation key:");
    expect(prompt).not.toContain("Active trip snapshot:");
    expect(prompt).not.toContain("checking tickets/routes");
    expect(prompt).not.toContain("not packing");
  });

  it("keeps the destination acknowledgement rules in a dedicated prompt", async () => {
    const prompt = await renderDestinationAcknowledgementPrompt({
      persona,
      destination: "Tokyo",
      recentTurns: "[]",
      now: "2026-04-14T08:00:00.000Z",
    });

    expect(prompt).toContain("Destination:");
    expect(prompt).toContain("Tokyo");
    expect(prompt).toContain("checking tickets/routes");
    expect(prompt).toContain("Do not say you are packing");
  });
});
