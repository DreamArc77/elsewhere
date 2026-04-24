import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import { handleTravelCompanionCommand } from "./src/openclaw-plugin/command.js";
import { BindingRegistryStore } from "./src/openclaw-plugin/binding-state.js";
import {
  DIRECT_SUBCOMMAND_ALIASES,
  LEGACY_COMMAND_NAME,
  PRIMARY_COMMAND_NAME,
} from "./src/openclaw-plugin/command-alias.js";
import {
  mergeLegacyPluginConfig,
  resolvePluginConfig,
} from "./src/openclaw-plugin/config.js";
import {
  PLUGIN_DESCRIPTION,
  PLUGIN_ID,
  PLUGIN_NAME,
  PLUGIN_WORKER_ID,
} from "./src/openclaw-plugin/metadata.js";
import { resolvePluginStateRootSync } from "./src/openclaw-plugin/runtime-paths.js";
import { createRuntimeBundle, startPollingService } from "./src/openclaw-plugin/service.js";
import {
  handleTravelCompanionBeforeDispatch,
  handleTravelCompanionInboundClaim,
} from "./src/openclaw-plugin/hooks.js";

export default definePluginEntry({
  id: PLUGIN_ID,
  name: PLUGIN_NAME,
  description: PLUGIN_DESCRIPTION,
  configSchema: {
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        geminiApiKey: { type: "string" },
        openaiApiKey: { type: "string" },
        openrouterApiKey: { type: "string" },
        defaultOriginCity: { type: "string" },
        pollIntervalSeconds: { type: "integer", minimum: 15, maximum: 3600 },
        openclawBinaryPath: { type: "string" },
        planningModel: { type: "string" },
        textModel: { type: "string" },
        imageModel: { type: "string" },
        geminiBaseUrl: { type: "string" },
        openaiBaseUrl: { type: "string" },
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
    const pluginConfig = resolvePluginConfig(
      mergeLegacyPluginConfig(api.pluginConfig, api.runtime.config.loadConfig()),
    );
    const stateDir = api.runtime.state.resolveStateDir();
    const pluginStateDir = resolvePluginStateRootSync(stateDir, api.logger);
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
      id: PLUGIN_WORKER_ID,
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
          `elsewhere inbound claim failed: ${
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
          `elsewhere before-dispatch takeover failed: ${
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
    for (const subcommand of DIRECT_SUBCOMMAND_ALIASES) {
      registerCompanionCommand(
        `${PRIMARY_COMMAND_NAME}-${subcommand}`,
        `Shortcut alias for /${PRIMARY_COMMAND_NAME} ${subcommand}.`,
        "elsewhere is getting ready...",
      );
      registerCompanionCommand(
        `${LEGACY_COMMAND_NAME}-${subcommand}`,
        `Legacy shortcut alias for /${PRIMARY_COMMAND_NAME} ${subcommand}.`,
        "elsewhere is getting ready...",
      );
    }
  },
});
