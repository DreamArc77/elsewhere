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
      logMode: "safe" as const,
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
    logMode: "safe" as const,
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

async function seedSystemLocale(
  runtime: Awaited<ReturnType<typeof createTestRuntime>>,
  key: string,
  locale: "zh-CN" | "ja-JP" | "en" = "zh-CN",
) {
  const state = await runtime.conversationStateRepository.getByKey(key);
  await runtime.conversationStateRepository.save({
    ...(state ?? {
      conversationKey: key,
      mode: "companion-exclusive" as const,
      pendingUserMessages: [],
      pendingReplyDispatch: null,
      instantReplyWindow: null,
      recentHandledCommandMessageIds: [],
      recentTurns: [],
      lastUserMessageAt: null,
      lastCompanionReplyAt: null,
      updatedAt: new Date().toISOString(),
    }),
    systemLocale: locale,
    setupSession: undefined,
    updatedAt: new Date().toISOString(),
  });
}

function createTelegramContext(
  commandBody: string,
  options?: {
    requestConversationBinding?: PluginCommandContext["requestConversationBinding"];
    detachConversationBinding?: PluginCommandContext["detachConversationBinding"];
    getCurrentConversationBinding?: PluginCommandContext["getCurrentConversationBinding"];
  },
): PluginCommandContext {
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
    requestConversationBinding:
      options?.requestConversationBinding ??
      (async () => ({
        status: "bound" as const,
        binding: pluginBinding,
      })),
    detachConversationBinding:
      options?.detachConversationBinding ??
      (async () => ({ removed: true })),
    getCurrentConversationBinding:
      options?.getCurrentConversationBinding ??
      (async () => pluginBinding),
  };
}

