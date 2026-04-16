import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  handleTravelCompanionInboundClaim,
  setConversationBindingInternalsForTests,
} from "../src/openclaw-plugin/hooks.js";
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

afterEach(() => {
  setConversationBindingInternalsForTests();
});

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
        logFiles.map((file) => readFile(join(runtime.paths.logsDir, file), "utf8")),
      )
    ).join("\n");
    expect(payload).toContain('"event":"command.bridge.received"');
    expect(payload).toContain('"event":"command.bridge.executed"');
    expect(payload).toContain('"event":"command.bridge.replied"');
  });

  it("recovers a missing local binding from the official binding surface before bridging commands", async () => {
    const runtime = await createTestRuntime();
    const now = Date.now();
    setConversationBindingInternalsForTests({
      requestPluginConversationBinding: async () => ({
        status: "bound",
        binding: {
          bindingId: "binding-official",
          channel: "telegram",
          accountId: "default",
          conversationId: "1459473177",
          boundAt: now,
        },
      }),
      detachPluginConversationBinding: async () => ({ removed: true }),
      getCurrentPluginConversationBinding: async () => ({
        bindingId: "binding-official",
        channel: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        boundAt: now,
      }),
    });

    const result = await handleTravelCompanionInboundClaim(
      {
        content: "/travel-companion activate",
        body: "/travel-companion activate",
        channel: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "msg-recover",
        isGroup: false,
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "msg-recover",
      },
      {
        ...createInboundDeps(runtime),
      },
    );

    expect(result).toEqual({ handled: true });
    const key = bindingKey({
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
    });
    const binding = await runtime.bindings.get(key);
    expect(binding?.bindingId).toBe("binding-official");
    expect(binding?.mode).toBe("companion-exclusive");
    expect(runtime.messenger.sentReplies).toHaveLength(1);
    expect(runtime.messenger.sentReplies[0]?.text).toContain("Ta 模式已开启");

    const logFiles = await readdir(runtime.paths.logsDir);
    const payload = (
      await Promise.all(
        logFiles.map((file) => readFile(join(runtime.paths.logsDir, file), "utf8")),
      )
    ).join("\n");
    expect(payload).toContain('"event":"binding.recovered"');
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
        logFiles.map((file) => readFile(join(runtime.paths.logsDir, file), "utf8")),
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
        kind: "persona",
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
    expect(state?.setupSession?.step).toBe("origin_city");
    expect(state?.setupSession?.draft.name).toBe("Mori");
    expect(runtime.messenger.sentReplies.at(-1)?.text).toContain("Ta");
  });

  it("accepts the next inbound image from inbound metadata as setup reference photo", async () => {
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
        kind: "persona",
        step: "reference_photo",
        awaitingReferencePhoto: true,
        draft: {
          name: "Mori",
          originCity: "Hong Kong",
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
        metadata: {
          mediaPath: runtime.referenceImagePath,
          mediaType: "image/jpeg",
          mediaPaths: [runtime.referenceImagePath],
          mediaTypes: ["image/jpeg"],
        },
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
    expect(state?.setupSession).toBeUndefined();
    expect(state?.awaitingDestination).toBe(false);
    const savedPersona = await runtime.personaRepository.getById(
      (await runtime.bindings.get(key))!.defaultPersonaId!,
    );
    expect(savedPersona?.referenceImageAsset).toBeTruthy();
    await expect(
      stat(savedPersona!.referenceImageAsset),
    ).resolves.toBeTruthy();
    expect(runtime.messenger.sentReplies.at(-1)?.text).toContain("Mori 创建完成");
    expect(runtime.messenger.sentReplies.at(-1)?.text).toContain("/travel-companion model");
  });

  it("updates the current persona instead of creating a new one when setup completes", async () => {
    const runtime = await createTestRuntime();
    const key = bindingKey({
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
    });
    const persona = await runtime.service.createPersona({
      name: "Mori",
      originCity: "Osaka",
      traits: ["gentle"],
      relationship: "soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });
    await runtime.globalConfigRepository.save({
      geminiApiKey: "test-key",
      textProvider: { kind: "gemini" },
      updatedAt: new Date().toISOString(),
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
    await runtime.conversationStateRepository.save({
      conversationKey: key,
      mode: "companion-exclusive",
      setupSession: {
        kind: "persona",
        step: "complete",
        awaitingReferencePhoto: false,
        draft: {
          name: "Mori v2",
          originCity: "Kyoto",
          traits: ["gentle", "clingy"],
          relationship: "soulmate",
          toneStyle: "warmer",
          referenceImageAsset: runtime.referenceImagePath,
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
        content: "done",
        body: "done",
        channel: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "setup-complete-edit",
        isGroup: false,
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "setup-complete-edit",
      },
      createInboundDeps(runtime),
    );

    expect(result).toEqual({ handled: true });
    const updated = await runtime.personaRepository.getById(persona.personaId);
    expect(updated?.name).toBe("Mori v2");
    expect(updated?.originCity).toBe("Kyoto");
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.awaitingDestination).toBe(false);
    const personaFiles = await readdir(runtime.paths.personasDir);
    expect(personaFiles.filter((name) => name.endsWith(".json"))).toHaveLength(1);
    expect(runtime.messenger.sentReplies.at(-1)?.text).toContain(
      "/travel-companion deactivate",
    );
    expect(runtime.messenger.sentReplies.at(-1)?.text).toContain(
      "/travel-companion activate",
    );
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
