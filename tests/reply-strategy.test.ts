import { describe, expect, it } from "vitest";

import { bindingKey } from "../src/openclaw-plugin/binding-state.js";
import { createTestRuntime } from "./helpers/runtime.js";

describe("reply seen strategy", () => {
  it("uses an idle seen window when there is no active trip", async () => {
    const runtime = await createTestRuntime();
    const key = bindingKey({
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
    });
    await runtime.bindings.upsert({
      key,
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
      boundAt: Date.now(),
      mode: "companion-exclusive",
    });
    await runtime.conversationService.activateConversation({
      key,
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
      boundAt: Date.now(),
      mode: "companion-exclusive",
    });

    const state = await runtime.conversationService.enqueueInboundMessage({
      binding: {
        key,
        channel: "telegram",
        accountId: "default",
        target: "1459473177",
        boundAt: Date.now(),
        mode: "companion-exclusive",
      },
      messageId: "msg-idle-1",
      content: "在吗",
    });

    const dueAt = new Date(state.pendingReplyDispatch!.dueAt).getTime();
    const now = runtime.clock.now().getTime();
    expect(dueAt).toBeGreaterThanOrEqual(now);
    expect(dueAt).toBeLessThanOrEqual(now + 10 * 60 * 1000);
    expect(state.pendingReplyDispatch?.instantSeen).toBe(false);
  });

  it("switches to instant seen inside a fresh reply hot window", async () => {
    const runtime = await createTestRuntime();
    const key = bindingKey({
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
    });
    await runtime.bindings.upsert({
      key,
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
      boundAt: Date.now(),
      mode: "companion-exclusive",
    });
    await runtime.conversationService.activateConversation({
      key,
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
      boundAt: Date.now(),
      mode: "companion-exclusive",
    });

    const existing = await runtime.conversationStateRepository.getByKey(key);
    await runtime.conversationStateRepository.save({
      ...existing!,
      lastCompanionReplyAt: runtime.clock.now().toISOString(),
      updatedAt: runtime.clock.now().toISOString(),
    });

    const state = await runtime.conversationService.enqueueInboundMessage({
      binding: {
        key,
        channel: "telegram",
        accountId: "default",
        target: "1459473177",
        boundAt: Date.now(),
        mode: "companion-exclusive",
      },
      messageId: "msg-hot-1",
      content: "秒回试试",
    });

    expect(state.pendingReplyDispatch?.instantSeen).toBe(true);
    expect(state.pendingReplyDispatch?.dueAt).toBe(runtime.clock.now().toISOString());
    expect(state.instantReplyWindow).not.toBeNull();
  });

  it("filters old-trip turns out of the reply context", async () => {
    const runtime = await createTestRuntime();
    const key = bindingKey({
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
    });
    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle"],
      relationship: "travel soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });
    const trip = await runtime.service.startTrip({
      personaId: persona.personaId,
      originCity: "Hong Kong",
      destinationCity: "Qingdao",
    });

    await runtime.bindings.upsert({
      key,
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
      boundAt: Date.now(),
      mode: "companion-exclusive",
      defaultPersonaId: persona.personaId,
      lastTripId: trip.tripId,
    });
    await runtime.conversationService.activateConversation({
      key,
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
      boundAt: Date.now(),
      mode: "companion-exclusive",
      defaultPersonaId: persona.personaId,
      lastTripId: trip.tripId,
    });

    const existing = await runtime.conversationStateRepository.getByKey(key);
    await runtime.conversationStateRepository.save({
      ...existing!,
      recentTurns: [
        {
          role: "companion",
          text: "old polluted turn",
          createdAt: "2026-04-01T00:00:00.000Z",
          tripId: "old-trip",
        },
      ],
      updatedAt: runtime.clock.now().toISOString(),
    });

    let capturedTurns: Array<{ text: string }> = [];
    runtime.grounding.composeCompanionReply = async (input) => {
      capturedTurns = input.recentTurns;
      return {
        segments: ["ok"],
        provider: "fake-grounding",
      };
    };

    await runtime.conversationService.enqueueInboundMessage({
      binding: {
        key,
        channel: "telegram",
        accountId: "default",
        target: "1459473177",
        boundAt: Date.now(),
        mode: "companion-exclusive",
        defaultPersonaId: persona.personaId,
        lastTripId: trip.tripId,
      },
      messageId: "msg-filter-1",
      content: "你现在在哪",
    });

    await runtime.conversationService.runConversation(key, { ignoreSchedule: true });

    expect(capturedTurns.map((turn) => turn.text)).not.toContain("old polluted turn");
  });

  it("starts a trip from a high-confidence idle destination intent", async () => {
    const runtime = await createTestRuntime();
    const key = bindingKey({
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
    });
    const persona = await runtime.service.createPersona({
      name: "Mori",
      originCity: "Hong Kong",
      traits: ["gentle"],
      relationship: "travel soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });

    await runtime.bindings.upsert({
      key,
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
      boundAt: Date.now(),
      mode: "companion-exclusive",
      defaultPersonaId: persona.personaId,
    });
    await runtime.conversationService.activateConversation({
      key,
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
      boundAt: Date.now(),
      mode: "companion-exclusive",
      defaultPersonaId: persona.personaId,
    });
    await runtime.conversationService.enterIdleAwaitingDestination({
      binding: {
        key,
        channel: "telegram",
        accountId: "default",
        target: "1459473177",
        boundAt: Date.now(),
        mode: "companion-exclusive",
        defaultPersonaId: persona.personaId,
      },
      sendGuideNow: false,
      reason: "activate",
    });

    runtime.grounding.composeCompanionReply = async () => ({
      segments: ["那这次去东京。"],
      destinationIntent: {
        outcome: "start_trip",
        destination: "Tokyo",
        confidence: "high",
      },
      provider: "fake-grounding",
    });

    await runtime.conversationService.enqueueInboundMessage({
      binding: {
        key,
        channel: "telegram",
        accountId: "default",
        target: "1459473177",
        boundAt: Date.now(),
        mode: "companion-exclusive",
        defaultPersonaId: persona.personaId,
      },
      messageId: "msg-idle-start",
      content: "那就东京吧",
    });

    await runtime.conversationService.runConversation(key, { ignoreSchedule: true });

    const binding = await runtime.bindings.get(key);
    expect(binding?.lastTripId).toBeTruthy();
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.awaitingDestination).toBe(false);
    expect(state?.pendingDestinationCandidate).toBeNull();
    expect(runtime.messenger.sentReplies.at(-1)?.text).toContain("东京");
  });

  it("sends the idle destination guide after the 12-hour cooldown", async () => {
    const runtime = await createTestRuntime();
    const key = bindingKey({
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
    });
    const persona = await runtime.service.createPersona({
      name: "Mori",
      originCity: "Hong Kong",
      traits: ["gentle"],
      relationship: "travel soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });

    const binding = {
      key,
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
      boundAt: Date.now(),
      mode: "companion-exclusive" as const,
      defaultPersonaId: persona.personaId,
    };
    await runtime.bindings.upsert(binding);
    await runtime.conversationService.activateConversation(binding);
    await runtime.conversationService.enterIdleAwaitingDestination({
      binding,
      sendGuideNow: false,
      reason: "activate",
    });

    runtime.clock.advanceHours(12);
    await runtime.conversationService.runDueIdleGuides();

    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.idleGuideSentAt).toBeTruthy();
    expect(runtime.messenger.sentReplies).toHaveLength(1);
  });
});
