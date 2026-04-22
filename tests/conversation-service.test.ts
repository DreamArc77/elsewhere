import { describe, expect, it } from "vitest";

import { createTestRuntime } from "./helpers/runtime.js";
import { bindingKey } from "../src/openclaw-plugin/binding-state.js";

describe("conversation service", () => {
  it("immediately dispatches a destination acknowledgement when idle destination input is due now", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Osaka",
      traits: ["gentle"],
      relationship: "travel soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });
    const key = bindingKey({
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
    });
    await runtime.bindings.upsert({
      bindingId: "binding-1",
      key,
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
      boundAt: Date.now(),
      bindingSource: "local",
      mode: "companion-exclusive",
      defaultPersonaId: persona.personaId,
    });
    await runtime.conversationService.enterIdleAwaitingDestination({
      binding: (await runtime.bindings.get(key))!,
      sendGuideNow: true,
      clearConversationContext: true,
      reason: "activate",
    });

    runtime.grounding.composeCompanionReply = async () => ({
      segments: ["old idle reply"],
      provider: "fake-grounding",
      destinationIntent: {
        outcome: "start_trip",
        destination: "Seoul",
      },
    });

    const state = await runtime.conversationService.claimInboundMessage({
      binding: (await runtime.bindings.get(key))!,
      messageId: "msg-seoul",
      content: "首尔",
      senderId: "1459473177",
    });

    expect(runtime.messenger.sentReplies).toHaveLength(2);
    expect(runtime.messenger.sentReplies.at(-1)?.text).toBe(
      "Mori will plan Seoul before leaving.",
    );
    expect(state.pendingReplyDispatch).toBeNull();
    expect(state.pendingUserMessages).toHaveLength(0);
    expect(state.awaitingDestination).toBe(false);

    const updatedBinding = await runtime.bindings.get(key);
    expect(updatedBinding?.lastTripId).toBeTruthy();
    const trip = await runtime.tripRepository.getById(updatedBinding!.lastTripId!);
    expect(trip?.request.destinationCity).toBe("Seoul");
  });

  it("uses a destination acknowledgement fallback instead of the old idle reply when ack generation fails", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Osaka",
      traits: ["gentle"],
      relationship: "travel soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });
    const key = bindingKey({
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
    });
    await runtime.bindings.upsert({
      bindingId: "binding-1",
      key,
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
      boundAt: Date.now(),
      bindingSource: "local",
      mode: "companion-exclusive",
      defaultPersonaId: persona.personaId,
    });
    await runtime.conversationService.enterIdleAwaitingDestination({
      binding: (await runtime.bindings.get(key))!,
      sendGuideNow: false,
      clearConversationContext: true,
      reason: "activate",
    });

    runtime.grounding.composeCompanionReply = async () => ({
      segments: ["old idle reply"],
      provider: "fake-grounding",
      destinationIntent: {
        outcome: "start_trip",
        destination: "Paris",
      },
    });
    runtime.grounding.composeDestinationAcknowledgement = async () => {
      throw new Error("empty ack");
    };

    await runtime.conversationService.claimInboundMessage({
      binding: (await runtime.bindings.get(key))!,
      messageId: "msg-paris",
      content: "巴黎",
      senderId: "1459473177",
    });
    const state = await runtime.conversationService.runConversation(key, {
      ignoreSchedule: true,
    });

    expect(runtime.messenger.sentReplies).toHaveLength(1);
    expect(runtime.messenger.sentReplies[0]?.text).toBe(
      "知道了，我先把去Paris的路线和安排整理一下。",
    );
    expect(runtime.messenger.sentReplies[0]?.text).not.toContain("old idle reply");
    expect(state.pendingReplyDispatch).toBeNull();
    expect(state.awaitingDestination).toBe(false);
  });
});
