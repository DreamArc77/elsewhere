import type { PluginCommandContext } from "openclaw/plugin-sdk/plugin-entry";

import { CompanionConversationService } from "../application/companion-conversation-service.js";
import { OpenClawTravelCompanionService } from "../application/openclaw-travel-companion-service.js";
import type {
  ConversationBindingRecord,
  ConversationBindingStore,
  ConversationStateRepository,
  GlobalConfigRepository,
  HostMessengerPort,
  LoggerPort,
  PersonaRepository,
  SystemLocale,
  TripRecord,
  TripRepository,
} from "../domain/types.js";
import { RuntimeDataPaths } from "../infrastructure/json-file-repositories.js";
import { bindingKey } from "./binding-state.js";
import { PRIMARY_SLASH_COMMAND } from "./command-alias.js";
import {
  buildLocaleSelectionMenu,
  getSystemCatalog,
  getSystemLocale,
} from "./i18n/catalog.js";
import { TravelCompanionPluginConfig } from "./config.js";
import {
  formatChannelCapability,
  getChannelCapabilities,
} from "./channel-capabilities.js";
import { describeConfiguredGeminiProvider } from "./gemini-provider-config.js";
import {
  buildModelSetupDraft,
  buildOnboardingGateMessage,
  buildPersonaSetupDraft,
  createCompletedPersonaProfile,
  createSetupSession,
  evaluateOnboardingReadiness,
  renderSetupStepPrompt,
} from "./onboarding.js";
import {
  extractReferenceImageInput,
  materializeReferenceImage,
} from "./reference-image.js";

type CommandReply = { text: string; isError?: boolean };

interface CommandDependencies {
  service: OpenClawTravelCompanionService;
  conversationService: CompanionConversationService;
  tripRepository: TripRepository;
  personaRepository: PersonaRepository;
  conversationStates: ConversationStateRepository;
  globalConfigRepository: GlobalConfigRepository;
  messenger: HostMessengerPort;
  bindings: ConversationBindingStore;
  pluginConfig: TravelCompanionPluginConfig;
  runtimeDataPaths: RuntimeDataPaths;
  logger?: LoggerPort;
}

type ParsedArgs = {
  subcommand: string;
  options: Record<string, string>;
};

export async function handleTravelCompanionCommand(
  ctx: PluginCommandContext,
  deps: CommandDependencies,
): Promise<CommandReply> {
  const parsed = parseArgs(ctx.args);

  switch (parsed.subcommand) {
    case "bind":
      return bindConversation(ctx, deps);
    case "activate":
      return activateConversation(ctx, deps);
    case "deactivate":
      return deactivateConversation(ctx, deps);
    case "setup":
      return requireActivatedThen(ctx, deps, () =>
        setupPersona(ctx, parsed.options, deps, { mode: "edit" }),
      );
    case "create":
      return requireActivatedThen(ctx, deps, () =>
        setupPersona(ctx, parsed.options, deps, { mode: "create" }),
      );
    case "model":
      return requireActivatedThen(ctx, deps, () => setupModel(ctx, deps));
    case "start":
      return requireActivatedThen(ctx, deps, () =>
        startTrip(parsed.options, deps, ctx),
      );
    case "status":
      return requireActivatedThen(ctx, deps, () =>
        statusTrip(parsed.options, deps, ctx),
      );
    case "tick":
      return requireActivatedThen(ctx, deps, () =>
        tickTrip(parsed.options, deps, ctx),
      );
    case "tick-reply":
      return requireActivatedThen(ctx, deps, () => tickReply(deps, ctx));
    case "stop":
      return requireActivatedThen(ctx, deps, () =>
        stopTrip(parsed.options, deps, ctx),
      );
    default:
      return { text: helpText(undefined) };
  }
}

async function bindConversation(
  ctx: PluginCommandContext,
  deps: Pick<CommandDependencies, "bindings" | "logger">,
): Promise<CommandReply> {
  const binding = await ensurePluginConversationBinding(
    ctx,
    deps.bindings,
    "default",
    deps.logger,
  );
  if ("reply" in binding) {
    return binding.reply;
  }

  const catalog = getSystemCatalog(undefined);
  return {
    text: [catalog.command.bindSuccess, catalog.command.bindNextActivate].join(
      "\n",
    ),
  };
}

