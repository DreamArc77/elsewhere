import { join } from "node:path";

import { CompanionConversationService } from "../../../src/application/companion-conversation-service.js";
import { ElsewhereService } from "../../../src/application/elsewhere-service.js";
import {
  JsonArtifactStore,
  JsonConversationStateRepository,
  JsonGlobalConfigRepository,
  JsonPersonaRepository,
  JsonTripRepository,
  ensureRuntimeDataPaths,
} from "../../../src/infrastructure/json-file-repositories.js";
import { JsonlFileLogger } from "../../../src/infrastructure/jsonl-file-logger.js";
import {
  GeminiRestGroundingAdapter,
  GeminiRestImageAdapter,
} from "../../../src/infrastructure/gemini-rest-adapters.js";
import { BindingRegistryStore } from "../../../src/openclaw-plugin/binding-state.js";
import { resolvePluginConfig } from "../../../src/openclaw-plugin/config.js";
import { resolveConfiguredGeminiProvider } from "../../../src/openclaw-plugin/gemini-provider-config.js";
import { NoopSchedulerPort } from "../../../src/openclaw-plugin/ports.js";
import type {
  ClockPort,
  ConversationBindingRecord,
  LoggerPort,
  TripRecord,
} from "../../../src/domain/types.js";
import type { SaasConfig } from "./config.js";
import type { SaasDataStore } from "./types.js";
import { TelegramMessengerPort } from "./telegram.js";

class SystemClockPort implements ClockPort {
  now(): Date {
    return new Date();
  }
}

export interface SaasRuntime {
  service: ElsewhereService;
  conversationService: CompanionConversationService;
  tripRepository: JsonTripRepository;
  personaRepository: JsonPersonaRepository;
  conversationStates: JsonConversationStateRepository;
  bindings: BindingRegistryStore;
  messenger: TelegramMessengerPort;
  logger: LoggerPort;
  tick(): Promise<void>;
}

