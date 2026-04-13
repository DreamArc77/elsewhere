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
});