async function activateConversation(
  ctx: PluginCommandContext,
  deps: CommandDependencies,
): Promise<CommandReply> {
  const binding = await ensurePluginConversationBinding(
    ctx,
    deps.bindings,
    "companion-exclusive",
    deps.logger,
  );
  if ("reply" in binding) {
    return binding.reply;
  }

  const activatedBinding = {
    ...binding.record,
    mode: "companion-exclusive" as const,
  };
  await deps.bindings.upsert(activatedBinding);
  const activatedState =
    await deps.conversationService.activateConversation(activatedBinding);
  const state =
    (await deps.conversationStates.getByKey(activatedBinding.key)) ??
    activatedState;

  if (!state.systemLocale) {
    const nextState = {
      ...state,
      setupSession: createSetupSession({ kind: "locale" }),
      updatedAt: new Date().toISOString(),
    };
    await deps.conversationStates.save(nextState);
    await deps.logger?.log({
      tripId: `conversation:${activatedBinding.key}`,
      runId: `locale-selection:${Date.now()}`,
      phase: "system",
      event: "locale.selection.started",
      decision: "Started system locale selection during activate.",
      provider: "command",
      status: "success",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      latencyMs: 0,
      details: { conversationKey: activatedBinding.key },
    });
    return { text: buildLocaleSelectionMenu() };
  }

  const locale = getSystemLocale(state);
  const catalog = getSystemCatalog(locale);
  const globalConfig = await deps.globalConfigRepository.get();
  const readiness = evaluateOnboardingReadiness({
    binding: activatedBinding,
    config: globalConfig,
    fallbackGeminiApiKey: deps.pluginConfig.geminiApiKey,
    fallbackOpenRouterApiKey: deps.pluginConfig.openrouterApiKey,
  });
  await deps.logger?.log({
    tripId: `conversation:${activatedBinding.key}`,
    runId: `onboarding-check:${Date.now()}`,
    phase: "system",
    event: "onboarding.check",
    decision: "Checked whether onboarding is complete during activate.",
    provider: "command",
    status: "success",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    latencyMs: 0,
    details: {
      conversationKey: activatedBinding.key,
      hasPersona: readiness.hasPersona,
      hasTextProvider: readiness.hasTextProvider,
      hasGeminiKey: readiness.hasGeminiKey,
    },
  });

  if (!readiness.isComplete) {
    await deps.logger?.log({
      tripId: `conversation:${activatedBinding.key}`,
      runId: `config-gate:${Date.now()}`,
      phase: "system",
      event: "config.missing_gate_triggered",
      decision:
        "Blocked companion activation from entering idle because onboarding/config is incomplete.",
      provider: "command",
      status: "success",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      latencyMs: 0,
      details: {
        conversationKey: activatedBinding.key,
        hasPersona: readiness.hasPersona,
        hasTextProvider: readiness.hasTextProvider,
        hasGeminiKey: readiness.hasGeminiKey,
      },
    });
    return {
      text: [
        catalog.command.activateEnabled,
        catalog.onboarding.gateFirstTime,
      ].join("\n"),
    };
  }

  if (!activatedBinding.lastTripId && !state.awaitingDestination) {
    await deps.conversationService.enterIdleAwaitingDestination({
      binding: activatedBinding,
      sendGuideNow: true,
      reason: "activate",
    });
  }

  return {
    text: [catalog.command.activateEnabled, catalog.command.activateReady].join(
      "\n",
    ),
  };
}

async function deactivateConversation(
  ctx: PluginCommandContext,
  deps: CommandDependencies,
): Promise<CommandReply> {
  const binding = await requireBinding(ctx, deps.bindings, deps.logger);
  if ("reply" in binding) {
    return binding.reply;
  }

  const locale = await resolveLocaleForBinding(
    binding.record,
    deps.conversationStates,
  );
  const catalog = getSystemCatalog(locale);

  if (binding.record.lastTripId) {
    await deps.service.stopTrip(binding.record.lastTripId);
  }

  const nextBinding = {
    ...binding.record,
    mode: "default" as const,
    lastTripId: undefined,
  };
  await deps.bindings.upsert(nextBinding);
  await deps.conversationService.deactivateConversation(binding.record.key);
  await detachOfficialConversationBinding(ctx, binding.record, deps.logger);

  return {
    text: [
      catalog.command.deactivateClosed,
      catalog.command.deactivateTripStopped,
      catalog.command.deactivateDefaultAssistant,
    ].join("\n"),
  };
}

async function setupPersona(
  ctx: PluginCommandContext,
  options: Record<string, string>,
  deps: CommandDependencies,
  input: { mode: "edit" | "create" },
): Promise<CommandReply> {
  const binding = await requireBinding(ctx, deps.bindings, deps.logger);
  if ("reply" in binding) {
    return binding.reply;
  }

  const state =
    (await deps.conversationStates.getByKey(binding.record.key)) ?? null;
  const locale = getSystemLocale(state);
  const catalog = getSystemCatalog(locale);
  const currentPersona = binding.record.defaultPersonaId
    ? await deps.personaRepository.getById(binding.record.defaultPersonaId)
    : null;
  const globalConfig = await deps.globalConfigRepository.get();
  const readiness = evaluateOnboardingReadiness({
    binding: binding.record,
    config: globalConfig,
    fallbackGeminiApiKey: deps.pluginConfig.geminiApiKey,
    fallbackOpenRouterApiKey: deps.pluginConfig.openrouterApiKey,
  });

  if (hasLegacySetupOptions(options, ctx.commandBody)) {
    const referenceImageInput = extractReferenceImageInput(
      options.image,
      ctx.commandBody,
    );
    if (!referenceImageInput) {
      return {
        text: catalog.setup.errorWaitingForPhotoWithFallback,
        isError: true,
      };
    }
    const referenceImageAsset = await materializeReferenceImage({
      source: referenceImageInput,
      personasDir: deps.runtimeDataPaths.personasDir,
    });

    const isEditingExistingPersona = Boolean(currentPersona);
    const persona = createCompletedPersonaProfile({
      draft: {
        name: requiredOption(options, "name"),
        originCity: requiredOptionAlias(options, ["origin-city", "home-city"]),
        traits: requiredOption(options, "traits")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        toneStyle: requiredOption(options, "tone"),
        relationship: requiredOption(options, "relationship"),
        userAddressing: requiredOption(options, "user-address"),
        referenceImageAsset,
      },
      existing: input.mode === "edit" ? currentPersona : null,
    });
    await deps.personaRepository.save(persona);
    await deps.bindings.upsert({
      ...binding.record,
      defaultPersonaId: persona.personaId,
    });

    return {
      text: [
        isEditingExistingPersona
          ? catalog.onboarding.personaUpdated(persona.name)
          : catalog.onboarding.personaCreated(persona.name),
        `personaId: ${persona.personaId}`,
      ].join("\n"),
    };
  }

  if (
    input.mode === "edit" &&
    readiness.hasPersona &&
    (!readiness.hasTextProvider || !readiness.hasGeminiKey)
  ) {
    const nextState = {
      ...(state ??
        (await deps.conversationService.activateConversation(binding.record))),
      setupSession: createSetupSession({
        kind: "model",
        draft: buildModelSetupDraft(globalConfig),
      }),
      updatedAt: new Date().toISOString(),
    };
    await deps.conversationStates.save(nextState);
    await deps.logger?.log({
      tripId: `conversation:${binding.record.key}`,
      runId: `setup-start:${Date.now()}`,
      phase: "system",
      event: "setup.session.started",
      decision: "Started unified onboarding by continuing directly into model setup.",
      provider: "command",
      status: "success",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      latencyMs: 0,
      details: {
        conversationKey: binding.record.key,
        kind: "model",
        step: nextState.setupSession?.step,
        trigger: "setup-command-onboarding",
      },
    });

    return {
      text: renderSetupStepPrompt(nextState.setupSession, locale),
    };
  }

  const draft =
    input.mode === "edit" ? buildPersonaSetupDraft(currentPersona) : {};
  const initialStep =
    input.mode === "edit" && currentPersona
      ? "existing_persona_confirm"
      : "persona_intro";
  const nextState = {
    ...(state ?? (await deps.conversationService.activateConversation(binding.record))),
    setupSession: createSetupSession({
      kind: "persona",
      draft,
      step: initialStep,
      personaTargetId:
        input.mode === "edit" ? currentPersona?.personaId : undefined,
    }),
    updatedAt: new Date().toISOString(),
  };
  await deps.conversationStates.save(nextState);
  await deps.logger?.log({
    tripId: `conversation:${binding.record.key}`,
    runId: `setup-start:${Date.now()}`,
    phase: "system",
    event: "setup.session.started",
    decision: "Started interactive setup wizard.",
    provider: "command",
    status: "success",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    latencyMs: 0,
    details: {
      conversationKey: binding.record.key,
      kind: "persona",
      step: nextState.setupSession?.step,
    },
  });

  return {
    text: renderSetupStepPrompt(nextState.setupSession, locale),
  };
}

