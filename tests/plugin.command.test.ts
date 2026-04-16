import { stat } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginCommandContext } from "openclaw/plugin-sdk/plugin-entry";

import { handleTravelCompanionCommand } from "../src/openclaw-plugin/command.js";
import {
  BindingRegistryStore,
  bindingKey,
} from "../src/openclaw-plugin/binding-state.js";
import { createTestRuntime } from "./helpers/runtime.js";

function createDeps(
  runtime: Awaited<ReturnType<typeof createTestRuntime>>,
  bindings: BindingRegistryStore,
) {
  return {
    service: runtime.service,
    conversationService: runtime.conversationService,
    tripRepository: runtime.tripRepository,
    personaRepository: runtime.personaRepository,
    conversationStates: runtime.conversationStateRepository,
    globalConfigRepository: runtime.globalConfigRepository,
    messenger: runtime.messenger,
    bindings,
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

function createStaticPluginConfig() {
  return {
    geminiApiKey: "test-key",
    defaultOriginCity: "Hong Kong",
    pollIntervalSeconds: 60,
    openclawBinaryPath: "openclaw",
  };
}

async function seedCompletedOnboarding(
  runtime: Awaited<ReturnType<typeof createTestRuntime>>,
) {
  await runtime.globalConfigRepository.save({
    geminiApiKey: "test-key",
    textProvider: { kind: "gemini" },
    updatedAt: new Date().toISOString(),
  });
}

function createTelegramContext(commandBody: string): PluginCommandContext {
  const [, ...rest] = commandBody.trim().split(/\s+/u);
  const pluginBinding = {
    bindingId: "binding-1",
    pluginId: "openclaw-travel-companion",
    pluginName: "OpenClaw Travel Companion",
    pluginRoot: "C:\\Users\\ndh\\Documents\\New project",
    channel: "telegram",
    accountId: "default",
    conversationId: "1459473177",
    boundAt: Date.now(),
  };
  return {
    senderId: "1459473177",
    channel: "telegram",
    isAuthorizedSender: true,
    args: rest.join(" "),
    commandBody,
    config: {} as PluginCommandContext["config"],
    from: "1459473177",
    to: "999999999",
    accountId: "default",
    requestConversationBinding: async () => ({
      status: "bound",
      binding: pluginBinding,
    }),
    detachConversationBinding: async () => ({ removed: true }),
    getCurrentConversationBinding: async () => pluginBinding,
  };
}

function createTelegramContextWithBinding(
  commandBody: string,
  input: {
    accountId?: string;
    bindingAccountId?: string;
    bindingConversationId?: string;
    bindingId?: string;
  } = {},
): PluginCommandContext {
  const [, ...rest] = commandBody.trim().split(/\s+/u);
  const pluginBinding = {
    bindingId: input.bindingId ?? "binding-1",
    pluginId: "openclaw-travel-companion",
    pluginName: "OpenClaw Travel Companion",
    pluginRoot: "C:\\Users\\ndh\\Documents\\New project",
    channel: "telegram",
    accountId: input.bindingAccountId ?? input.accountId ?? "default",
    conversationId: input.bindingConversationId ?? "1459473177",
    boundAt: Date.now(),
  };
  return {
    senderId: "1459473177",
    channel: "telegram",
    isAuthorizedSender: true,
    args: rest.join(" "),
    commandBody,
    config: {} as PluginCommandContext["config"],
    from: "1459473177",
    to: "999999999",
    accountId: input.accountId ?? "default",
    requestConversationBinding: async () => ({
      status: "bound",
      binding: pluginBinding,
    }),
    detachConversationBinding: async () => ({ removed: true }),
    getCurrentConversationBinding: async () => pluginBinding,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("travel companion command UX", () => {
  it("binds the current Telegram DM without interactive approval", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion bind"),
      createDeps(runtime, bindings),
    );

    expect(reply.isError).toBeUndefined();
    expect(reply.text).toContain("这条会话已经和 Ta 绑定好了。");

    const binding = await bindings.get(
      bindingKey({
        channel: "telegram",
        accountId: "default",
        target: "1459473177",
      }),
    );
    expect(binding?.target).toBe("1459473177");
    expect(binding?.mode).toBe("default");
  });

  it("requires activate before setup is available", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);

    const reply = await handleTravelCompanionCommand(
      createTelegramContext(
        "/travel-companion setup --name Mori --home-city Hong-Kong --traits gentle --relationship soulmate --tone warm https://example.com/mori.webp",
      ),
      createDeps(runtime, bindings),
    );

    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("activate");
  });

  it("activates the current chat and auto-binds it into companion-exclusive mode", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion activate"),
      createDeps(runtime, bindings),
    );

    expect(reply.isError).toBeUndefined();
    expect(reply.text).toContain("Ta 模式已开启");

    const binding = await bindings.get(
      bindingKey({
        channel: "telegram",
        accountId: "default",
        target: "1459473177",
      }),
    );
    expect(binding?.mode).toBe("companion-exclusive");
  });

  it("shows onboarding gate after activate when persona and provider are missing", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion activate"),
      createDeps(runtime, bindings),
    );

    expect(reply.isError).toBeUndefined();
    expect(reply.text).toContain("Ta 模式已开启");
    expect(reply.text).toContain("还差最后几项配置");
    expect(reply.text).toContain("/travel-companion setup");
    expect(reply.text).toContain("Ta");
  });

  it("migrates the default persona from a legacy local binding to the new official binding key on activate", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const deps = createDeps(runtime, bindings);

    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle", "curious"],
      relationship: "soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });

    await bindings.upsert({
      key: bindingKey({
        channel: "telegram",
        accountId: "default",
        target: "telegram:1459473177",
      }),
      channel: "telegram",
      accountId: "default",
      target: "telegram:1459473177",
      mode: "companion-exclusive",
      defaultPersonaId: persona.personaId,
      boundAt: Date.now(),
    });

    const reply = await handleTravelCompanionCommand(
      createTelegramContextWithBinding("/travel-companion activate", {
        accountId: "1459473177",
        bindingAccountId: "1459473177",
        bindingConversationId: "1459473177",
        bindingId: "binding-official",
      }),
      deps,
    );

    expect(reply.isError).toBeUndefined();
    const migrated = await bindings.get(
      bindingKey({
        channel: "telegram",
        accountId: "1459473177",
        target: "1459473177",
      }),
    );
    expect(migrated?.defaultPersonaId).toBe(persona.personaId);
  });

  it("creates a persona from an image URL pasted in the setup command after activation", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const webpBytes = Buffer.from("fake-webp", "utf8");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "image/webp" }),
        arrayBuffer: async () =>
          webpBytes.buffer.slice(
            webpBytes.byteOffset,
            webpBytes.byteOffset + webpBytes.byteLength,
          ),
      })),
    );

    const deps = createDeps(runtime, bindings);

    await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion activate"),
      deps,
    );

    const reply = await handleTravelCompanionCommand(
      createTelegramContext(
        "/travel-companion setup --name Mori --home-city Hong-Kong --traits gentle,curious --relationship soulmate --tone warm https://example.com/mori.webp",
      ),
      deps,
    );

    expect(reply.text).toContain("Ta 创建完成：Mori");
    const binding = await bindings.get(
      bindingKey({
        channel: "telegram",
        accountId: "default",
        target: "1459473177",
      }),
    );
    expect(binding?.defaultPersonaId).toBeTruthy();

    const persona = await runtime.personaRepository.getById(binding!.defaultPersonaId!);
    expect(persona?.referenceImageAsset).toContain(
      join(runtime.paths.personasDir, "reference-assets"),
    );
    await expect(stat(persona!.referenceImageAsset)).resolves.toBeTruthy();
  });

  it("starts interactive setup wizard when setup is called without legacy args", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const deps = createDeps(runtime, bindings);

    await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion activate"),
      deps,
    );

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion setup"),
      deps,
    );

    expect(reply.text).toContain("我们先把 Ta 建起来");
    expect(reply.text).toContain("准备好了回复 1");
    const key = bindingKey({
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
    });
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.setupSession?.step).toBe("persona_intro");
  });

  it("reuses the current persona draft when setup is called again", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const deps = createDeps(runtime, bindings);

    await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion activate"),
      deps,
    );
    const persona = await runtime.service.createPersona({
      name: "Mori",
      originCity: "Osaka",
      traits: ["gentle", "curious"],
      relationship: "soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });
    const key = bindingKey({
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
    });
    const binding = await bindings.get(key);
    await bindings.upsert({
      ...binding!,
      defaultPersonaId: persona.personaId,
    });

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion setup"),
      deps,
    );

    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.setupSession?.kind).toBe("persona");
    expect(state?.setupSession?.step).toBe("existing_persona_confirm");
    expect(state?.setupSession?.draft.name).toBe("Mori");
    expect(state?.setupSession?.draft.originCity).toBe("Osaka");
    expect(state?.setupSession?.draft.referenceImageAsset).toBe(
      runtime.referenceImagePath,
    );
    expect(reply.text).toContain("当前已经有 Ta 的设定了");
    expect(reply.text).toContain("1. 继续修改");
  });

  it("starts model-only setup flow with the model command", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const deps = createDeps(runtime, bindings);

    await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion activate"),
      deps,
    );

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion model"),
      deps,
    );

    expect(reply.text).toContain("OpenClaw");
    const key = bindingKey({
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
    });
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.setupSession?.kind).toBe("model");
    expect(state?.setupSession?.step).toBe("text_provider");
  });

  it("forces delayed replies and the next trip step immediately when tick is used", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const deps = createDeps(runtime, bindings);
    await seedCompletedOnboarding(runtime);

    await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion activate"),
      deps,
    );
    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle", "curious"],
      relationship: "soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });
    const key = bindingKey({
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
    });
    const binding = await bindings.get(key);
    await bindings.upsert({
      ...binding!,
      defaultPersonaId: persona.personaId,
    });

    await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion start --to Tokyo"),
      deps,
    );
    await runtime.service.runDueTrips();
    await runtime.conversationService.enqueueInboundMessage({
      binding: (await bindings.get(key))!,
      messageId: "msg-1",
      content: "hello",
      senderId: "1459473177",
    });

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion tick"),
      deps,
    );

    expect(reply.text).toContain("reply: processed pending conversation replies");
    expect(runtime.messenger.sentReplies).toHaveLength(1);
    expect(runtime.messenger.sentMessages.length).toBeGreaterThanOrEqual(2);
  });

  it("forces only delayed replies immediately when tick-reply is used", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const deps = createDeps(runtime, bindings);
    await seedCompletedOnboarding(runtime);

    await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion activate"),
      deps,
    );
    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle", "curious"],
      relationship: "soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });
    const key = bindingKey({
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
    });
    const binding = await bindings.get(key);
    await bindings.upsert({
      ...binding!,
      defaultPersonaId: persona.personaId,
    });

    await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion start --to Tokyo"),
      deps,
    );
    const tripBefore = await runtime.tripRepository.listDueTrips(new Date("9999-01-01T00:00:00.000Z"));
    await runtime.service.runDueTrips();
    await runtime.conversationService.enqueueInboundMessage({
      binding: (await bindings.get(key))!,
      messageId: "msg-reply-only",
      content: "ping",
      senderId: "1459473177",
    });
    const sentPostcardsBefore = runtime.messenger.sentMessages.length;

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion tick-reply"),
      deps,
    );

    expect(reply.text).toContain("reply: processed pending conversation replies");
    expect(reply.text).toContain("trip: not advanced");
    expect(runtime.messenger.sentReplies).toHaveLength(1);
    expect(runtime.messenger.sentMessages.length).toBe(sentPostcardsBefore);
    const tripAfter = await runtime.tripRepository.getById(tripBefore[0]!.tripId);
    expect(tripAfter?.timelineIndex).toBe(1);
  });

  it("shows conversation reply debug info in status", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const deps = {
      ...createDeps(runtime, bindings),
      pluginConfig: createStaticPluginConfig(),
    };
    await seedCompletedOnboarding(runtime);

    await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion activate"),
      deps,
    );
    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle", "curious"],
      relationship: "soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });
    const key = bindingKey({
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
    });
    const binding = await bindings.get(key);
    await bindings.upsert({
      ...binding!,
      defaultPersonaId: persona.personaId,
    });

    await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion start --to Tokyo"),
      deps,
    );
    await runtime.conversationService.enqueueInboundMessage({
      binding: (await bindings.get(key))!,
      messageId: "msg-status",
      content: "status-check",
      senderId: "1459473177",
    });

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion status"),
      deps,
    );

    expect(reply.text).toContain("conversationMode: companion-exclusive");
    expect(reply.text).toContain("pendingReplyCount: 1");
    expect(reply.text).toContain("replyDueAt:");
    expect(reply.text).toContain("state:");
    expect(reply.text).toContain("substate:");
    expect(reply.text).toContain("instantReplyWindow:");
  });

  it("deactivates takeover and stops the active trip", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const deps = {
      ...createDeps(runtime, bindings),
      pluginConfig: createStaticPluginConfig(),
    };
    await seedCompletedOnboarding(runtime);

    await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion activate"),
      deps,
    );
    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle", "curious"],
      relationship: "soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });
    const key = bindingKey({
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
    });
    const binding = await bindings.get(key);
    await bindings.upsert({
      ...binding!,
      defaultPersonaId: persona.personaId,
    });

    const startReply = await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion start --to Tokyo"),
      deps,
    );
    const tripId = startReply.text.match(/Trip created: ([^\n]+)/u)?.[1];
    expect(tripId).toBeTruthy();

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion deactivate"),
      deps,
    );

    expect(reply.text).toContain("Ta 模式已关闭");
    const trip = await runtime.tripRepository.getById(tripId!);
    expect(trip?.state.status).toBe("completed");

    const updatedBinding = await bindings.get(key);
    expect(updatedBinding?.mode).toBe("default");
  });

  it("does not leak raw internal stderr when a tick fails", async () => {
    const bindings = new BindingRegistryStore("C:\\temp");
    await bindings.upsert({
      key: bindingKey({
        channel: "telegram",
        accountId: "default",
        target: "1459473177",
      }),
      channel: "telegram",
      accountId: "default",
      target: "1459473177",
      boundAt: Date.now(),
      lastTripId: "trip-1",
      mode: "companion-exclusive",
    });

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion tick"),
      {
        service: {
          async runTrip() {
            throw new Error(
              "openclaw message send failed | code=null | Config warnings: ...",
            );
          },
        } as never,
        conversationService: {
          async runConversation() {},
        } as never,
        tripRepository: {} as never,
        personaRepository: {} as never,
        conversationStates: {} as never,
        globalConfigRepository: {} as never,
        messenger: {} as never,
        bindings,
        pluginConfig: createStaticPluginConfig(),
        runtimeDataPaths: {
          rootDir: "C:\\temp",
          personasDir: "C:\\temp\\personas",
          tripsDir: "C:\\temp\\trips",
          conversationsDir: "C:\\temp\\conversations",
          artifactsDir: "C:\\temp\\artifacts",
          logsDir: "C:\\temp\\logs",
          configPath: "C:\\temp\\config.json",
        },
      },
    );

    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("Tick attempted: trip-1");
    expect(reply.text).not.toContain("Config warnings");
  });
});
