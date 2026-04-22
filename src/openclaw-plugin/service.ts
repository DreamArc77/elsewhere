import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";

import { CompanionConversationService } from "../application/companion-conversation-service.js";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginRuntime } from "openclaw/plugin-sdk/plugin-runtime";

import { OpenClawTravelCompanionService } from "../application/openclaw-travel-companion-service.js";
import {
  ClockPort,
  ConversationBindingStore,
  GlobalConfigRepository,
  HostMessengerPort,
  LoggerPort,
  PersonaRepository,
  TripRepository,
} from "../domain/types.js";
import { GeminiRestGroundingAdapter, GeminiRestImageAdapter } from "../infrastructure/gemini-rest-adapters.js";
import {
  JsonArtifactStore,
  JsonConversationStateRepository,
  JsonGlobalConfigRepository,
  JsonPersonaRepository,
  JsonTripRepository,
  RuntimeDataPaths,
  ensureRuntimeDataPaths,
} from "../infrastructure/json-file-repositories.js";
import { JsonlFileLogger } from "../infrastructure/jsonl-file-logger.js";
import { BindingRegistryStore } from "./binding-state.js";
import { TravelCompanionPluginConfig } from "./config.js";
import { resolveConfiguredGeminiProvider } from "./gemini-provider-config.js";
import { getSystemCatalog, getSystemLocale } from "./i18n/catalog.js";
import { completeSetupReferencePhotoFromSource } from "./hooks.js";
import { MessageCommandRunner, NoopSchedulerPort, OpenClawCliMessengerPort } from "./ports.js";

export interface RuntimeBundle {
  service: OpenClawTravelCompanionService;
  conversationService: CompanionConversationService;
  tripRepository: TripRepository;
  personaRepository: PersonaRepository;
  globalConfigRepository: GlobalConfigRepository;
  conversationStateRepository: JsonConversationStateRepository;
  bindings: ConversationBindingStore;
  messenger: HostMessengerPort;
  runtimeDataPaths: RuntimeDataPaths;
  pluginConfig: TravelCompanionPluginConfig;
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
  const globalConfigRepository = new JsonGlobalConfigRepository(
    runtimeDataPaths.configPath,
  );
  const artifactStore = new JsonArtifactStore(runtimeDataPaths.artifactsDir);
  const logger = new JsonlFileLogger(
    runtimeDataPaths.logsDir,
    input.pluginConfig.logMode ?? "safe",
  );
  const bindings = new BindingRegistryStore(runtimeRoot);

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

  let service!: OpenClawTravelCompanionService;
  let conversationService!: CompanionConversationService;

  const startTripFromIdleDestination = async (input2: {
    binding: {
      key: string;
      bindingId?: string;
      channel: string;
      accountId?: string;
      target: string;
      parentConversationId?: string;
      threadId?: string | number;
      boundAt?: number;
      defaultPersonaId?: string;
      mode: "default" | "companion-exclusive";
      lastTripId?: string;
    };
    destination: string;
  }) => {
    const personaId = input2.binding.defaultPersonaId;
    if (!personaId) {
      throw new Error("No default persona is configured for idle destination start.");
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
        input.pluginConfig.defaultOriginCity ??
        "Hong Kong",
      destinationCity: input2.destination,
    });