export async function createSaasRuntime(input: {
  config: SaasConfig;
  store: SaasDataStore;
}): Promise<SaasRuntime> {
  const runtimeRoot = join(input.config.stateDir, "elsewhere-runtime");
  const paths = await ensureRuntimeDataPaths(runtimeRoot);
  const personaRepository = new JsonPersonaRepository(paths.personasDir);
  const tripRepository = new JsonTripRepository(paths.tripsDir);
  const conversationStates = new JsonConversationStateRepository(
    paths.conversationsDir,
  );
  const globalConfigRepository = new JsonGlobalConfigRepository(paths.configPath);
  const artifactStore = new JsonArtifactStore(paths.artifactsDir);
  const logger = new JsonlFileLogger(paths.logsDir, "safe");
  const bindings = new BindingRegistryStore(runtimeRoot);
  const pluginConfig = resolvePluginConfig(undefined);
  const messenger = new TelegramMessengerPort({
    store: input.store,
    tripRepository,
    encryptionKey: input.config.encryptionKey,
  });
  const clock = new SystemClockPort();

  let service!: ElsewhereService;
  let conversationService!: CompanionConversationService;

  const startTripFromIdleDestination = async (input2: {
    binding: ConversationBindingRecord;
    destination: string;
  }): Promise<TripRecord> => {
    const personaId = input2.binding.defaultPersonaId;
    if (!personaId) {
      throw new Error("No default persona is configured for Telegram chat.");
    }
    const persona = await personaRepository.getById(personaId);
    if (!persona) {
      throw new Error(`Persona not found: ${personaId}`);
    }
    const trip = await service.startTrip({
      personaId,
      originCity:
        persona.originCity ??
        persona.homeCity ??
        pluginConfig.defaultOriginCity ??
        "Hong Kong",
      destinationCity: input2.destination,
    });
    const patchedTrip: TripRecord = {
      ...trip,
      deliveryBinding: {
        bindingId: input2.binding.bindingId,
        bindingSource: "official",
        channel: input2.binding.channel,
        accountId: input2.binding.accountId,
        target: input2.binding.target,
        boundAt: input2.binding.boundAt,
      },
    };
    await tripRepository.save(patchedTrip);
    await bindings.upsert({
      ...input2.binding,
      lastTripId: patchedTrip.tripId,
      mode: "companion-exclusive",
    });
    return patchedTrip;
  };

  service = new ElsewhereService({
    personaRepository,
    tripRepository,
    artifactStore,
    scheduler: new NoopSchedulerPort(),
    messenger,
    grounding: new GeminiRestGroundingAdapter({
      geminiProviderResolver: async () =>
        resolveConfiguredGeminiProvider({
          globalConfig: await globalConfigRepository.get(),
          pluginConfig,
        }),
      textProviderResolver: async () => {
        const config = await globalConfigRepository.get();
        return config.textProvider ?? { kind: "gemini" };
      },
      planningModel: pluginConfig.planningModel,
      textModel: pluginConfig.textModel,
      logger,
    }),
    imageGeneration: new GeminiRestImageAdapter({
      geminiProviderResolver: async () =>
        resolveConfiguredGeminiProvider({
          globalConfig: await globalConfigRepository.get(),
          pluginConfig,
        }),
      imageModel: pluginConfig.imageModel,
      logger,
    }),
    clock,
    logger,
    hooks: {
      afterMessageSent: async (record, _receipt, pending) => {
        if (!pending.postcard) return;
        const allBindings = await bindings.list();
        for (const binding of allBindings.filter(
          (candidate) => candidate.lastTripId === record.tripId,
        )) {
          const state = await conversationStates.getByKey(binding.key);
          if (!state) continue;
          await conversationStates.save({
            ...state,
            latestPostcardPhoto: {
              tripId: record.tripId,
              sentAt: new Date().toISOString(),
              shotKind: pending.shotKind,
              caption: pending.postcard.caption,
              imageSummary: pending.imageSummary,
            },
            updatedAt: new Date().toISOString(),
          });
        }
      },
      afterTripCompleted: async (record) => {
        const allBindings = await bindings.list();
        for (const binding of allBindings.filter(
          (candidate) => candidate.lastTripId === record.tripId,
        )) {
          const nextBinding = { ...binding, lastTripId: undefined };
          await bindings.upsert(nextBinding);
          await conversationService.enterIdleAwaitingDestination({
            binding: nextBinding,
            sendGuideNow: false,
            clearConversationContext: true,
            reason: "trip_completed",
          });
        }
      },
    },
    resolveCaptionContext: async (record, step) => {
      const binding = (await bindings.list()).find(
        (candidate) => candidate.lastTripId === record.tripId,
      );
      if (!binding) return null;
      const state = await conversationStates.getByKey(binding.key);
      return {
        planningSilentUserMessages:
          step.phase === "planning"
            ? state?.planningSilentUserMessages ?? []
            : [],
        locale: state?.systemLocale ?? "zh-CN",
      };
    },
  });

  conversationService = new CompanionConversationService({
    bindings,
    conversationStates,
    tripRepository,
    personaRepository,
    grounding: new GeminiRestGroundingAdapter({
      geminiProviderResolver: async () =>
        resolveConfiguredGeminiProvider({
          globalConfig: await globalConfigRepository.get(),
          pluginConfig,
        }),
      textProviderResolver: async () => {
        const config = await globalConfigRepository.get();
        return config.textProvider ?? { kind: "gemini" };
      },
      planningModel: pluginConfig.planningModel,
      textModel: pluginConfig.textModel,
      logger,
    }),
    messenger,
    clock,
    logger,
    triggerPlanningPostcard: async (tripId) => {
      await service.runTrip(tripId, { ignoreSchedule: true });
    },
    idleDestinationStarter: startTripFromIdleDestination,
  });

  return {
    service,
    conversationService,
    tripRepository,
    personaRepository,
    conversationStates,
    bindings,
    messenger,
    logger,
    tick: async () => {
      await service.runDueTrips();
      await conversationService.runDueConversations();
      await conversationService.runDueIdleGuides();
    },
  };
}

