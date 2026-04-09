import { stat } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, afterEach } from "vitest";
import type { PluginCommandContext } from "openclaw/plugin-sdk/plugin-entry";

import { handleTravelCompanionCommand } from "../src/openclaw-plugin/command.js";
import {
  BindingRegistryStore,
  bindingKey,
} from "../src/openclaw-plugin/binding-state.js";
import { createTestRuntime } from "./helpers/runtime.js";

function createTelegramContext(commandBody: string): PluginCommandContext {
  const [commandName, ...rest] = commandBody.trim().split(/\s+/u);
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
      status: "error",
      message: "requestConversationBinding should not be used in this test",
    }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
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
      {
        service: runtime.service,
        tripRepository: runtime.tripRepository,
        bindings,
        pluginConfig: {
          geminiApiKey: "test-key",
          defaultOriginCity: "Hong Kong",
          pollIntervalSeconds: 60,
          openclawBinaryPath: "openclaw",
        },
        runtimeDataPaths: runtime.paths,
      },
    );

    expect(reply.isError).toBeUndefined();
    expect(reply.text).toContain("Binding complete.");

    const binding = await bindings.get(
      bindingKey({
        channel: "telegram",
        accountId: "default",
        target: "1459473177",
      }),
    );
    expect(binding?.target).toBe("1459473177");
  });

  it("creates a persona from an image URL pasted in the setup command", async () => {
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

    const reply = await handleTravelCompanionCommand(
      createTelegramContext(
        "/travel-companion setup --name Mori --traits gentle,curious --relationship soulmate --tone warm https://example.com/mori.webp",
      ),
      {
        service: runtime.service,
        tripRepository: runtime.tripRepository,
        bindings,
        pluginConfig: {
          geminiApiKey: "test-key",
          defaultOriginCity: "Hong Kong",
          pollIntervalSeconds: 60,
          openclawBinaryPath: "openclaw",
        },
        runtimeDataPaths: runtime.paths,
      },
    );

    expect(reply.text).toContain("Persona created: Mori");
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

  it("forces the next trip step immediately when tick is used", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const deps = {
      service: runtime.service,
      tripRepository: runtime.tripRepository,
      bindings,
      pluginConfig: {
        geminiApiKey: "test-key",
        defaultOriginCity: "Hong Kong",
        pollIntervalSeconds: 60,
        openclawBinaryPath: "openclaw",
      },
      runtimeDataPaths: runtime.paths,
    };

    const persona = await runtime.service.createPersona({
      name: "Mori",
      traits: ["gentle", "curious"],
      relationship: "soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });
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
      defaultPersonaId: persona.personaId,
    });

    await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion start --to Tokyo"),
      deps,
    );
    await runtime.service.runDueTrips();
    expect(runtime.messenger.sentMessages).toHaveLength(1);

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion tick"),
      deps,
    );

    expect(reply.text).toContain("Ticked immediately:");
    expect(runtime.messenger.sentMessages).toHaveLength(2);
  });

  it("stops the current trip from the chat command", async () => {
    const runtime = await createTestRuntime();
    const bindings = new BindingRegistryStore(runtime.rootDir);
    const deps = {
      service: runtime.service,
      tripRepository: runtime.tripRepository,
      bindings,
      pluginConfig: {
        geminiApiKey: "test-key",
        defaultOriginCity: "Hong Kong",
        pollIntervalSeconds: 60,
        openclawBinaryPath: "openclaw",
      },
      runtimeDataPaths: runtime.paths,
    };

    const persona = await runtime.service.createPersona({
      name: "Mori",
      traits: ["gentle", "curious"],
      relationship: "soulmate",
      toneStyle: "warm",
      referenceImageAsset: runtime.referenceImagePath,
    });
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
      defaultPersonaId: persona.personaId,
    });

    const startReply = await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion start --to Tokyo"),
      deps,
    );
    const tripId = startReply.text.match(/Trip created: ([^\n]+)/u)?.[1];
    expect(tripId).toBeTruthy();

    const reply = await handleTravelCompanionCommand(
      createTelegramContext("/travel-companion stop"),
      deps,
    );

    expect(reply.text).toContain("Stopped:");
    const trip = await runtime.tripRepository.getById(tripId!);
    expect(trip?.state.status).toBe("completed");
    expect(trip?.state.nextRunAt).toBeNull();
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
        tripRepository: {} as never,
        bindings,
        pluginConfig: {
          geminiApiKey: "test-key",
          defaultOriginCity: "Hong Kong",
          pollIntervalSeconds: 60,
          openclawBinaryPath: "openclaw",
        },
        runtimeDataPaths: {
          rootDir: "C:\\temp",
          personasDir: "C:\\temp\\personas",
          tripsDir: "C:\\temp\\trips",
          artifactsDir: "C:\\temp\\artifacts",
          logsDir: "C:\\temp\\logs",
        },
      },
    );

    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("Tick attempted: trip-1");
    expect(reply.text).not.toContain("Config warnings");
  });
});
