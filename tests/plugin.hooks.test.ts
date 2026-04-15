import { readdir, readFile, stat } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { handleTravelCompanionInboundClaim } from "../src/openclaw-plugin/hooks.js";
import { bindingKey } from "../src/openclaw-plugin/binding-state.js";
import { createTestRuntime } from "./helpers/runtime.js";

function createInboundDeps(
  runtime: Awaited<ReturnType<typeof createTestRuntime>>,
) {
  return {
    bindings: runtime.bindings,
    conversationService: runtime.conversationService,
    service: runtime.service,
    tripRepository: runtime.tripRepository,
    personaRepository: runtime.personaRepository,
    conversationStates: runtime.conversationStateRepository,
    globalConfigRepository: runtime.globalConfigRepository,
    messenger: runtime.messenger,
    pluginConfig: {
      geminiApiKey: "test-key",
      defaultOriginCity: "Hong Kong",
      pollIntervalSeconds: 60,
      openclawBinaryPath: "openclaw",
    },
    runtimeDataPaths: runtime.paths,
    logger: runtime.logger,
  };
}

describe("travel companion inbound takeover hook", () => {
  it("claims ordinary inbound messages in companion-exclusive conversations", async () => {
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

    const result = await handleTravelCompanionInboundClaim(
      {
        content: "hello",
        body: "hello",
        channel: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "msg-1",
        isGroup: false,
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "msg-1",
      },
      {
        ...createInboundDeps(runtime),
      },
    );

    expect(result).toEqual({ handled: true });
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.pendingUserMessages).toHaveLength(1);
    expect(state?.pendingUserMessages[0]?.content).toBe("hello");
  });

  it("claims inbound messages even when telegram target shapes differ", async () => {
    const runtime = await createTestRuntime();
    const key = bindingKey({
      channel: "telegram",
      accountId: "1459473177",
      target: "telegram:1459473177",
    });
    await runtime.bindings.upsert({
      key,
      channel: "telegram",
      accountId: "1459473177",
      target: "telegram:1459473177",
      boundAt: Date.now(),
      mode: "companion-exclusive",
    });
    await runtime.conversationService.activateConversation({
      key,
      channel: "telegram",
      accountId: "1459473177",
      target: "telegram:1459473177",
      boundAt: Date.now(),
      mode: "companion-exclusive",
    });

    const result = await handleTravelCompanionInboundClaim(
      {
        content: "where are you",
        body: "where are you",
        channel: "telegram",
        accountId: "1459473177",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "msg-route",
        isGroup: false,
      },
      {
        channelId: "telegram",
        accountId: "1459473177",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "msg-route",
      },
      {
        ...createInboundDeps(runtime),
      },
    );

    expect(result).toEqual({ handled: true });
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.pendingUserMessages).toHaveLength(1);
    expect(state?.pendingUserMessages[0]?.messageId).toBe("msg-route");
  });

  it("bridges travel-companion slash commands inside companion-exclusive conversations", async () => {
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

    const result = await handleTravelCompanionInboundClaim(
      {
        content: "/travel-companion status",
        body: "/travel-companion status",
        channel: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "msg-2",
        isGroup: false,
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "msg-2",
      },
      {
        ...createInboundDeps(runtime),
      },
    );

    expect(result).toEqual({ handled: true });
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.pendingUserMessages).toHaveLength(0);
    expect(runtime.messenger.sentReplies).toHaveLength(1);
    expect(runtime.messenger.sentReplies[0]?.text).toContain(
      "No recent trip is recorded for this conversation yet.",
    );

    const logFiles = await readdir(runtime.paths.logsDir);
    const payload = (
      await Promise.all(
        logFiles.map((file) =>
          readFile(`${runtime.paths.logsDir}\\${file}`, "utf8"),
        ),
      )
    ).join("\n");
    expect(payload).toContain('"event":"command.bridge.received"');
    expect(payload).toContain('"event":"command.bridge.executed"');
    expect(payload).toContain('"event":"command.bridge.replied"');
  });

  it("deduplicates repeated bridged slash-command deliveries by message id", async () => {
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

    const first = await handleTravelCompanionInboundClaim(
      {
        content: "/travel-companion status",
        body: "/travel-companion status",
        channel: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "msg-dup",
        isGroup: false,
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "msg-dup",
      },
      {
        ...createInboundDeps(runtime),
      },
    );
    const second = await handleTravelCompanionInboundClaim(
      {
        content: "/travel-companion status",
        body: "/travel-companion status",
        channel: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "msg-dup",
        isGroup: false,
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "msg-dup",
      },
      {
        ...createInboundDeps(runtime),
      },
    );

    expect(first).toEqual({ handled: true });
    expect(second).toEqual({ handled: true });
    expect(runtime.messenger.sentReplies).toHaveLength(1);
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.recentHandledCommandMessageIds).toContain("msg-dup");

    const logFiles = await readdir(runtime.paths.logsDir);
    const payload = (
      await Promise.all(
        logFiles.map((file) =>
          readFile(`${runtime.paths.logsDir}\\${file}`, "utf8"),
        ),
      )
    ).join("\n");
    expect(payload).toContain('"event":"command.bridge.duplicate"');
  });

  it("advances setup wizard text steps through inbound messages", async () => {
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
    await runtime.conversationStateRepository.save({
      conversationKey: key,
      mode: "companion-exclusive",
      setupSession: {
        step: "name",
        awaitingReferencePhoto: false,
        draft: {},
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      pendingUserMessages: [],
      pendingReplyDispatch: null,
      instantReplyWindow: null,
      recentHandledCommandMessageIds: [],
      recentTurns: [],
      idleGuideSentAt: null,
      awaitingDestination: false,
      lastUserMessageAt: null,
      lastCompanionReplyAt: null,
      updatedAt: new Date().toISOString(),
    });

    const result = await handleTravelCompanionInboundClaim(
      {
        content: "Mori",
        body: "Mori",
        channel: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "setup-name",
        isGroup: false,
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "setup-name",
      },
      createInboundDeps(runtime),
    );

    expect(result).toEqual({ handled: true });
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.setupSession?.step).toBe("home_city");
    expect(state?.setupSession?.draft.name).toBe("Mori");
    expect(runtime.messenger.sentReplies.at(-1)?.text).toContain("Ta");
  });

  it("accepts the next inbound image as setup reference photo", async () => {
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
    await runtime.conversationStateRepository.save({
      conversationKey: key,
      mode: "companion-exclusive",
      setupSession: {
        step: "reference_photo",
        awaitingReferencePhoto: true,
        draft: {
          name: "Mori",
          homeCity: "Hong Kong",
          traits: ["gentle"],
          relationship: "travel soulmate",
          toneStyle: "warm",
        },
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      pendingUserMessages: [],
      pendingReplyDispatch: null,
      instantReplyWindow: null,
      recentHandledCommandMessageIds: [],
      recentTurns: [],
      idleGuideSentAt: null,
      awaitingDestination: false,
      lastUserMessageAt: null,
      lastCompanionReplyAt: null,
      updatedAt: new Date().toISOString(),
    });

    const result = await handleTravelCompanionInboundClaim(
      {
        content: "",
        body: "",
        channel: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "setup-photo",
        isGroup: false,
        mediaUrl: runtime.referenceImagePath,
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "setup-photo",
      },
      createInboundDeps(runtime),
    );

    expect(result).toEqual({ handled: true });
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.setupSession?.step).toBe("text_provider");
    expect(state?.setupSession?.draft.referenceImageAsset).toBeTruthy();
    await expect(
      stat(state!.setupSession!.draft.referenceImageAsset!),
    ).resolves.toBeTruthy();
    expect(runtime.messenger.sentReplies.at(-1)?.text).toContain("openai-compatible");
  });

  it("leaves non-travel-companion slash commands alone", async () => {
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

    const result = await handleTravelCompanionInboundClaim(
      {
        content: "/status",
        body: "/status",
        channel: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "msg-2b",
        isGroup: false,
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "msg-2b",
      },
      {
        ...createInboundDeps(runtime),
      },
    );

    expect(result).toBeUndefined();
    expect(runtime.messenger.sentReplies).toHaveLength(0);
  });

  it("leaves non-activated conversations alone", async () => {
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
      mode: "default",
    });

    const result = await handleTravelCompanionInboundClaim(
      {
        content: "tokyo",
        body: "tokyo",
        channel: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "msg-3",
        isGroup: false,
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "msg-3",
      },
      {
        ...createInboundDeps(runtime),
      },
    );

    expect(result).toBeUndefined();
    expect(await runtime.conversationStateRepository.getByKey(key)).toBeNull();
  });
});