async function setupModel(
  ctx: PluginCommandContext,
  deps: CommandDependencies,
): Promise<CommandReply> {
  const binding = await requireBinding(ctx, deps.bindings, deps.logger);
  if ("reply" in binding) {
    return binding.reply;
  }

  const state =
    (await deps.conversationStates.getByKey(binding.record.key)) ?? null;
  const locale = getSystemLocale(state);
  const globalConfig = await deps.globalConfigRepository.get();
  const nextState = {
    ...(state ?? (await deps.conversationService.activateConversation(binding.record))),
    setupSession: createSetupSession({
      kind: "model",
      draft: buildModelSetupDraft(globalConfig),
    }),
    updatedAt: new Date().toISOString(),
  };
  await deps.conversationStates.save(nextState);
  await deps.logger?.log({
    tripId: `conversation:${binding.record.key}`,
    runId: `setup-model-start:${Date.now()}`,
    phase: "system",
    event: "setup.session.started",
    decision: "Started model-only setup wizard.",
    provider: "command",
    status: "success",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    latencyMs: 0,
    details: {
      conversationKey: binding.record.key,
      kind: "model",
      step: nextState.setupSession?.step,
    },
  });

  return {
    text: renderSetupStepPrompt(nextState.setupSession, locale),
  };
}

