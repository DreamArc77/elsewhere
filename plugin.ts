import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import { handleTravelCompanionCommand } from "./src/openclaw-plugin/command.js";
import { BindingRegistryStore } from "./src/openclaw-plugin/binding-state.js";
import { resolvePluginConfig } from "./src/openclaw-plugin/config.js";
import { createRuntimeBundle, startPollingService } from "./src/openclaw-plugin/service.js";
import { handleTravelCompanionInboundClaim } from "./src/openclaw-plugin/hooks.js";

export default definePluginEntry({
  id: "openclaw-travel-companion",
  name: "OpenClaw Travel Companion",
  description: "Travel-frog-style soulmate travel companion with proactive postcards.",
  configSchema: {
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        geminiApiKey: { type: "string" },
        defaultOriginCity: { type: "string" },
        pollIntervalSeconds: { type: "integer", minimum: 15, maximum: 3600 },
        openclawBinaryPath: { type: "string" },
        planningModel: { type: "string" },
        textModel: { type: "string" },
        imageModel: { type: "string" },
      },
    },
    validate(value) {
      if (!value || typeof value !== "object") {
        return { ok: true, value: {} };
      }
      return { ok: true, value };
    },
  },
  register(api) {
    const pluginConfig = resolvePluginConfig(api.pluginConfig);
    const stateDir = api.runtime.state.resolveStateDir();
    const pluginStateDir = `${stateDir}/openclaw-travel-companion`;
    const bindings = new BindingRegistryStore(pluginStateDir);
    let runtimeBundlePromise:
      | ReturnType<typeof createRuntimeBundle>
      | undefined;
    const getRuntimeBundle = () => {
      runtimeBundlePromise ??= createRuntimeBundle({
        stateDir,
        pluginConfig,
        runtime: api.runtime,
        logger: api.logger,
      });
      return runtimeBundlePromise;
    };

    api.registerService({
      id: "openclaw-travel-companion-worker",
      start() {
        const control = startPollingService({
          stateDir,
          pluginConfig,
          runtime: api.runtime,
          logger: api.logger,
        });
        serviceStop = control.stop;
      },
      stop() {
        serviceStop?.();
      },
    });

    let serviceStop: (() => void) | undefined;

    api.on("inbound_claim", async (event, ctx) => {
      try {
        const runtimeBundle = await getRuntimeBundle();
        return await handleTravelCompanionInboundClaim(event, ctx, {
          bindings,
          conversationService: runtimeBundle.conversationService,
        });
      } catch (error) {
        api.logger.warn(
          `Travel companion inbound claim failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }
    });

    api.registerCommand({
      name: "travel-companion",
      nativeNames: { default: "travel-companion" },
      nativeProgressMessages: { default: "Travel companion is getting organized..." },
      description: "Bind a conversation, create a persona, and start or inspect trips.",
      acceptsArgs: true,
      requireAuth: true,
      async handler(ctx) {
        try {
          const runtimeBundle = await getRuntimeBundle();
          return await handleTravelCompanionCommand(ctx, {
            service: runtimeBundle.service,
            conversationService: runtimeBundle.conversationService,
            tripRepository: runtimeBundle.tripRepository,
            bindings,
            pluginConfig,
            runtimeDataPaths: runtimeBundle.runtimeDataPaths,
            logger: runtimeBundle.logger,
          });
        } catch (error) {
          return {
            text:
              error instanceof Error
                ? error.message
                : `Travel companion failed: ${String(error)}`,
            isError: true,
          };
        }
      },
    });
  },
});
