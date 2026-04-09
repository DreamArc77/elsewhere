import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import { handleTravelCompanionCommand } from "./src/openclaw-plugin/command.js";
import { BindingRegistryStore } from "./src/openclaw-plugin/binding-state.js";
import { resolvePluginConfig } from "./src/openclaw-plugin/config.js";
import { createRuntimeBundle, startPollingService } from "./src/openclaw-plugin/service.js";

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

    api.registerCommand({
      name: "travel-companion",
      nativeNames: { default: "travel-companion" },
      nativeProgressMessages: { default: "Travel companion is getting organized..." },
      description: "Bind a conversation, create a persona, and start or inspect trips.",
      acceptsArgs: true,
      requireAuth: true,
      async handler(ctx) {
        try {
          const runtimeBundle = await createRuntimeBundle({
            stateDir,
            pluginConfig,
            runtime: api.runtime,
            logger: api.logger,
          });
          return await handleTravelCompanionCommand(ctx, {
            service: runtimeBundle.service,
            tripRepository: runtimeBundle.tripRepository,
            bindings,
            pluginConfig,
            runtimeDataPaths: runtimeBundle.runtimeDataPaths,
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