    const patchedTrip = {
      ...trip,
      deliveryBinding: {
        bindingId: input2.binding.bindingId,
        channel: input2.binding.channel,
        accountId: input2.binding.accountId,
        target: input2.binding.target,
        parentConversationId: input2.binding.parentConversationId,
        threadId: input2.binding.threadId,
        boundAt: input2.binding.boundAt,
      },
    };
    await tripRepository.save(patchedTrip);
    await bindings.upsert({
      ...input2.binding,
      mode: "companion-exclusive",
      defaultPersonaId: personaId,
      lastTripId: patchedTrip.tripId,
    });
    return patchedTrip;
  };

  service = new OpenClawTravelCompanionService({
    personaRepository,
    tripRepository,
    artifactStore,
    scheduler: new NoopSchedulerPort(),
    messenger,
    grounding: new GeminiRestGroundingAdapter({
      geminiProviderResolver: async () =>
        resolveConfiguredGeminiProvider({
          globalConfig: await globalConfigRepository.get(),
          pluginConfig: input.pluginConfig,
        }),
      textProviderResolver: async () =>
        (await globalConfigRepository.get()).textProvider,
      runtime: input.runtime,
      planningModel: input.pluginConfig.planningModel,
      textModel: input.pluginConfig.textModel,
      logger,
    }),
    imageGeneration: new GeminiRestImageAdapter({
      geminiProviderResolver: async () =>
        resolveConfiguredGeminiProvider({
          globalConfig: await globalConfigRepository.get(),
          pluginConfig: input.pluginConfig,
        }),
      imageModel: input.pluginConfig.imageModel,
      logger,
    }),
    clock: new SystemClockPort(),
    logger,
    hooks: {
      afterMessageSent: async (record) => {
        const pending = record.pendingDispatch;
        if (!pending?.postcard) {
          return;
        }

        const allBindings = await bindings.list();
        const targetBindings = allBindings.filter(
          (binding) => binding.lastTripId === record.tripId,
        );

        for (const binding of targetBindings) {
          const state = await conversationStateRepository.getByKey(binding.key);
          if (!state) {
            continue;
          }

          const nextState = {
            ...state,
            latestPostcardPhoto: {
              tripId: record.tripId,
              sentAt: new Date().toISOString(),
              shotKind: pending.shotKind,
              caption: pending.postcard.caption,
              imageSummary: pending.imageSummary,
            },
            updatedAt: new Date().toISOString(),
          };
          await conversationStateRepository.save(nextState);
          if (
            pending.phase === "planning" &&
            state.pendingPlanningPostcardTripId === record.tripId
          ) {
            await conversationService.completePlanningPostcardGate({
              conversationKey: binding.key,
              tripId: record.tripId,
            });
            const refreshed =
              await conversationStateRepository.getByKey(binding.key);
            if (refreshed?.pendingReplyDispatch) {
              await conversationService.runConversation(binding.key, {
                ignoreSchedule: true,
              });
            }
          }
        }
      },
      afterTripCompleted: async (record) => {
        const allBindings = await bindings.list();
        const targetBindings = allBindings.filter(
          (binding) => binding.lastTripId === record.tripId,
        );

        for (const binding of targetBindings) {
          const nextBinding = {
            ...binding,
            lastTripId: undefined,
          };
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
      if (step.phase !== "planning") {
        return null;
      }

      const allBindings = await bindings.list();
      const targetBinding = allBindings.find(
        (binding) => binding.lastTripId === record.tripId,
      );
      if (!targetBinding) {
        return null;
      }

      const state = await conversationStateRepository.getByKey(targetBinding.key);
      return {
        planningSilentUserMessages: state?.planningSilentUserMessages ?? [],
        locale: state?.systemLocale ?? "zh-CN",
      };
    },
  });
  conversationService = new CompanionConversationService({
    bindings,
    conversationStates: conversationStateRepository,
    tripRepository,
    personaRepository,
    grounding: new GeminiRestGroundingAdapter({
      geminiProviderResolver: async () =>
        resolveConfiguredGeminiProvider({
          globalConfig: await globalConfigRepository.get(),
          pluginConfig: input.pluginConfig,
        }),
      textProviderResolver: async () =>
        (await globalConfigRepository.get()).textProvider,
      runtime: input.runtime,
      planningModel: input.pluginConfig.planningModel,
      textModel: input.pluginConfig.textModel,
      logger,
    }),
    messenger,
    clock: new SystemClockPort(),
    logger,
    triggerPlanningPostcard: async (tripId) => {
      await service.runTrip(tripId, { ignoreSchedule: true });
    },
    idleDestinationStarter: async ({ binding, destination }) =>
      await startTripFromIdleDestination({ binding, destination }),
  });

  input.logger.info("OpenClaw Travel Companion runtime ready.");

  return {
    service,
    conversationService,
    tripRepository,
    personaRepository,
    globalConfigRepository,
    conversationStateRepository,
    bindings,
    messenger,
    runtimeDataPaths,
    pluginConfig: input.pluginConfig,
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
  let probeInterval: NodeJS.Timeout | undefined;
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
          await runPendingReferencePhotoFallback({
            bundle,
            stateDir: input.stateDir,
          });
          await bundle.conversationService.runDueIdleGuides();
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
      probeInterval = setInterval(() => {
        void runPendingReferencePhotoFallback({
          bundle,
          stateDir: input.stateDir,
        }).catch((error) => {
          input.logger.error(
            `Travel companion reference photo probe failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      }, 1_500);
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
      if (probeInterval) {
        clearInterval(probeInterval);
      }
    },
  };
}

type InboundMediaCandidate = {
  path: string;
  mtimeMs: number;
};

const IMAGE_FILE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export async function runPendingReferencePhotoFallback(input: {
  bundle: RuntimeBundle;
  stateDir: string;
}): Promise<void> {
  const states = await input.bundle.conversationStateRepository.listAll();
  const pendingStates = states.filter(
    (state) =>
      state.mode === "companion-exclusive" &&
      state.setupSession?.kind === "persona" &&
      state.setupSession.step === "reference_photo" &&
      state.setupSession.awaitingReferencePhoto,
  );
  if (pendingStates.length === 0) {
    return;
  }

  const mediaDir = join(input.stateDir, "media", "inbound");
  const mediaCandidates = await listInboundMediaCandidates(mediaDir);

  const claimed = new Set<string>();
  for (const state of pendingStates) {
    const binding = await input.bundle.bindings.get(state.conversationKey);
    if (!binding) {
      continue;
    }

    const sessionUpdatedAt = new Date(
      state.setupSession?.updatedAt ?? state.updatedAt,
    ).getTime();
    const eligible = mediaCandidates
      .filter((candidate) => !claimed.has(candidate.path))
      .filter((candidate) => candidate.mtimeMs >= sessionUpdatedAt - 5_000)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    const candidate = eligible[0];
    if (candidate) {
      claimed.add(candidate.path);
      await input.bundle.logger.log({
        tripId: `conversation:${binding.key}`,
        runId: `setup-photo-fallback:${Date.now()}`,
        phase: "system",
        event: "setup.photo.media_fallback.detected",
        decision:
          "Detected a newly saved inbound media file while setup was waiting for a reference photo.",
        provider: "setup-session",
        status: "success",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        latencyMs: 0,
        details: {
          conversationKey: binding.key,
          source: candidate.path,
          mediaAgeMs: Math.max(0, Date.now() - candidate.mtimeMs),
        },
      });

      await completeSetupReferencePhotoFromSource({
        binding,
        state,
        deps: {
          bindings: input.bundle.bindings,
          conversationService: input.bundle.conversationService,
          service: input.bundle.service,
          tripRepository: input.bundle.tripRepository,
          personaRepository: input.bundle.personaRepository,
          conversationStates: input.bundle.conversationStateRepository,
          globalConfigRepository: input.bundle.globalConfigRepository,
          messenger: input.bundle.messenger,
          pluginConfig: input.bundle.pluginConfig,
          runtimeDataPaths: input.bundle.runtimeDataPaths,
          logger: input.bundle.logger,
        },
        runId: `setup-photo-fallback:${Date.now()}`,
        imageSource: candidate.path,
        sourceKind: "media-inbound-fallback",
      });
      continue;
    }

    const probe = state.pendingReferencePhotoProbe;
    if (!probe?.deadlineAt || probe.fallbackSentAt) {
      continue;
    }
    if (new Date(probe.deadlineAt).getTime() > Date.now()) {
      continue;
    }

    const locale = getSystemLocale(state);
    await input.bundle.messenger.sendTextReply({
      binding,
      text: getSystemCatalog(locale).setup.errorWaitingForPhotoWithFallback,
      dedupeKey: `setup-photo-reminder:${binding.key}:${probe.startedAt}`,
    });
    await input.bundle.conversationStateRepository.save({
      ...state,
      pendingReferencePhotoProbe: {
        ...probe,
        fallbackSentAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    });
  }
}

async function listInboundMediaCandidates(
  mediaDir: string,
): Promise<InboundMediaCandidate[]> {
  let entries;
  try {
    entries = await readdir(mediaDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .filter((entry) =>
        IMAGE_FILE_EXTENSIONS.has(extname(entry.name).toLowerCase()),
      )
      .map(async (entry) => {
        const path = join(mediaDir, entry.name);
        const fileStat = await stat(path);
        return {
          path,
          mtimeMs: fileStat.mtimeMs,
        };
      }),
  );

  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
}
