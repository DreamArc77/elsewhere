import { readdir, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { handleTravelCompanionInboundClaim } from "../src/openclaw-plugin/hooks.js";
import { bindingKey } from "../src/openclaw-plugin/binding-state.js";
import { createTestRuntime } from "./helpers/runtime.js";

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
        content: "你到哪啦",
        body: "你到哪啦",
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
        bindings: runtime.bindings,
        conversationService: runtime.conversationService,
        service: runtime.service,
        tripRepository: runtime.tripRepository,
        messenger: runtime.messenger,
        pluginConfig: {
          geminiApiKey: "test-key",
          defaultOriginCity: "Hong Kong",
          pollIntervalSeconds: 60,
          openclawBinaryPath: "openclaw",
        },
        runtimeDataPaths: runtime.paths,
        logger: runtime.logger,
      },
    );

    expect(result).toEqual({ handled: true });
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.pendingUserMessages).toHaveLength(1);
    expect(state?.pendingUserMessages[0]?.content).toBe("你到哪啦");
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
        content: "你现在在哪",
        body: "你现在在哪",
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
        bindings: runtime.bindings,
        conversationService: runtime.conversationService,
        service: runtime.service,
        tripRepository: runtime.tripRepository,
        messenger: runtime.messenger,
        pluginConfig: {
          geminiApiKey: "test-key",
          defaultOriginCity: "Hong Kong",
          pollIntervalSeconds: 60,
          openclawBinaryPath: "openclaw",
        },
        runtimeDataPaths: runtime.paths,
        logger: runtime.logger,
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
        bindings: runtime.bindings,
        conversationService: runtime.conversationService,
        service: runtime.service,
        tripRepository: runtime.tripRepository,
        messenger: runtime.messenger,
        pluginConfig: {
          geminiApiKey: "test-key",
          defaultOriginCity: "Hong Kong",
          pollIntervalSeconds: 60,
          openclawBinaryPath: "openclaw",
        },
        runtimeDataPaths: runtime.paths,
        logger: runtime.logger,
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
        bindings: runtime.bindings,
        conversationService: runtime.conversationService,
        service: runtime.service,
        tripRepository: runtime.tripRepository,
        messenger: runtime.messenger,
        pluginConfig: {
          geminiApiKey: "test-key",
          defaultOriginCity: "Hong Kong",
          pollIntervalSeconds: 60,
          openclawBinaryPath: "openclaw",
        },
        runtimeDataPaths: runtime.paths,
        logger: runtime.logger,
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
        content: "你在干嘛",
        body: "你在干嘛",
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
        bindings: runtime.bindings,
        conversationService: runtime.conversationService,
        service: runtime.service,
        tripRepository: runtime.tripRepository,
        messenger: runtime.messenger,
        pluginConfig: {
          geminiApiKey: "test-key",
          defaultOriginCity: "Hong Kong",
          pollIntervalSeconds: 60,
          openclawBinaryPath: "openclaw",
        },
        runtimeDataPaths: runtime.paths,
        logger: runtime.logger,
      },
    );

    expect(result).toBeUndefined();
    expect(await runtime.conversationStateRepository.getByKey(key)).toBeNull();
  });
});