async function startTrip(
  options: Record<string, string>,
  deps: CommandDependencies,
  ctx: PluginCommandContext,
): Promise<CommandReply> {
  const binding = await requireBinding(ctx, deps.bindings, deps.logger);
  if ("reply" in binding) {
    return binding.reply;
  }

  const locale = await resolveLocaleForBinding(
    binding.record,
    deps.conversationStates,
  );
  const catalog = getSystemCatalog(locale);
  const globalConfig = await deps.globalConfigRepository.get();
  const readiness = evaluateOnboardingReadiness({
    binding: binding.record,
    config: globalConfig,
    fallbackGeminiApiKey: deps.pluginConfig.geminiApiKey,
    fallbackOpenRouterApiKey: deps.pluginConfig.openrouterApiKey,
  });
  await deps.logger?.log({
    tripId: `conversation:${binding.record.key}`,
    runId: `onboarding-check:${Date.now()}`,
    phase: "system",
    event: "onboarding.check",
    decision: "Checked whether onboarding is complete during start.",
    provider: "command",
    status: "success",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    latencyMs: 0,
    details: {
      conversationKey: binding.record.key,
      hasPersona: readiness.hasPersona,
      hasTextProvider: readiness.hasTextProvider,
      hasGeminiKey: readiness.hasGeminiKey,
    },
  });

  if (!readiness.isComplete) {
    await deps.logger?.log({
      tripId: `conversation:${binding.record.key}`,
      runId: `config-gate:${Date.now()}`,
      phase: "system",
      event: "config.missing_gate_triggered",
      decision: "Blocked trip start because onboarding/config is incomplete.",
      provider: "command",
      status: "success",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      latencyMs: 0,
      details: {
        conversationKey: binding.record.key,
        hasPersona: readiness.hasPersona,
        hasTextProvider: readiness.hasTextProvider,
        hasGeminiKey: readiness.hasGeminiKey,
      },
    });
    return {
      text: buildOnboardingGateMessage({
        binding: binding.record,
        readiness,
        setupSession: (await deps.conversationStates.getByKey(binding.record.key))
          ?.setupSession,
        locale,
      }),
      isError: true,
    };
  }

  const personaId = options.persona ?? binding.record.defaultPersonaId;
  if (!personaId) {
    return { text: catalog.command.startMissingPersona, isError: true };
  }

  const persona = await deps.personaRepository.getById(personaId);
  if (!persona) {
    return {
      text: catalog.command.tripNotFound(personaId),
      isError: true,
    };
  }

  let trip: TripRecord;
  try {
    trip = await deps.service.startTrip({
      personaId,
      originCity:
        options.from ??
        persona.originCity ??
        persona.homeCity ??
        deps.pluginConfig.defaultOriginCity ??
        "Hong Kong",
      destinationCity: requiredOption(options, "to"),
      startWindow: options.when,
    });
  } catch (error) {
    return {
      text: formatTripStartError(error, locale),
      isError: true,
    };
  }

  const patchedTrip: TripRecord = {
    ...trip,
    deliveryBinding: {
      bindingId: binding.record.bindingId,
      channel: binding.record.channel,
      accountId: binding.record.accountId,
      target: binding.record.target,
      parentConversationId: binding.record.parentConversationId,
      threadId: binding.record.threadId,
      boundAt: binding.record.boundAt,
    },
  };
  await deps.tripRepository.save(patchedTrip);
  await deps.bindings.upsert({
    ...binding.record,
    lastTripId: patchedTrip.tripId,
    defaultPersonaId: personaId,
  });
  const conversationState = await deps.conversationStates.getByKey(binding.record.key);
  if (conversationState) {
    await deps.conversationStates.save({
      ...conversationState,
      idleEnteredAt: null,
      idleGuideSentAt: null,
      awaitingDestination: false,
      pendingDestinationCandidate: null,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    text: catalog.command.startCreated({
      tripId: patchedTrip.tripId,
      destination: patchedTrip.request.destinationCity,
      days: patchedTrip.plan.metadata.days,
    }),
  };
}

function formatTripStartError(
  error: unknown,
  locale: SystemLocale,
): string {
  const catalog = getSystemCatalog(locale);
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("User location is not supported for the API use.")) {
    return catalog.command.tripStartProviderBlocked;
  }

  return catalog.command.tripStartFailed(message);
}

async function statusTrip(
  options: Record<string, string>,
  deps: CommandDependencies,
  ctx: PluginCommandContext,
): Promise<CommandReply> {
  const binding = await requireBinding(ctx, deps.bindings, deps.logger);
  if ("reply" in binding) {
    return binding.reply;
  }

  const locale = await resolveLocaleForBinding(
    binding.record,
    deps.conversationStates,
  );
  const catalog = getSystemCatalog(locale);
  const channelCapabilities = getChannelCapabilities(binding.record.channel);
  const tripId = options.trip ?? binding.record.lastTripId;
  if (!tripId) {
    return {
      text: catalog.command.statusNoTrip({
        channel: binding.record.channel,
        channelCombinedPostcard: formatLocalizedChannelCapability(
          formatChannelCapability(channelCapabilities.combinedPostcard),
          locale,
        ),
        channelMediaPostcard: formatLocalizedChannelCapability(
          formatChannelCapability(channelCapabilities.mediaPostcard),
          locale,
        ),
        channelInboundImageSetup: formatLocalizedChannelCapability(
          formatChannelCapability(channelCapabilities.inboundImageSetup),
          locale,
        ),
        channelProactiveMessaging: formatLocalizedChannelCapability(
          formatChannelCapability(channelCapabilities.proactiveMessaging),
          locale,
        ),
      }),
      isError: true,
    };
  }

  const trip = await deps.tripRepository.getById(tripId);
  if (!trip) {
    return { text: catalog.command.tripNotFound(tripId), isError: true };
  }

  const inspection = await deps.conversationService.inspectConversation({
    binding: binding.record,
  });
  const globalConfig = await deps.globalConfigRepository.get();
  const readiness = evaluateOnboardingReadiness({
    binding: binding.record,
    config: globalConfig,
    fallbackGeminiApiKey: deps.pluginConfig.geminiApiKey,
    fallbackOpenRouterApiKey: deps.pluginConfig.openrouterApiKey,
  });
  const geminiProvider = describeConfiguredGeminiProvider({
    globalConfig,
    pluginConfig: deps.pluginConfig,
  });
  const pendingReplyCount = inspection.state?.pendingUserMessages.length ?? 0;
  const replyDueAt = inspection.state?.pendingReplyDispatch?.dueAt ?? "none";
  const hotWindow = inspection.state?.instantReplyWindow
    ? `${inspection.state.instantReplyWindow.source}:${inspection.state.instantReplyWindow.triggerAt} -> ${inspection.state.instantReplyWindow.expiresAt} (${Math.max(inspection.state.instantReplyWindow.cap - inspection.state.instantReplyWindow.usedCount, 0)} left)`
    : "none";

  return {
    text: [
      `tripId: ${trip.tripId}`,
      `channel: ${binding.record.channel}`,
      `channelCombinedPostcard: ${formatChannelCapability(channelCapabilities.combinedPostcard)}`,
      `channelMediaPostcard: ${formatChannelCapability(channelCapabilities.mediaPostcard)}`,
      `channelInboundImageSetup: ${formatChannelCapability(channelCapabilities.inboundImageSetup)}`,
      `channelProactiveMessaging: ${formatChannelCapability(channelCapabilities.proactiveMessaging)}`,
      `status: ${trip.state.status}`,
      `phase: ${trip.state.currentPhase}`,
      `day: ${trip.state.currentDay}`,
      `nextRunAt: ${trip.state.nextRunAt ?? "none"}`,
      `lastPostcardDeliveryMode: ${trip.state.lastPostcardDelivery?.deliveryMode ?? "none"}`,
      `lastPostcardFallbackUsed: ${trip.state.lastPostcardDelivery?.fallbackUsed ?? false}`,
      `lastPostcardFallbackReason: ${trip.state.lastPostcardDelivery?.fallbackReason ?? "none"}`,
      `lastPostcardAuxiliaryMessageIds: ${(trip.state.lastPostcardDelivery?.auxiliaryMessageIds ?? []).join(",") || "none"}`,
      `lastPostcardCapabilityCombined: ${trip.state.lastPostcardDelivery?.capabilities.combinedPostcard ?? "none"}`,
      `lastPostcardCapabilityMedia: ${trip.state.lastPostcardDelivery?.capabilities.mediaPostcard ?? "none"}`,
      `artifacts: ${trip.state.artifacts.length}`,
      `conversationMode: ${binding.record.mode}`,
      `bindingSource: ${binding.record.bindingSource ?? (binding.record.bindingId ? "official" : "local")}`,
      `bindingId: ${binding.record.bindingId ?? "none"}`,
      `systemLocale: ${locale}`,
      `onboardingComplete: ${readiness.isComplete}`,
      `setupStep: ${inspection.state?.setupSession?.step ?? "none"}`,
      `textProvider: ${globalConfig.textProvider?.kind ?? "none"}`,
      `geminiProvider: ${geminiProvider}`,
      `geminiKeyConfigured: ${readiness.hasGeminiKey}`,
      `state: ${inspection.resolvedState.stage.group ?? inspection.businessSituation.state}`,
      `substate: ${inspection.resolvedState.stage.substate}`,
      `stateLocation: ${inspection.resolvedState.state.location ?? "none"}`,
      `statePresence: ${inspection.resolvedState.state.presence}`,
      `stateWindow: ${inspection.resolvedState.stage.startedAtUtc} -> ${inspection.resolvedState.stage.endsAtUtc ?? "open"}`,
      `anchorSource: ${inspection.resolvedState.state.source}`,
      `idleEnteredAt: ${inspection.state?.idleEnteredAt ?? "none"}`,
      `idleGuideSentAt: ${inspection.state?.idleGuideSentAt ?? "none"}`,
      `awaitingDestination: ${inspection.state?.awaitingDestination ?? false}`,
      `pendingDestinationCandidate: ${inspection.state?.pendingDestinationCandidate ?? "none"}`,
      `pendingReplyCount: ${pendingReplyCount}`,
      `replyDueAt: ${replyDueAt}`,
      `instantReplyWindow: ${hotWindow}`,
    ].join("\n"),
  };
}

async function tickTrip(
  options: Record<string, string>,
  deps: CommandDependencies,
  ctx: PluginCommandContext,
): Promise<CommandReply> {
  const binding = await requireBinding(ctx, deps.bindings, deps.logger);
  if ("reply" in binding) {
    return binding.reply;
  }

  const locale = await resolveLocaleForBinding(
    binding.record,
    deps.conversationStates,
  );
  const catalog = getSystemCatalog(locale);
  const tripId = options.trip ?? binding.record.lastTripId;

  try {
    await deps.conversationService.runConversation(binding.record.key, {
      ignoreSchedule: true,
    });

    if (!tripId) {
      return {
        text: catalog.command.tickSuccess({ id: binding.record.key }),
      };
    }

    if (deps.service.isTripInFlight(tripId)) {
      const currentTrip = await deps.tripRepository.getById(tripId);
      return {
        text: catalog.command.tickInProgress({
          id: tripId,
          phase: currentTrip?.state.currentPhase,
          nextRunAt: currentTrip?.state.nextRunAt ?? undefined,
        }),
      };
    }

    const trip = await deps.service.runTrip(tripId, { ignoreSchedule: true });
    return {
      text: catalog.command.tickSuccess({
        id: trip.tripId,
        status: trip.state.status,
        phase: trip.state.currentPhase,
        nextRunAt: trip.state.nextRunAt ?? "none",
      }),
    };
  } catch {
    return {
      text: catalog.command.tickFailure(tripId ?? binding.record.key),
      isError: true,
    };
  }
}

async function tickReply(
  deps: CommandDependencies,
  ctx: PluginCommandContext,
): Promise<CommandReply> {
  const binding = await requireBinding(ctx, deps.bindings, deps.logger);
  if ("reply" in binding) {
    return binding.reply;
  }

  const locale = await resolveLocaleForBinding(
    binding.record,
    deps.conversationStates,
  );
  const catalog = getSystemCatalog(locale);

  try {
    await deps.conversationService.runConversation(binding.record.key, {
      ignoreSchedule: true,
    });

    return {
      text: catalog.command.tickReplySuccess(binding.record.key),
    };
  } catch {
    return {
      text: catalog.command.tickReplyFailure(binding.record.key),
      isError: true,
    };
  }
}

async function stopTrip(
  options: Record<string, string>,
  deps: CommandDependencies,
  ctx: PluginCommandContext,
): Promise<CommandReply> {
  const binding = await requireBinding(ctx, deps.bindings, deps.logger);
  if ("reply" in binding) {
    return binding.reply;
  }

  const locale = await resolveLocaleForBinding(
    binding.record,
    deps.conversationStates,
  );
  const catalog = getSystemCatalog(locale);
  const tripId = options.trip ?? binding.record.lastTripId;
  if (!tripId) {
    return { text: catalog.command.stopNoTrip, isError: true };
  }

  const trip = await deps.service.stopTrip(tripId);
  const updatedBinding = {
    ...binding.record,
    lastTripId: undefined,
  };
  await deps.bindings.upsert(updatedBinding);
  await deps.conversationService.enterIdleAwaitingDestination({
    binding: updatedBinding,
    sendGuideNow: false,
    clearConversationContext: true,
    reason: "trip_stopped",
  });
  return {
    text: catalog.command.stopSuccess({
      tripId: trip.tripId,
      status: trip.state.status,
    }),
  };
}

async function resolveLocaleForBinding(
  binding: ConversationBindingRecord,
  conversationStates: ConversationStateRepository,
): Promise<SystemLocale> {
  if (typeof conversationStates?.getByKey !== "function") {
    return "zh-CN";
  }
  return getSystemLocale(await conversationStates.getByKey(binding.key));
}

function formatLocalizedChannelCapability(
  value: ReturnType<typeof formatChannelCapability>,
  locale: SystemLocale,
): string {
  const catalog = getSystemCatalog(locale);
  switch (value) {
    case "supported":
      return catalog.command.channelCapabilitySupported;
    case "limited":
      return catalog.command.channelCapabilityLimited;
    case "unsupported":
      return catalog.command.channelCapabilityUnsupported;
    default:
      return catalog.command.channelCapabilityUnknown;
  }
}

async function requireBinding(
  ctx: PluginCommandContext,
  bindings: ConversationBindingStore,
  logger?: LoggerPort,
): Promise<
  | { record: NonNullable<Awaited<ReturnType<ConversationBindingStore["get"]>>> }
  | { reply: CommandReply }
> {
  const currentBinding = await ctx.getCurrentConversationBinding();
  if (currentBinding) {
    const existing = await bindings.get(
      bindingKey({
        channel: currentBinding.channel,
        accountId: currentBinding.accountId,
        target: currentBinding.conversationId,
        threadId: currentBinding.threadId,
      }),
    );
    const record = {
      ...(existing ?? {}),
      key: bindingKey({
        channel: currentBinding.channel,
        accountId: currentBinding.accountId,
        target: currentBinding.conversationId,
        threadId: currentBinding.threadId,
      }),
      bindingId: currentBinding.bindingId,
      channel: currentBinding.channel,
      accountId: currentBinding.accountId,
      target: currentBinding.conversationId,
      parentConversationId: currentBinding.parentConversationId,
      threadId: currentBinding.threadId,
      boundAt: currentBinding.boundAt,
      bindingSource: "official" as const,
      mode: existing?.mode ?? "default",
      defaultPersonaId: existing?.defaultPersonaId,
      lastTripId: existing?.lastTripId,
    };
    await bindings.upsert(record);
    await logBindingEvent(logger, {
      event: "binding.current",
      decision: "Resolved current official OpenClaw conversation binding.",
      status: "success",
      ctx,
      details: {
        key: record.key,
        bindingId: record.bindingId,
        channel: record.channel,
        accountId: record.accountId,
        target: record.target,
        parentConversationId: record.parentConversationId,
        threadId: record.threadId,
      },
    });
    return { record };
  }

  const inferred = inferBindingRecord(ctx);
  if (!inferred) {
    return {
      reply: {
        text: getSystemCatalog(undefined).command.notReadyBind,
        isError: true,
      },
    };
  }

  const record = await bindings.get(inferred.key);
  if (record) {
    await logBindingEvent(logger, {
      event: "binding.fallback_existing",
      decision:
        "Fell back to locally stored inferred binding because no official current binding was present.",
      status: "skipped",
      ctx,
      details: {
        key: record.key,
        bindingId: record.bindingId,
        channel: record.channel,
        accountId: record.accountId,
        target: record.target,
        threadId: record.threadId,
      },
    });
    return { record };
  }

  await bindings.upsert(inferred);
  await logBindingEvent(logger, {
    event: "binding.fallback_inferred",
    decision:
      "Created a locally inferred binding because no official current binding was present.",
    status: "skipped",
    ctx,
    details: {
      key: inferred.key,
      channel: inferred.channel,
      accountId: inferred.accountId,
      target: inferred.target,
      threadId: inferred.threadId,
    },
  });
  return { record: inferred };
}

async function requireActivatedThen(
  ctx: PluginCommandContext,
  deps: CommandDependencies,
  fn: () => Promise<CommandReply>,
): Promise<CommandReply> {
  const resolved = await requireBinding(ctx, deps.bindings, deps.logger);
  if ("reply" in resolved) {
    return {
      text: getSystemCatalog(undefined).command.activateFirst,
      isError: true,
    };
  }

  if (resolved.record.mode !== "companion-exclusive") {
    const locale = await resolveLocaleForBinding(
      resolved.record,
      deps.conversationStates,
    );
    return {
      text: getSystemCatalog(locale).command.notActiveYet,
      isError: true,
    };
  }

  const state =
    typeof deps.conversationStates?.getByKey === "function"
      ? await deps.conversationStates.getByKey(resolved.record.key)
      : null;
  if (state && (!state.systemLocale || state.setupSession?.kind === "locale")) {
    return { text: buildLocaleSelectionMenu(), isError: true };
  }

  return fn();
}

function inferBindingRecord(
  ctx: PluginCommandContext,
): Awaited<ReturnType<ConversationBindingStore["get"]>> | null {
  const target = inferConversationTarget(ctx);
  if (!target) {
    return null;
  }

  const key = bindingKey({
    channel: ctx.channel,
    accountId: ctx.accountId,
    target,
    threadId: ctx.messageThreadId,
  });
  return {
    key,
    bindingId: undefined,
    bindingSource: "local",
    channel: ctx.channel,
    accountId: ctx.accountId,
    target,
    parentConversationId: ctx.threadParentId,
    threadId: ctx.messageThreadId,
    boundAt: Date.now(),
    mode: "default",
  };
}

async function ensurePluginConversationBinding(
  ctx: PluginCommandContext,
  bindings: ConversationBindingStore,
  mode: "default" | "companion-exclusive",
  logger?: LoggerPort,
): Promise<
  | { record: NonNullable<Awaited<ReturnType<ConversationBindingStore["get"]>>> }
  | { reply: CommandReply }
> {
  const localRecord = await ensureLocalConversationBindingRecord(
    ctx,
    bindings,
    mode,
    logger,
  );
  if ("reply" in localRecord) {
    return localRecord;
  }

  try {
    const requested = await ctx.requestConversationBinding({
      summary:
        "Allow elsewhere to own this conversation for travel postcards and delayed chat replies.",
      detachHint:
        `Run ${PRIMARY_SLASH_COMMAND} deactivate to stop the trip and return this chat to the default assistant.`,
    });

    await logBindingEvent(logger, {
      event: "binding.requested",
      decision:
        "Requested official OpenClaw conversation binding for travel companion.",
      status:
        requested.status === "bound"
          ? "success"
          : requested.status === "pending"
            ? "skipped"
            : "failure",
      ctx,
      details:
        requested.status === "bound"
          ? {
              requestStatus: requested.status,
              bindingId: requested.binding.bindingId,
              channel: requested.binding.channel,
              accountId: requested.binding.accountId,
              conversationId: requested.binding.conversationId,
              parentConversationId: requested.binding.parentConversationId,
              threadId: requested.binding.threadId,
              mode,
            }
          : requested.status === "pending"
            ? {
                requestStatus: requested.status,
                approvalId: requested.approvalId,
                mode,
              }
            : {
                requestStatus: requested.status,
                message: requested.message,
                mode,
              },
    });

    if (requested.status === "bound") {
      const record = await buildOfficialConversationBindingRecord(
        bindings,
        ctx,
        {
          channel: requested.binding.channel,
          accountId: requested.binding.accountId,
          target: requested.binding.conversationId,
          parentConversationId: requested.binding.parentConversationId,
          threadId: requested.binding.threadId,
          bindingId: requested.binding.bindingId,
          boundAt: requested.binding.boundAt,
        },
        mode,
      );
      await bindings.upsert(record);
      await logBindingEvent(logger, {
        event: "binding.stored",
        decision:
          "Stored conversation binding metadata locally after official binding request.",
        status: "success",
        ctx,
        details: {
          key: record.key,
          bindingId: record.bindingId,
          bindingSource: record.bindingSource,
          channel: record.channel,
          accountId: record.accountId,
          target: record.target,
          parentConversationId: record.parentConversationId,
          threadId: record.threadId,
          mode: record.mode,
        },
      });
      return { record };
    }
  } catch (error) {
    await logBindingEvent(logger, {
      event: "binding.request_failed",
      decision:
        "Official OpenClaw conversation binding request failed, so elsewhere stayed on the local soft-binding fallback.",
      status: "failure",
      ctx,
      details: {
        mode,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }

  await logBindingEvent(logger, {
    event: "binding.soft_activated",
    decision:
      "Activated elsewhere using the local soft-binding path because official plugin binding was unavailable or still pending.",
    status: "skipped",
    ctx,
    details: {
      key: localRecord.record.key,
      bindingId: localRecord.record.bindingId,
      bindingSource:
        localRecord.record.bindingSource ??
        (localRecord.record.bindingId ? "official" : "local"),
      mode: localRecord.record.mode,
    },
  });

  return localRecord;
}

async function ensureLocalConversationBindingRecord(
  ctx: PluginCommandContext,
  bindings: ConversationBindingStore,
  mode: "default" | "companion-exclusive",
  logger?: LoggerPort,
): Promise<
  | { record: NonNullable<Awaited<ReturnType<ConversationBindingStore["get"]>>> }
  | { reply: CommandReply }
> {
  const currentBinding = await ctx.getCurrentConversationBinding();
  if (currentBinding) {
    const record = await buildOfficialConversationBindingRecord(
      bindings,
      ctx,
      {
        channel: currentBinding.channel,
        accountId: currentBinding.accountId,
        target: currentBinding.conversationId,
        parentConversationId: currentBinding.parentConversationId,
        threadId: currentBinding.threadId,
        bindingId: currentBinding.bindingId,
        boundAt: currentBinding.boundAt,
      },
      mode,
    );
    await bindings.upsert(record);
    await logBindingEvent(logger, {
      event: "binding.current",
      decision:
        "Resolved current official OpenClaw conversation binding before activating elsewhere.",
      status: "success",
      ctx,
      details: {
        key: record.key,
        bindingId: record.bindingId,
        bindingSource: record.bindingSource,
        channel: record.channel,
        accountId: record.accountId,
        target: record.target,
        parentConversationId: record.parentConversationId,
        threadId: record.threadId,
        mode: record.mode,
      },
    });
    return { record };
  }

  const inferred = inferBindingRecord(ctx);
  if (!inferred) {
    return {
      reply: {
        text: getSystemCatalog(undefined).command.notReadyBind,
        isError: true,
      },
    };
  }

  const record = await buildLocalConversationBindingRecord(
    bindings,
    ctx,
    inferred,
    mode,
  );
  await bindings.upsert(record);
  await logBindingEvent(logger, {
    event: "binding.local_ready",
    decision:
      "Prepared a local soft-binding record for elsewhere without waiting on official plugin binding approval.",
    status: "success",
    ctx,
    details: {
      key: record.key,
      bindingId: record.bindingId,
      bindingSource: record.bindingSource,
      channel: record.channel,
      accountId: record.accountId,
      target: record.target,
      parentConversationId: record.parentConversationId,
      threadId: record.threadId,
      mode: record.mode,
    },
  });
  return { record };
}

async function buildOfficialConversationBindingRecord(
  bindings: ConversationBindingStore,
  ctx: PluginCommandContext,
  input: {
    channel: string;
    accountId?: string;
    target: string;
    parentConversationId?: string;
    threadId?: string | number;
    bindingId?: string;
    boundAt?: number;
  },
  mode: "default" | "companion-exclusive",
): Promise<NonNullable<Awaited<ReturnType<ConversationBindingStore["get"]>>>> {
  const key = bindingKey({
    channel: input.channel,
    accountId: input.accountId,
    target: input.target,
    threadId: input.threadId,
  });
  const existing = await bindings.get(key);
  const related = await findRelatedBindingRecord(bindings, ctx, {
    channel: input.channel,
    accountId: input.accountId,
    target: input.target,
    threadId: input.threadId,
  });
  const seed =
    existing && (existing.defaultPersonaId || existing.lastTripId)
      ? existing
      : related ?? existing;

  return {
    ...(seed ?? {}),
    key,
    bindingId: input.bindingId,
    bindingSource: "official",
    channel: input.channel,
    accountId: input.accountId,
    target: input.target,
    parentConversationId: input.parentConversationId,
    threadId: input.threadId,
    boundAt: input.boundAt,
    mode,
    defaultPersonaId: seed?.defaultPersonaId,
    lastTripId: seed?.lastTripId,
  };
}

async function buildLocalConversationBindingRecord(
  bindings: ConversationBindingStore,
  ctx: PluginCommandContext,
  inferred: NonNullable<Awaited<ReturnType<ConversationBindingStore["get"]>>>,
  mode: "default" | "companion-exclusive",
): Promise<NonNullable<Awaited<ReturnType<ConversationBindingStore["get"]>>>> {
  const existing = await bindings.get(inferred.key);
  if (existing) {
    return {
      ...existing,
      ...inferred,
      bindingId: undefined,
      bindingSource: "local",
      mode,
      defaultPersonaId: existing.defaultPersonaId,
      lastTripId: existing.lastTripId,
    };
  }

  const related = await findRelatedBindingRecord(bindings, ctx, {
    channel: inferred.channel,
    accountId: inferred.accountId,
    target: inferred.target,
    threadId: inferred.threadId,
  });

  return {
    ...(related ?? {}),
    ...inferred,
    bindingId: undefined,
    bindingSource: "local",
    mode,
    defaultPersonaId: related?.defaultPersonaId,
    lastTripId: related?.lastTripId,
  };
}

async function detachOfficialConversationBinding(
  ctx: PluginCommandContext,
  binding: ConversationBindingRecord,
  logger?: LoggerPort,
): Promise<void> {
  if (!binding.bindingId) {
    return;
  }

  try {
    await ctx.detachConversationBinding();
    await logBindingEvent(logger, {
      event: "binding.detached",
      decision:
        "Detached the official OpenClaw conversation binding while leaving elsewhere's local state shutdown to the plugin runtime.",
      status: "success",
      ctx,
      details: {
        key: binding.key,
        bindingId: binding.bindingId,
        bindingSource: binding.bindingSource ?? "official",
      },
    });
  } catch (error) {
    await logBindingEvent(logger, {
      event: "binding.detach_failed",
      decision:
        "Failed to detach the official OpenClaw conversation binding, but elsewhere still completed the local deactivate flow.",
      status: "failure",
      ctx,
      details: {
        key: binding.key,
        bindingId: binding.bindingId,
        bindingSource: binding.bindingSource ?? "official",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function findRelatedBindingRecord(
  bindings: ConversationBindingStore,
  ctx: PluginCommandContext,
  input: {
    channel: string;
    accountId?: string;
    target: string;
    threadId?: string | number;
  },
): Promise<Awaited<ReturnType<ConversationBindingStore["get"]>>> {
  const candidates = new Set<string>();
  for (const value of [
    input.target,
    ctx.senderId,
    ctx.from,
    ctx.to,
    inferConversationTarget(ctx),
  ]) {
    const normalized = normalizeBindingTarget(input.channel, value);
    if (normalized) {
      candidates.add(normalized);
    }
  }

  const threadId = String(input.threadId ?? "main");
  const records = await bindings.list();
  return (
    records.find((record) => {
      if (record.channel !== input.channel) {
        return false;
      }
      if (String(record.threadId ?? "main") !== threadId) {
        return false;
      }
      const target = normalizeBindingTarget(record.channel, record.target);
      if (!target || !candidates.has(target)) {
        return false;
      }
      return Boolean(record.defaultPersonaId || record.lastTripId);
    }) ?? null
  );
}

async function logBindingEvent(
  logger: LoggerPort | undefined,
  input: {
    event: string;
    decision: string;
    status: "success" | "failure" | "skipped";
    ctx: PluginCommandContext;
    details: Record<string, unknown>;
  },
): Promise<void> {
  if (!logger) {
    return;
  }

  const now = new Date().toISOString();
  await logger.log({
    tripId: `conversation:${input.ctx.channel}:${input.ctx.accountId ?? "default"}`,
    runId: `binding:${input.event}:${Date.now()}`,
    phase: "system",
    event: input.event,
    decision: input.decision,
    provider: "command",
    status: input.status,
    startedAt: now,
    finishedAt: now,
    latencyMs: 0,
    details: input.details,
  });
}

function inferConversationTarget(ctx: PluginCommandContext): string | null {
  const from = normalizeRoutePart(ctx.from ?? ctx.senderId);
  const to = normalizeRoutePart(ctx.to);

  if (ctx.channel === "telegram") {
    if (to?.startsWith("-")) {
      return to;
    }
    return from ?? to;
  }

  return to ?? from;
}

function normalizeRoutePart(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeBindingTarget(
  channel: string,
  value: string | null | undefined,
): string | null {
  const normalized = normalizeRoutePart(value);
  if (!normalized) {
    return null;
  }

  const channelPrefix = `${channel}:`;
  if (normalized.startsWith(channelPrefix)) {
    return normalized.slice(channelPrefix.length);
  }

  return normalized;
}

function hasLegacySetupOptions(
  options: Record<string, string>,
  commandBody: string,
): boolean {
  return Boolean(
    options.name ||
      options["origin-city"] ||
      options["home-city"] ||
      options.traits ||
      options.tone ||
      options.relationship ||
      options["user-address"] ||
      options.image ||
      extractReferenceImageInput(options.image, commandBody),
  );
}

function requiredOption(options: Record<string, string>, key: string): string {
  const value = options[key];
  if (!value) {
    throw new Error(`Missing required option --${key}`);
  }
  return value;
}

function requiredOptionAlias(
  options: Record<string, string>,
  keys: string[],
): string {
  for (const key of keys) {
    const value = options[key];
    if (value) {
      return value;
    }
  }

  throw new Error(
    `Missing required option ${keys.map((key) => `--${key}`).join(" or ")}`,
  );
}

function parseArgs(rawArgs: string | undefined): ParsedArgs {
  const tokens = tokenize(rawArgs ?? "");
  const subcommand = tokens.shift() ?? "help";
  const options: Record<string, string> = {};

  while (tokens.length > 0) {
    const token = tokens.shift();
    if (!token?.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value =
      tokens[0] && !tokens[0]?.startsWith("--") ? tokens.shift() ?? "" : "true";
    options[key] = value;
  }

  return { subcommand, options };
}

function tokenize(input: string): string[] {
  const matches = input.match(/"([^"]*)"|'([^']*)'|[^\s]+/g) ?? [];
  return matches.map((token) => token.replace(/^['"]|['"]$/g, ""));
}

function helpText(locale: SystemLocale | undefined): string {
  return getSystemCatalog(locale).help.lines.join("\n");
}
