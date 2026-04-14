import { join } from "node:path";

import { CompanionConversationService } from "../application/companion-conversation-service.js";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginRuntime } from "openclaw/plugin-sdk/plugin-runtime";

import { OpenClawTravelCompanionService } from "../application/openclaw-travel-companion-service.js";
import { ClockPort, HostMessengerPort, LoggerPort, TripRepository } from "../domain/types.js";
import { GeminiRestGroundingAdapter, GeminiRestImageAdapter } from "../infrastructure/gemini-rest-adapters.js";
import {
  JsonArtifactStore,
  JsonConversationStateRepository,
  JsonPersonaRepository,
  JsonTripRepository,
  RuntimeDataPaths,
  ensureRuntimeDataPaths,
} from "../infrastructure/json-file-repositories.js";
import { JsonlFileLogger } from "../infrastructure/jsonl-file-logger.js";
import { BindingRegistryStore } from "./binding-state.js";
import { TravelCompanionPluginConfig } from "./config.js";
import { MessageCommandRunner, NoopSchedulerPort, OpenClawCliMessengerPort } from "./ports.js";

export interface RuntimeBundle {
  service: OpenClawTravelCompanionService;
  conversationService: CompanionConversationService;
  tripRepository: TripRepository;
  messenger: HostMessengerPort;
  runtimeDataPaths: RuntimeDataPaths;
  logger: LoggerPort;
}

class SystemClockPort implements ClockPort {
  now(): Date {
    return new Date();
  }
}

export async function createRuntimeBundle(input: {
  stateDir: string;
  pluginConfig: TravelCompanionPluginConfig;
  runtime: PluginRuntime;
  logger: PluginLogger;
}): Promise<RuntimeBundle> {
  const runtimeRoot = join(input.stateDir, "openclaw-travel-companion");
  const runtimeDataPaths = await ensureRuntimeDataPaths(runtimeRoot);
  const personaRepository = new JsonPersonaRepository(runtimeDataPaths.personasDir);
  const tripRepository = new JsonTripRepository(runtimeDataPaths.tripsDir);
  const conversationStateRepository = new JsonConversationStateRepository(
    runtimeDataPaths.conversationsDir,
  );
  const artifactStore = new JsonArtifactStore(runtimeDataPaths.artifactsDir);
  const logger = new JsonlFileLogger(runtimeDataPaths.logsDir);
  const bindings = new BindingRegistryStore(runtimeRoot);

  const apiKey = input.pluginConfig.geminiApiKey;
  if (!apiKey) {
    throw new Error(
      "Gemini API key is required. Set plugins.entries.openclaw-travel-companion.config.geminiApiKey or GEMINI_API_KEY.",
    );
  }

  const commandRunner: MessageCommandRunner = {
    run: async (argv) => {
      const result = await input.runtime.system.runCommandWithTimeout(
        [input.pluginConfig.openclawBinaryPath ?? "openclaw", ...argv],
        { timeoutMs: 120_000 },
      );
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code,
      };
    },
  };

  const messenger = new OpenClawCliMessengerPort(
    tripRepository,
    commandRunner,
    {
      runtime: input.runtime,
      loadConfig: () => input.runtime.config.loadConfig(),
    },
    logger,
  );

  const service = new OpenClawTravelCompanionService({
    personaRepository,
    tripRepository,
    artifactStore,
    scheduler: new NoopSchedulerPort(),
    messenger,
    grounding: new GeminiRestGroundingAdapter({
      apiKey,
      planningModel: input.pluginConfig.planningModel,
      textModel: input.pluginConfig.textModel,
      logger,
    }),
    imageGeneration: new GeminiRestImageAdapter({
      apiKey,
      imageModel: input.pluginConfig.imageModel,
    }),
    clock: new SystemClockPort(),
    logger,
  });
  const conversationService = new CompanionConversationService({
    bindings,
    conversationStates: conversationStateRepository,
    tripRepository,
    personaRepository,
    grounding: new GeminiRestGroundingAdapter({
      apiKey,
      planningModel: input.pluginConfig.planningModel,
      textModel: input.pluginConfig.textModel,
      logger,
    }),
    messenger,
    clock: new SystemClockPort(),
    logger,
  });

  input.logger.info("OpenClaw Travel Companion runtime ready.");

  return {
    service,
    conversationService,
    tripRepository,
    messenger,
    runtimeDataPaths,
    logger,
  };
}

export function startPollingService(input: {
  stateDir: string;
  pluginConfig: TravelCompanionPluginConfig;
  runtime: PluginRuntime;
  logger: PluginLogger;
}): { stop: () => void } {
  let disposed = false;
  let interval: NodeJS.Timeout | undefined;
  let ticking = false;

  void createRuntimeBundle(input)
    .then((bundle) => {
      if (disposed) {
        return;
      }

      const tick = async () => {
        if (ticking) {
          return;
        }
        ticking = true;
        try {
          await bundle.service.runDueTrips();
          await bundle.conversationService.runDueConversations();
        } catch (error) {
          input.logger.error(
            `Travel companion background tick failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        } finally {
          ticking = false;
        }
      };

      interval = setInterval(
        tick,
        (input.pluginConfig.pollIntervalSeconds ?? 60) * 1000,
      );
      void tick();
    })
    .catch((error) => {
      input.logger.error(
        `Travel companion runtime failed to start: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });

  return {
    stop: () => {
      disposed = true;
      if (interval) {
        clearInterval(interval);
      }
    },
  };
}
