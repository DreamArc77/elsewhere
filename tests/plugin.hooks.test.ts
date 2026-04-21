import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  handleTravelCompanionBeforeDispatch,
  handleTravelCompanionInboundClaim,
  handleTravelCompanionReplyDispatch,
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
    await runtime.conversationStateRepository.save({
      ...(await runtime.conversationStateRepository.getByKey(key))!,
      systemLocale: "zh-CN",
      setupSession: undefined,
      updatedAt: new Date().toISOString(),
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

  it("queues idle destination messages into the normal reply flow instead of hard-starting immediately", async () => {
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
      pendingUserMessages: [],
      pendingReplyDispatch: null,
      instantReplyWindow: null,
      recentHandledCommandMessageIds: [],
      recentTurns: [],
      latestPostcardPhoto: undefined,
      idleEnteredAt: new Date().toISOString(),
      idleGuideSentAt: null,
      awaitingDestination: true,
      pendingDestinationCandidate: null,
      lastUserMessageAt: null,
      lastCompanionReplyAt: null,
      updatedAt: new Date().toISOString(),
    });

    const result = await handleTravelCompanionInboundClaim(
      {
        content: "东京",
        body: "东京",
        channel: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "idle-destination-queued",
        isGroup: false,
      },
      {
        channelId: "telegram",
        accountId: "default",
        conversationId: "1459473177",
        senderId: "1459473177",
        messageId: "idle-destination-queued",
      },
      createInboundDeps(runtime),
    );

    expect(result).toEqual({ handled: true });
    expect(runtime.messenger.sentReplies).toHaveLength(0);
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.pendingUserMessages).toHaveLength(1);
    expect(state?.pendingUserMessages[0]?.content).toBe("东京");
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
    await runtime.conversationStateRepository.save({
      ...(await runtime.conversationStateRepository.getByKey(key))!,
      systemLocale: "zh-CN",
      setupSession: undefined,
      updatedAt: new Date().toISOString(),
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
      "这条会话还没有记录到最近的行程。",
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
        content: "/elsewhere activate",
        body: "/elsewhere activate",
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
    expect(runtime.messenger.sentReplies[0]?.text).toContain(
      "Choose system language",
    );

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
    expect(runtime.messenger.sentReplies.at(-1)?.text).toContain("默认出发地");
  });

  it("continues locale setup on qqbot c2c after the user selects a language", async () => {
    const runtime = await createTestRuntime();
    const key = bindingKey({
      channel: "qqbot",
      accountId: "default",
      target: "qqbot:c2c:USER123",
    });
    await runtime.bindings.upsert({
      key,
      channel: "qqbot",
      accountId: "default",
      target: "qqbot:c2c:USER123",
      boundAt: Date.now(),
      bindingSource: "local",
      mode: "companion-exclusive",
    });
    await runtime.conversationStateRepository.save({
      conversationKey: key,
      mode: "companion-exclusive",
      setupSession: {
        kind: "locale",
        step: "locale_select",
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
        content: "1",
        body: "1",
        channel: "qqbot",
        accountId: "default",
        senderId: "USER123",
        messageId: "qqbot-locale-1",
        isGroup: false,
      },
      {
        channelId: "qqbot",
        accountId: "default",
        senderId: "USER123",
        messageId: "qqbot-locale-1",
      },
      createInboundDeps(runtime),
    );

    expect(result).toEqual({ handled: true });
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.systemLocale).toBe("zh-CN");
    expect(state?.setupSession).toBeUndefined();
    expect(runtime.messenger.sentReplies.at(-1)?.text).toContain("/elsewhere setup");
    expect(runtime.messenger.sentReplies.at(-1)?.text).not.toContain("/elsewhere model");
  });

  it("continues qqbot locale setup even when the inbound account id differs from the stored local binding", async () => {
    const runtime = await createTestRuntime();
    const key = bindingKey({
      channel: "qqbot",
      accountId: "default",
      target: "qqbot:c2c:USER456",
    });
    await runtime.bindings.upsert({
      key,
      channel: "qqbot",
      accountId: "default",
      target: "qqbot:c2c:USER456",
      boundAt: Date.now(),
      bindingSource: "local",
      mode: "companion-exclusive",
    });
    await runtime.conversationStateRepository.save({
      conversationKey: key,
      mode: "companion-exclusive",
      setupSession: {
        kind: "locale",
        step: "locale_select",
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
        content: "1",
        body: "1",
        channel: "qqbot",
        accountId: "other-account-shape",
        senderId: "USER456",
        messageId: "qqbot-locale-2",
        isGroup: false,
      },
      {
        channelId: "qqbot",
        accountId: "other-account-shape",
        senderId: "USER456",
        messageId: "qqbot-locale-2",
      },
      createInboundDeps(runtime),
    );

    expect(result).toEqual({ handled: true });
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.systemLocale).toBe("zh-CN");
    expect(state?.setupSession).toBeUndefined();
  });

  it("continues qqbot locale setup through before_dispatch when soft binding is local-only", async () => {
    const runtime = await createTestRuntime();
    const key = bindingKey({
      channel: "qqbot",
      accountId: "default",
      target: "qqbot:c2c:USER789",
    });
    await runtime.bindings.upsert({
      key,
      channel: "qqbot",
      accountId: "default",
      target: "qqbot:c2c:USER789",
      boundAt: Date.now(),
      bindingSource: "local",
      mode: "companion-exclusive",
    });
    await runtime.conversationStateRepository.save({
      conversationKey: key,
      mode: "companion-exclusive",
      setupSession: {
        kind: "locale",
        step: "locale_select",
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

    const result = await handleTravelCompanionBeforeDispatch(
      {
        content: "1",
        body: "1",
        channel: "qqbot",
        senderId: "USER789",
        isGroup: false,
      },
      {
        channelId: "qqbot",
        accountId: "default",
        conversationId: undefined,
        senderId: "USER789",
      },
      createInboundDeps(runtime),
    );

    expect(result).toEqual({ handled: true });
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.systemLocale).toBe("zh-CN");
    expect(state?.setupSession).toBeUndefined();
    expect(runtime.messenger.sentReplies.at(-1)?.text).toContain("/elsewhere setup");
  });

  it("queues qqbot companion text through before_dispatch when the conversation is soft-bound", async () => {
    const runtime = await createTestRuntime();
    const key = bindingKey({
      channel: "qqbot",
      accountId: "default",
      target: "qqbot:c2c:USER999",
    });
    await runtime.bindings.upsert({
      key,
      channel: "qqbot",
      accountId: "default",
      target: "qqbot:c2c:USER999",
      boundAt: Date.now(),
      bindingSource: "local",
      mode: "companion-exclusive",
    });
    await runtime.conversationService.activateConversation({
      key,
      channel: "qqbot",
      accountId: "default",
      target: "qqbot:c2c:USER999",
      boundAt: Date.now(),
      mode: "companion-exclusive",
    });

    const result = await handleTravelCompanionBeforeDispatch(
      {
        content: "在吗",
        body: "在吗",
        channel: "qqbot",
        senderId: "USER999",
        isGroup: false,
      },
      {
        channelId: "qqbot",
        accountId: "default",
        senderId: "USER999",
      },
      createInboundDeps(runtime),
    );

    expect(result).toEqual({ handled: true });
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.pendingUserMessages).toHaveLength(1);
    expect(state?.pendingUserMessages[0]?.content).toBe("在吗");
  });

  it("continues feishu locale setup when the inbound sender id needs user: normalization", async () => {
    const runtime = await createTestRuntime();
    const key = bindingKey({
      channel: "feishu",
      accountId: "default",
      target: "user:ou_FEISHU123",
    });
    await runtime.bindings.upsert({
      key,
      channel: "feishu",
      accountId: "default",
      target: "user:ou_FEISHU123",
      boundAt: Date.now(),
      bindingSource: "local",
      mode: "companion-exclusive",
    });
    await runtime.conversationStateRepository.save({
      conversationKey: key,
      mode: "companion-exclusive",
      setupSession: {
        kind: "locale",
        step: "locale_select",
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
        content: "1",
        body: "1",
        channel: "feishu",
        accountId: "default",
        conversationId: "oc_direct_session_1",
        senderId: "ou_FEISHU123",
        messageId: "feishu-locale-1",
        isGroup: false,
      },
      {
        channelId: "feishu",
        accountId: "default",
        conversationId: "oc_direct_session_1",
        senderId: "ou_FEISHU123",
        messageId: "feishu-locale-1",
      },
      createInboundDeps(runtime),
    );

    expect(result).toEqual({ handled: true });
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.systemLocale).toBe("zh-CN");
    expect(state?.setupSession).toBeUndefined();
    expect(runtime.messenger.sentReplies.at(-1)?.text).toContain("/elsewhere setup");
  });

  it("parses feishu locale input from wrapped transcript text", async () => {
    const runtime = await createTestRuntime();
    const key = bindingKey({
      channel: "feishu",
      accountId: "default",
      target: "user:ou_FEISHU789",
    });
    await runtime.bindings.upsert({
      key,
      channel: "feishu",
      accountId: "default",
      target: "user:ou_FEISHU789",
      boundAt: Date.now(),
      bindingSource: "local",
      mode: "companion-exclusive",
    });
    await runtime.conversationStateRepository.save({
      conversationKey: key,
      mode: "companion-exclusive",
      setupSession: {
        kind: "locale",
        step: "locale_select",
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
        content: "[message_id: om_xxx]\n梦醒: 1",
        body: "[message_id: om_xxx]\n梦醒: 1",
        bodyForAgent: "[message_id: om_xxx]\n梦醒: 1",
        channel: "feishu",
        accountId: "default",
        conversationId: "oc_direct_session_3",
        senderId: "ou_FEISHU789",
        messageId: "feishu-locale-wrapped",
        isGroup: false,
      },
      {
        channelId: "feishu",
        accountId: "default",
        conversationId: "oc_direct_session_3",
        senderId: "ou_FEISHU789",
        messageId: "feishu-locale-wrapped",
      },
      createInboundDeps(runtime),
    );

    expect(result).toEqual({ handled: true });
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.systemLocale).toBe("zh-CN");
    expect(state?.setupSession).toBeUndefined();
  });

  it("queues feishu direct messages through before_dispatch using the normalized user target", async () => {
    const runtime = await createTestRuntime();
    const key = bindingKey({
      channel: "feishu",
      accountId: "default",
      target: "user:ou_FEISHU456",
    });
    await runtime.bindings.upsert({
      key,
      channel: "feishu",
      accountId: "default",
      target: "user:ou_FEISHU456",
      boundAt: Date.now(),
      bindingSource: "local",
      mode: "companion-exclusive",
    });
    await runtime.conversationService.activateConversation({
      key,
      channel: "feishu",
      accountId: "default",
      target: "user:ou_FEISHU456",
      boundAt: Date.now(),
      mode: "companion-exclusive",
    });

    const result = await handleTravelCompanionBeforeDispatch(
      {
        content: "在吗",
        body: "在吗",
        channel: "feishu",
        senderId: "ou_FEISHU456",
        isGroup: false,
      },
      {
        channelId: "feishu",
        accountId: "default",
        conversationId: "oc_direct_session_2",
        senderId: "ou_FEISHU456",
      },
      createInboundDeps(runtime),
    );

    expect(result).toEqual({ handled: true });
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.pendingUserMessages).toHaveLength(1);
    expect(state?.pendingUserMessages[0]?.content).toBe("在吗");
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
          toneStyle: "warm",
          relationship: "travel soulmate",
          userAddressing: "baby",
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
    expect(state?.setupSession?.kind).toBe("model");
    expect(state?.awaitingDestination).toBe(false);
    const savedPersona = await runtime.personaRepository.getById(
      (await runtime.bindings.get(key))!.defaultPersonaId!,
    );
    expect(savedPersona?.referenceImageAsset).toBeTruthy();
    await expect(
      stat(savedPersona!.referenceImageAsset),
    ).resolves.toBeTruthy();
    expect(runtime.messenger.sentReplies).toHaveLength(1);
    expect(runtime.messenger.sentReplies[0]?.text).toContain("Mori 创建完成");
    expect(runtime.messenger.sentReplies[0]?.text).toContain("好的，旅伴资料已经创建好了");
    expect(runtime.messenger.sentReplies[0]?.text).toContain("请确认旅伴聊天时要用的文本模型");
  });

  it("accepts a qqbot downloaded local image path embedded in the inbound body while waiting for a reference photo", async () => {
    const runtime = await createTestRuntime();
    const key = bindingKey({
      channel: "qqbot",
      accountId: "default",
      target: "qqbot:c2c:USERIMG1",
    });
    await runtime.bindings.upsert({
      key,
      channel: "qqbot",
      accountId: "default",
      target: "qqbot:c2c:USERIMG1",
      boundAt: Date.now(),
      bindingSource: "local",
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
          toneStyle: "warm",
          relationship: "travel soulmate",
          userAddressing: "baby",
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

    const result = await handleTravelCompanionBeforeDispatch(
      {
        content: "",
        body: `- 图片: ${runtime.referenceImagePath}`,
        channel: "qqbot",
        senderId: "USERIMG1",
        isGroup: false,
      },
      {
        channelId: "qqbot",
        accountId: "default",
        senderId: "USERIMG1",
      },
      createInboundDeps(runtime),
    );

    expect(result).toEqual({ handled: true });
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.setupSession?.kind).toBe("model");
    const savedPersona = await runtime.personaRepository.getById(
      (await runtime.bindings.get(key))!.defaultPersonaId!,
    );
    expect(savedPersona?.referenceImageAsset).toBe(runtime.referenceImagePath);
    expect(runtime.messenger.sentReplies.at(-1)?.text).toContain("Mori 创建完成");
    expect(runtime.messenger.sentReplies.at(-1)?.text).toContain("请确认旅伴聊天时要用的文本模型");
  });

  it("accepts a weixin media-only before_dispatch image while waiting for a reference photo", async () => {
    const runtime = await createTestRuntime();
    const key = bindingKey({
      channel: "openclaw-weixin",
      accountId: "6f6bb13b44e3-im-bot",
      target: "o9cq80-5zV01PX86pL_GsVZ5pT6k@im.wechat",
    });
    await runtime.bindings.upsert({
      key,
      channel: "openclaw-weixin",
      accountId: "6f6bb13b44e3-im-bot",
      target: "o9cq80-5zV01PX86pL_GsVZ5pT6k@im.wechat",
      boundAt: Date.now(),
      bindingSource: "local",
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
          toneStyle: "warm",
          relationship: "travel soulmate",
          userAddressing: "baby",
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

    const result = await handleTravelCompanionBeforeDispatch(
      {
        content: "",
        body: "",
        channel: "openclaw-weixin",
        senderId: "o9cq80-5zV01PX86pL_GsVZ5pT6k@im.wechat",
        isGroup: false,
        hasMedia: true,
        metadata: {
          mediaPath: runtime.referenceImagePath,
          mediaType: "image/jpeg",
        },
      },
      {
        channelId: "openclaw-weixin",
        accountId: "6f6bb13b44e3-im-bot",
        conversationId: "o9cq80-5zV01PX86pL_GsVZ5pT6k@im.wechat",
        senderId: "o9cq80-5zV01PX86pL_GsVZ5pT6k@im.wechat",
      },
      createInboundDeps(runtime),
    );

    expect(result).toEqual({ handled: true });
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.setupSession?.kind).toBe("model");
    const savedPersona = await runtime.personaRepository.getById(
      (await runtime.bindings.get(key))!.defaultPersonaId!,
    );
    expect(savedPersona?.referenceImageAsset).toBe(runtime.referenceImagePath);
    expect(runtime.messenger.sentReplies.at(-1)?.text).toContain("Mori 创建完成");
    expect(runtime.messenger.sentReplies.at(-1)?.text).toContain("请确认旅伴聊天时要用的文本模型");
  });

  it("shows a short checking message instead of an immediate fallback when a media-like reference photo event arrives without a usable source yet", async () => {
    const runtime = await createTestRuntime();
    const key = bindingKey({
      channel: "openclaw-weixin",
      accountId: "bot-1",
      target: "wechat-user-1",
    });
    await runtime.bindings.upsert({
      key,
      channel: "openclaw-weixin",
      accountId: "bot-1",
      target: "wechat-user-1",
      boundAt: Date.now(),
      bindingSource: "local",
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
          toneStyle: "warm",
          relationship: "travel soulmate",
          userAddressing: "baby",
        },
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      pendingReferencePhotoProbe: null,
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

    const result = await handleTravelCompanionBeforeDispatch(
      {
        content: "",
        body: "",
        channel: "openclaw-weixin",
        senderId: "wechat-user-1",
        isGroup: false,
        hasMedia: true,
      },
      {
        channelId: "openclaw-weixin",
        accountId: "bot-1",
        conversationId: "wechat-user-1",
        senderId: "wechat-user-1",
      },
      createInboundDeps(runtime),
    );

    expect(result).toEqual({ handled: true });
    expect(runtime.messenger.sentReplies).toHaveLength(1);
    expect(runtime.messenger.sentReplies[0]?.text).toContain("正在检查");
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.pendingReferencePhotoProbe?.noticeSentAt).toBeTruthy();
    expect(state?.pendingReferencePhotoProbe?.fallbackSentAt).toBeNull();
  });

  it("claims a weixin reply_dispatch media image before it reaches the default agent", async () => {
    const runtime = await createTestRuntime();
    const key = bindingKey({
      channel: "openclaw-weixin",
      accountId: "6f6bb13b44e3-im-bot",
      target: "o9cq80-5zV01PX86pL_GsVZ5pT6k@im.wechat",
    });
    await runtime.bindings.upsert({
      key,
      channel: "openclaw-weixin",
      accountId: "6f6bb13b44e3-im-bot",
      target: "o9cq80-5zV01PX86pL_GsVZ5pT6k@im.wechat",
      boundAt: Date.now(),
      bindingSource: "local",
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
          toneStyle: "warm",
          relationship: "travel soulmate",
          userAddressing: "baby",
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

    const result = await handleTravelCompanionReplyDispatch(
      {
        ctx: {
          Body: "",
          From: "o9cq80-5zV01PX86pL_GsVZ5pT6k@im.wechat",
          To: "o9cq80-5zV01PX86pL_GsVZ5pT6k@im.wechat",
          OriginatingTo: "o9cq80-5zV01PX86pL_GsVZ5pT6k@im.wechat",
          AccountId: "6f6bb13b44e3-im-bot",
          OriginatingChannel: "openclaw-weixin",
          Provider: "openclaw-weixin",
          ChatType: "direct",
          MessageSid: "weixin-media-only",
          MediaPath: runtime.referenceImagePath,
          MediaType: "image/jpeg",
        },
      },
      {
        dispatcher: {
          getQueuedCounts: () => ({ final: 0, block: 0, tool: 0 }),
        },
      },
      createInboundDeps(runtime),
    );

    expect(result).toEqual({
      handled: true,
      queuedFinal: true,
      counts: { final: 0, block: 0, tool: 0 },
    });
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.setupSession?.kind).toBe("model");
    const savedPersona = await runtime.personaRepository.getById(
      (await runtime.bindings.get(key))!.defaultPersonaId!,
    );
    expect(savedPersona?.referenceImageAsset).toBe(runtime.referenceImagePath);
    expect(runtime.messenger.sentReplies.at(-1)?.text).toContain("Mori 创建完成");
    expect(runtime.messenger.sentReplies.at(-1)?.text).toContain("请确认旅伴聊天时要用的文本模型");
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
          toneStyle: "warmer",
          relationship: "soulmate",
          userAddressing: "哥哥",
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
      "/elsewhere deactivate",
    );
    expect(runtime.messenger.sentReplies.at(-1)?.text).toContain(
      "/elsewhere activate",
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
