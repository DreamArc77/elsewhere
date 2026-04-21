import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import { handleTravelCompanionCommand } from "./src/openclaw-plugin/command.js";
import { BindingRegistryStore } from "./src/openclaw-plugin/binding-state.js";
import {
  LEGACY_COMMAND_NAME,
  PRIMARY_COMMAND_NAME,
} from "./src/openclaw-plugin/command-alias.js";
import { resolvePluginConfig } from "./src/openclaw-plugin/config.js";
import { createRuntimeBundle, startPollingService } from "./src/openclaw-plugin/service.js";
import {
  handleTravelCompanionBeforeDispatch,
  handleTravelCompanionInboundClaim,
} from "./src/openclaw-plugin/hooks.js";

export default definePluginEntry({
  id: "openclaw-travel-companion",
  name: "elsewhere",
  description: "A companion travel plugin with proactive postcards and delayed chat.",
  configSchema: {
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        geminiApiKey: { type: "string" },
        openrouterApiKey: { type: "string" },
        defaultOriginCity: { type: "string" },
        pollIntervalSeconds: { type: "integer", minimum: 15, maximum: 3600 },
        openclawBinaryPath: { type: "string" },
        planningModel: { type: "string" },
        textModel: { type: "string" },
        imageModel: { type: "string" },
        geminiBaseUrl: { type: "string" },
        openrouterBaseUrl: { type: "string" },
        logMode: { type: "string", enum: ["safe", "debug"] },
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
          service: runtimeBundle.service,
          tripRepository: runtimeBundle.tripRepository,
          personaRepository: runtimeBundle.personaRepository,
          conversationStates: runtimeBundle.conversationStateRepository,
          globalConfigRepository: runtimeBundle.globalConfigRepository,
          messenger: runtimeBundle.messenger,
          pluginConfig,
          runtimeDataPaths: runtimeBundle.runtimeDataPaths,
          runtimeVersion: api.runtime.version,
          logger: runtimeBundle.logger,
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

    api.on("before_dispatch", async (event, ctx) => {
      try {
        const runtimeBundle = await getRuntimeBundle();
        return await handleTravelCompanionBeforeDispatch(event, ctx, {
          bindings,
          conversationService: runtimeBundle.conversationService,
          service: runtimeBundle.service,
          tripRepository: runtimeBundle.tripRepository,
          personaRepository: runtimeBundle.personaRepository,
          conversationStates: runtimeBundle.conversationStateRepository,
          globalConfigRepository: runtimeBundle.globalConfigRepository,
          messenger: runtimeBundle.messenger,
          pluginConfig,
          runtimeDataPaths: runtimeBundle.runtimeDataPaths,
          runtimeVersion: api.runtime.version,
          logger: runtimeBundle.logger,
        });
      } catch (error) {
        api.logger.warn(
          `Travel companion before-dispatch takeover failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }
    });

    const registerCompanionCommand = (
      name: string,
      description: string,
      progressMessage: string,
    ) => {
      api.registerCommand({
        name,
        nativeNames: { default: name },
        nativeProgressMessages: { default: progressMessage },
        description,
        acceptsArgs: true,
        requireAuth: true,
        async handler(ctx) {
          try {
            const runtimeBundle = await getRuntimeBundle();
            return await handleTravelCompanionCommand(ctx, {
              service: runtimeBundle.service,
              conversationService: runtimeBundle.conversationService,
              tripRepository: runtimeBundle.tripRepository,
              personaRepository: runtimeBundle.personaRepository,
              conversationStates: runtimeBundle.conversationStateRepository,
              globalConfigRepository: runtimeBundle.globalConfigRepository,
              messenger: runtimeBundle.messenger,
              bindings,
              pluginConfig,
              runtimeDataPaths: runtimeBundle.runtimeDataPaths,
              runtimeVersion: api.runtime.version,
              logger: runtimeBundle.logger,
            });
          } catch (error) {
            return {
              text: "This action could not be completed right now. Please try again later.",
              isError: true,
            };
          }
        },
      });
    };

    registerCompanionCommand(
      PRIMARY_COMMAND_NAME,
      "Set up your companion, configure models, and manage trips.",
      "elsewhere is getting ready...",
    );
    registerCompanionCommand(
      LEGACY_COMMAND_NAME,
      "Legacy alias for elsewhere.",
      "elsewhere is getting ready...",
    );
  },
});