function keyForDefaultChat() {
  return bindingKey({
    channel: "telegram",
    accountId: "default",
    target: "1459473177",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("travel companion command UX", () => {
  it("binds the current Telegram DM without interactive approval", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere bind"),
      createDeps(runtime, bindings),
    );

    expect(reply.isError).toBeUndefined();
    expect(reply.text).toContain("elsewhere");
    expect(reply.text).toContain("activate");

    const binding = await bindings.get(keyForDefaultChat());
    expect(binding?.target).toBe("1459473177");
    expect(binding?.mode).toBe("default");
  });

  it("requires activate before setup is available", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);

    const reply = await handleTravelCompanionCommand(
      createTelegramContext(
        "/elsewhere setup --name Mori --home-city Hong-Kong --traits gentle --tone warm --relationship soulmate --user-address baby https://example.com/mori.webp",
      ),
      createDeps(runtime, bindings),
    );

    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("activate");
  });

  it("shows locale selection on the first activate", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere activate"),
      createDeps(runtime, bindings),
    );

    expect(reply.isError).toBeUndefined();
    expect(reply.text).toContain("Choose system language");
    expect(reply.text).toContain("1. 简体中文");

    const binding = await bindings.get(keyForDefaultChat());
    expect(binding?.mode).toBe("companion-exclusive");
    expect(binding?.bindingSource).toBe("official");
    const state = await runtime.conversationStateRepository.getByKey(
      keyForDefaultChat(),
    );
    expect(state?.setupSession?.kind).toBe("locale");
  });

  it("falls back to local soft binding when official binding approval stays pending", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere activate", {
        requestConversationBinding: async () => ({
          status: "pending" as const,
          approvalId: "pending-approval-id",
          reply: { text: "pending approval" },
        }),
        getCurrentConversationBinding: async () => null,
      }),
      createDeps(runtime, bindings),
    );

    expect(reply.isError).toBeUndefined();
    expect(reply.text).toContain("Choose system language");

    const binding = await bindings.get(keyForDefaultChat());
    expect(binding?.mode).toBe("companion-exclusive");
    expect(binding?.bindingSource).toBe("local");
    expect(binding?.bindingId).toBeUndefined();
  });

  it("shows onboarding gate after locale is selected", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const deps = createDeps(runtime, bindings);

    await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere activate"),
      deps,
    );
    await seedSystemLocale(runtime, keyForDefaultChat());

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere activate"),
      deps,
    );

    expect(reply.isError).toBeUndefined();
    expect(reply.text).toContain("旅伴模式已开启");
    expect(reply.text).toContain("欢迎来到 elsewhere");
    expect(reply.text).toContain("/elsewhere setup");
  });

  it("sends the idle destination guide immediately on activate after onboarding is complete", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const deps = createDeps(runtime, bindings);
    await seedCompletedOnboarding(runtime);

    await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere activate"),
      deps,
    );
    await seedSystemLocale(runtime, keyForDefaultChat());

    const persona = await runtime.service.createPersona({
      name: "Mori",
      originCity: "Osaka",
      traits: ["gentle", "curious"],
      relationship: "soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });
    const binding = await bindings.get(keyForDefaultChat());
    await bindings.upsert({
      ...binding!,
      defaultPersonaId: persona.personaId,
    });

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere activate"),
      deps,
    );

    expect(reply.isError).toBeUndefined();
    expect(reply.text).toContain("旅伴模式已开启");
    expect(reply.text).toContain("现在直接告诉旅伴一个想去的目的地就行");
    expect(runtime.messenger.sentReplies).toHaveLength(1);
    expect(runtime.messenger.sentReplies[0]?.text?.length ?? 0).toBeGreaterThan(
      0,
    );
    const state = await runtime.conversationStateRepository.getByKey(
      keyForDefaultChat(),
    );
    expect(state?.awaitingDestination).toBe(true);
    expect(state?.idleGuideSentAt).toBeTruthy();
  });

  it("creates a persona from an image URL pasted in the setup command after locale is selected", async () => {
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
      createTelegramContext("/elsewhere activate"),
      deps,
    );
    await seedSystemLocale(runtime, keyForDefaultChat());

    const reply = await handleTravelCompanionCommand(
      createTelegramContext(
        "/elsewhere setup --name Mori --home-city Hong-Kong --traits gentle,curious --tone warm --relationship soulmate --user-address baby https://example.com/mori.webp",
      ),
      deps,
    );

    expect(reply.text).toContain("Mori 创建完成。");
    const binding = await bindings.get(keyForDefaultChat());
    expect(binding?.defaultPersonaId).toBeTruthy();

    const persona = await runtime.personaRepository.getById(binding!.defaultPersonaId!);
    expect(persona?.referenceImageAsset).toContain(
      join(runtime.paths.personasDir, "reference-assets"),
    );
    await expect(stat(persona!.referenceImageAsset)).resolves.toBeTruthy();
  });

  it("starts interactive setup wizard after locale is selected", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const deps = createDeps(runtime, bindings);

    await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere activate"),
      deps,
    );
    await seedSystemLocale(runtime, keyForDefaultChat());

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere setup"),
      deps,
    );

    expect(reply.text).toContain("我们先来创建您的旅伴");
    expect(reply.text).toContain("准备好了就回复 1");
    const state = await runtime.conversationStateRepository.getByKey(
      keyForDefaultChat(),
    );
    expect(state?.setupSession?.step).toBe("persona_intro");
  });

  it("uses /elsewhere setup as the unified first-time entry and continues with model setup when persona already exists", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const deps = createDeps(runtime, bindings);

    await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere activate"),
      deps,
    );
    await seedSystemLocale(runtime, keyForDefaultChat());

    const persona = await runtime.service.createPersona({
      name: "Mori",
      originCity: "Osaka",
      traits: ["gentle", "curious"],
      relationship: "soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });
    const binding = await bindings.get(keyForDefaultChat());
    await bindings.upsert({
      ...binding!,
      defaultPersonaId: persona.personaId,
    });

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere setup"),
      deps,
    );

    expect(reply.text).toContain("OpenClaw");
    const state = await runtime.conversationStateRepository.getByKey(
      keyForDefaultChat(),
    );
    expect(state?.setupSession?.kind).toBe("model");
    expect(state?.setupSession?.step).toBe("text_provider");
  });

  it("continues onboarding with model setup when setup is called again and only model config is missing", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const deps = createDeps(runtime, bindings);

    await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere activate"),
      deps,
    );
    await seedSystemLocale(runtime, keyForDefaultChat());

    const persona = await runtime.service.createPersona({
      name: "Mori",
      originCity: "Osaka",
      traits: ["gentle", "curious"],
      relationship: "soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });
    const binding = await bindings.get(keyForDefaultChat());
    await bindings.upsert({
      ...binding!,
      defaultPersonaId: persona.personaId,
    });

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere setup"),
      deps,
    );

    const state = await runtime.conversationStateRepository.getByKey(
      keyForDefaultChat(),
    );
    expect(state?.setupSession?.kind).toBe("model");
    expect(state?.setupSession?.step).toBe("text_provider");
    expect(reply.text).toContain("OpenClaw");
  });

  it("starts model-only setup flow", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const deps = createDeps(runtime, bindings);

    await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere activate"),
      deps,
    );
    await seedSystemLocale(runtime, keyForDefaultChat());

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere model"),
      deps,
    );

    expect(reply.text).toContain("OpenClaw");
    const state = await runtime.conversationStateRepository.getByKey(
      keyForDefaultChat(),
    );
    expect(state?.setupSession?.kind).toBe("model");
    expect(state?.setupSession?.forceGeminiReconfigure).toBe(true);
    expect(state?.setupSession?.step).toBe("text_provider");
  });

  it("forces delayed replies and the next trip step immediately when tick is used", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const deps = createDeps(runtime, bindings);
    await seedCompletedOnboarding(runtime);

    await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere activate"),
      deps,
    );
    await seedSystemLocale(runtime, keyForDefaultChat());

    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle", "curious"],
      relationship: "soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });
    const binding = await bindings.get(keyForDefaultChat());
    await bindings.upsert({
      ...binding!,
      defaultPersonaId: persona.personaId,
    });

    await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere start --to Tokyo"),
      deps,
    );
    await runtime.service.runDueTrips();
    await runtime.conversationService.enqueueInboundMessage({
      binding: (await bindings.get(keyForDefaultChat()))!,
      messageId: "msg-1",
      content: "hello",
      senderId: "1459473177",
    });

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere tick"),
      deps,
    );

    expect(reply.text).toContain("reply: 已处理待发送回复");
    expect(runtime.messenger.sentReplies).toHaveLength(1);
    expect(runtime.messenger.sentMessages.length).toBeGreaterThanOrEqual(2);
  });

  it("forces only delayed replies immediately when tick-reply is used", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const deps = createDeps(runtime, bindings);
    await seedCompletedOnboarding(runtime);

    await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere activate"),
      deps,
    );
    await seedSystemLocale(runtime, keyForDefaultChat());

    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle", "curious"],
      relationship: "soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });
    const binding = await bindings.get(keyForDefaultChat());
    await bindings.upsert({
      ...binding!,
      defaultPersonaId: persona.personaId,
    });

    await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere start --to Tokyo"),
      deps,
    );
    const tripBefore = await runtime.tripRepository.listDueTrips(
      new Date("9999-01-01T00:00:00.000Z"),
    );
    await runtime.service.runDueTrips();
    await runtime.conversationService.enqueueInboundMessage({
      binding: (await bindings.get(keyForDefaultChat()))!,
      messageId: "msg-reply-only",
      content: "ping",
      senderId: "1459473177",
    });
    const sentPostcardsBefore = runtime.messenger.sentMessages.length;

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere tick-reply"),
      deps,
    );

    expect(reply.text).toContain("reply: 已处理待发送回复");
    expect(reply.text).toContain("trip: 未推进");
    expect(runtime.messenger.sentReplies).toHaveLength(1);
    expect(runtime.messenger.sentMessages.length).toBe(sentPostcardsBefore);
    const tripAfter = await runtime.tripRepository.getById(tripBefore[0]!.tripId);
    expect(tripAfter?.timelineIndex).toBe(1);
  });

  it("reports that tick is already in progress instead of echoing a stale planned state", async () => {
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
      lastTripId: "trip-in-flight",
      mode: "companion-exclusive",
    });

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere tick"),
      {
        service: {
          isTripInFlight() {
            return true;
          },
          async runTrip() {
            throw new Error("runTrip should not be called while trip is in flight");
          },
        } as never,
        conversationService: {
          async runConversation() {},
        } as never,
        tripRepository: {
          async getById() {
            return {
              tripId: "trip-in-flight",
              state: {
                status: "planned",
                currentPhase: "planning",
                currentDay: 1,
                nextRunAt: "2026-04-20T04:02:07.299Z",
                pendingPostcard: null,
                artifacts: [],
                activeStateAnchor: null,
              },
            };
          },
        } as never,
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

    expect(reply.isError).toBeUndefined();
    expect(reply.text).toContain("已收到 tick：trip-in-flight");
    expect(reply.text).toContain("trip: 当前步骤已在处理中");
    expect(reply.text).toContain("phase: planning");
    expect(reply.text).not.toContain("status: planned");
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
      createTelegramContext("/elsewhere activate"),
      deps,
    );
    await seedSystemLocale(runtime, keyForDefaultChat());

    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle", "curious"],
      relationship: "soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });
    const binding = await bindings.get(keyForDefaultChat());
    await bindings.upsert({
      ...binding!,
      defaultPersonaId: persona.personaId,
    });

    await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere start --to Tokyo"),
      deps,
    );
    await runtime.service.runDueTrips();
    await runtime.conversationService.enqueueInboundMessage({
      binding: (await bindings.get(keyForDefaultChat()))!,
      messageId: "msg-status",
      content: "status-check",
      senderId: "1459473177",
    });

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere status"),
      deps,
    );

    expect(reply.text).toContain("conversationMode: companion-exclusive");
    expect(reply.text).toContain("bindingSource: official");
    expect(reply.text).toContain("systemLocale: zh-CN");
    expect(reply.text).toContain("pendingReplyCount: 1");
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
      createTelegramContext("/elsewhere activate"),
      deps,
    );
    await seedSystemLocale(runtime, keyForDefaultChat());

    const persona = await runtime.service.createPersona({
      name: "Mori",
      homeCity: "Hong Kong",
      traits: ["gentle", "curious"],
      relationship: "soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });
    const binding = await bindings.get(keyForDefaultChat());
    await bindings.upsert({
      ...binding!,
      defaultPersonaId: persona.personaId,
    });

    const startReply = await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere start --to Tokyo"),
      deps,
    );
    const tripId = startReply.text.match(/行程已创建：([^\n]+)/u)?.[1];
    expect(tripId).toBeTruthy();

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/elsewhere deactivate"),
      deps,
    );

    expect(reply.text).toContain("旅伴模式已关闭");
    const trip = await runtime.tripRepository.getById(tripId!);
    expect(trip?.state.status).toBe("completed");

    const updatedBinding = await bindings.get(keyForDefaultChat());
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
      createTelegramContext("/elsewhere tick"),
      {
        service: {
          isTripInFlight() {
            return false;
          },
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
    expect(reply.text).toContain("已尝试 tick：trip-1");
    expect(reply.text).not.toContain("Config warnings");
  });
});
