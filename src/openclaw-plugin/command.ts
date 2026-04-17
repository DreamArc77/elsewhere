import type { PluginCommandContext } from "openclaw/plugin-sdk/plugin-entry";

import { CompanionConversationService } from "../application/companion-conversation-service.js";
import { OpenClawTravelCompanionService } from "../application/openclaw-travel-companion-service.js";
import {
  ConversationBindingRecord,
  ConversationBindingStore,
  ConversationStateRepository,
  GlobalConfigRepository,
  HostMessengerPort,
  LoggerPort,
  PersonaRepository,
  TripRecord,
  TripRepository,
} from "../domain/types.js";
import { bindingKey } from "./binding-state.js";
import { TravelCompanionPluginConfig } from "./config.js";
import {
  extractReferenceImageInput,
  materializeReferenceImage,
} from "./reference-image.js";
import { RuntimeDataPaths } from "../infrastructure/json-file-repositories.js";
import {
  buildModelSetupDraft,
  buildOnboardingGateMessage,
  buildPersonaSetupDraft,
  createCompletedPersonaProfile,
  createSetupSession,
  evaluateOnboardingReadiness,
  renderSetupStepPrompt,
} from "./onboarding.js";

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
      return requireActivatedThen(ctx, deps, () =>
        setupModel(ctx, parsed.options, deps),
      );
    case "start":
      return requireActivatedThen(ctx, deps, () => startTrip(ctx, parsed.options, deps));
    case "status":
      return requireActivatedThen(ctx, deps, () => statusTrip(ctx, parsed.options, deps));
    case "tick":
      return requireActivatedThen(ctx, deps, () => tickTrip(ctx, parsed.options, deps));
    case "tick-reply":
      return requireActivatedThen(ctx, deps, () => tickReply(ctx, parsed.options, deps));
    case "stop":
      return requireActivatedThen(ctx, deps, () => stopTrip(ctx, parsed.options, deps));
    default:
      return { text: helpText() };
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
    return {
      text: binding.reply.text,
      isError: binding.reply.isError,
    };
  }

  return {
    text: [
      "这条会话已经和 Ta 绑定好了。",
      "接下来运行 /travel-companion activate，进入 Ta 模式。",
    ].join("\n"),
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
  await deps.conversationService.activateConversation(activatedBinding);
  const state =
    (await deps.conversationStates.getByKey(activatedBinding.key)) ??
    null;
  const globalConfig = await deps.globalConfigRepository.get();
  const readiness = evaluateOnboardingReadiness({
    binding: activatedBinding,
    config: globalConfig,
    fallbackGeminiApiKey: deps.pluginConfig.geminiApiKey,
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
      decision: "Blocked companion activation from entering idle because onboarding/config is incomplete.",
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
        "Ta 模式已开启。",
        buildOnboardingGateMessage({
          binding: activatedBinding,
          readiness,
          setupSession: state?.setupSession,
        }),
      ].join("\n"),
    };
  }

  if (!binding.record.lastTripId && !state?.awaitingDestination) {
    await deps.conversationService.enterIdleAwaitingDestination({
      binding: activatedBinding,
      sendGuideNow: false,
      reason: "activate",
    });
  }

  return {
    text: ["Ta 模式已开启。", "直接告诉 Ta 一个想去的目的地就行。"].join(
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
  await ctx.detachConversationBinding();

  return {
    text: [
      "Ta 模式已关闭。",
      "当前行程已停止。",
      "这条会话已经回到默认助手。",
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
    (await deps.conversationStates.getByKey(binding.record.key)) ??
    null;
  const currentPersona = binding.record.defaultPersonaId
    ? await deps.personaRepository.getById(binding.record.defaultPersonaId)
    : null;

  if (hasLegacySetupOptions(options, ctx.commandBody)) {
    const referenceImageInput = extractReferenceImageInput(
      options.image,
      ctx.commandBody,
    );
    if (!referenceImageInput) {
      throw new Error(
        "Missing reference image. Pass --image <absolute-path-or-image-url>, or paste an image URL in the setup command.",
      );
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
          ? `Ta 资料已更新：${persona.name}`
          : `Ta 创建完成：${persona.name}`,
        `personaId: ${persona.personaId}`,
        "这条会话现在默认使用 Ta。",
      ].join("\n"),
    };
  }

  const draft =
    input.mode === "edit" ? buildPersonaSetupDraft(currentPersona) : {};
  const initialStep =
    input.mode === "edit" && currentPersona
      ? "existing_persona_confirm"
      : "persona_intro";
  const nextState = {
    ...(state ?? await deps.conversationService.activateConversation(binding.record)),
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
    details: { conversationKey: binding.record.key, step: nextState.setupSession?.step },
  });
  await deps.logger?.log({
    tripId: `conversation:${binding.record.key}`,
    runId: `setup-prompt:${Date.now()}`,
    phase: "system",
    event: "setup.step.prompted",
    decision: "Prompted the next setup step.",
    provider: "command",
    status: "success",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    latencyMs: 0,
    details: { conversationKey: binding.record.key, step: nextState.setupSession?.step },
  });
  return {
    text: renderSetupStepPrompt(nextState.setupSession),
  };
}

async function setupModel(
  ctx: PluginCommandContext,
  _options: Record<string, string>,
  deps: CommandDependencies,
): Promise<CommandReply> {
  const binding = await requireBinding(ctx, deps.bindings, deps.logger);
  if ("reply" in binding) {
    return binding.reply;
  }

  const state =
    (await deps.conversationStates.getByKey(binding.record.key)) ??
    null;
  const globalConfig = await deps.globalConfigRepository.get();
  const nextState = {
    ...(state ?? await deps.conversationService.activateConversation(binding.record)),
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
    text: renderSetupStepPrompt(nextState.setupSession),
  };
}

async function startTrip(
  ctx: PluginCommandContext,
  options: Record<string, string>,
  deps: CommandDependencies,
): Promise<CommandReply> {
  const binding = await requireBinding(ctx, deps.bindings, deps.logger);
  if ("reply" in binding) {
    return binding.reply;
  }

  const globalConfig = await deps.globalConfigRepository.get();
  const readiness = evaluateOnboardingReadiness({
    binding: binding.record,
    config: globalConfig,
    fallbackGeminiApiKey: deps.pluginConfig.geminiApiKey,
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
      }),
      isError: true,
    };
  }

  const personaId = options.persona ?? binding.record.defaultPersonaId;
  if (!personaId) {
    return {
      text: "No default persona is set for this conversation. Run /travel-companion setup first, or pass --persona.",
      isError: true,
    };
  }

  const persona = await deps.personaRepository.getById(personaId);
  if (!persona) {
    return {
      text: `Persona not found: ${personaId}`,
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
      text: formatTripStartError(error),
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
    text: [
      `Trip created: ${patchedTrip.tripId}`,
      `Destination: ${patchedTrip.request.destinationCity}`,
      `Days: ${patchedTrip.plan.metadata.days}`,
      "The background worker will now advance the trip and proactively send postcards here.",
    ].join("\n"),
  };
}

function formatTripStartError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("User location is not supported for the API use.")) {
    return [
      "这次行程生成失败了。",
      "Gemini 返回：当前 API 使用环境不支持这次请求。",
      "这更像是 provider 侧限制，不是你目的地填错了。",
      "我这边会继续处理成自动降级重试；你现在先不用重复发目的地。",
    ].join("\n");
  }

  return [
    "这次行程生成失败了。",
    `错误信息：${message}`,
  ].join("\n");
}

async function statusTrip(
  ctx: PluginCommandContext,
  options: Record<string, string>,
  deps: CommandDependencies,
): Promise<CommandReply> {
  const binding = await requireBinding(ctx, deps.bindings, deps.logger);
  if ("reply" in binding) {
    return binding.reply;
  }

  const tripId = options.trip ?? binding.record.lastTripId;
  if (!tripId) {
    return {
      text: "No recent trip is recorded for this conversation yet.",
      isError: true,
    };
  }

  const trip = await deps.tripRepository.getById(tripId);
  if (!trip) {
    return { text: `Trip not found: ${tripId}`, isError: true };
  }

  const inspection = await deps.conversationService.inspectConversation({
    binding: binding.record,
  });
  const globalConfig = await deps.globalConfigRepository.get();
  const readiness = evaluateOnboardingReadiness({
    binding: binding.record,
    config: globalConfig,
    fallbackGeminiApiKey: deps.pluginConfig.geminiApiKey,
  });
  const pendingReplyCount = inspection.state?.pendingUserMessages.length ?? 0;
  const replyDueAt = inspection.state?.pendingReplyDispatch?.dueAt ?? "none";
  const hotWindow = inspection.state?.instantReplyWindow
    ? `${inspection.state.instantReplyWindow.source}:${inspection.state.instantReplyWindow.triggerAt} -> ${inspection.state.instantReplyWindow.expiresAt} (${Math.max(inspection.state.instantReplyWindow.cap - inspection.state.instantReplyWindow.usedCount, 0)} left)`
    : "none";

  return {
    text: [
      `tripId: ${trip.tripId}`,
      `status: ${trip.state.status}`,
      `phase: ${trip.state.currentPhase}`,
      `day: ${trip.state.currentDay}`,
      `nextRunAt: ${trip.state.nextRunAt ?? "none"}`,
      `artifacts: ${trip.state.artifacts.length}`,
      `conversationMode: ${binding.record.mode}`,
      `onboardingComplete: ${readiness.isComplete}`,
      `setupStep: ${inspection.state?.setupSession?.step ?? "none"}`,
      `textProvider: ${globalConfig.textProvider?.kind ?? "none"}`,
      `geminiKeyConfigured: ${Boolean(globalConfig.geminiApiKey?.trim() || deps.pluginConfig.geminiApiKey)}`,
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
  ctx: PluginCommandContext,
  options: Record<string, string>,
  deps: CommandDependencies,
): Promise<CommandReply> {
  const binding = await requireBinding(ctx, deps.bindings, deps.logger);
  if ("reply" in binding) {
    return binding.reply;
  }

  const tripId = options.trip ?? binding.record.lastTripId;

  try {
    await deps.conversationService.runConversation(binding.record.key, {
      ignoreSchedule: true,
    });

    if (!tripId) {
      return {
        text: [
          `Ticked immediately: ${binding.record.key}`,
          "reply: processed pending conversation replies",
          "trip: none",
        ].join("\n"),
      };
    }

    const trip = await deps.service.runTrip(tripId, { ignoreSchedule: true });
    return {
      text: [
        `Ticked immediately: ${trip.tripId}`,
        "reply: processed pending conversation replies",
        `status: ${trip.state.status}`,
        `phase: ${trip.state.currentPhase}`,
        `nextRunAt: ${trip.state.nextRunAt ?? "none"}`,
      ].join("\n"),
    };
  } catch {
    return {
      text: [
        `Tick attempted: ${tripId ?? binding.record.key}`,
        "The postcard or delayed reply could not be confirmed just now.",
        "The state was preserved. Please try /travel-companion tick again shortly.",
      ].join("\n"),
      isError: true,
    };
  }
}

async function tickReply(
  ctx: PluginCommandContext,
  _options: Record<string, string>,
  deps: CommandDependencies,
): Promise<CommandReply> {
  const binding = await requireBinding(ctx, deps.bindings, deps.logger);
  if ("reply" in binding) {
    return binding.reply;
  }

  try {
    await deps.conversationService.runConversation(binding.record.key, {
      ignoreSchedule: true,
    });

    return {
      text: [
        `Ticked reply immediately: ${binding.record.key}`,
        "reply: processed pending conversation replies",
        "trip: not advanced",
      ].join("\n"),
    };
  } catch {
    return {
      text: [
        `Reply tick attempted: ${binding.record.key}`,
        "The delayed reply could not be confirmed just now.",
        "The state was preserved. Please try /travel-companion tick-reply again shortly.",
      ].join("\n"),
      isError: true,
    };
  }
}

async function stopTrip(
  ctx: PluginCommandContext,
  options: Record<string, string>,
  deps: CommandDependencies,
): Promise<CommandReply> {
  const binding = await requireBinding(ctx, deps.bindings, deps.logger);
  if ("reply" in binding) {
    return binding.reply;
  }

  const tripId = options.trip ?? binding.record.lastTripId;
  if (!tripId) {
    return { text: "No trip is available to stop.", isError: true };
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
    text: [
      `Stopped: ${trip.tripId}`,
      `status: ${trip.state.status}`,
      "This trip will not schedule more messages.",
      "Conversation runtime state was cleared, companion-exclusive mode stays active, and Ta is back in idle.",
    ].join("\n"),
  };
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
        text: "This conversation is not ready yet. Run /travel-companion bind in the Telegram chat where you want to receive postcards.",
        isError: true,
      },
    };
  }

  const record = await bindings.get(inferred.key);
  if (record) {
    await logBindingEvent(logger, {
      event: "binding.fallback_existing",
      decision: "Fell back to locally stored inferred binding because no official current binding was present.",
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
    decision: "Created a locally inferred binding because no official current binding was present.",
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
      text: "This conversation is not ready yet. Run /travel-companion activate first.",
      isError: true,
    };
  }

  if (resolved.record.mode !== "companion-exclusive") {
    return {
      text: "Travel companion is not active in this chat yet. Run /travel-companion activate first.",
      isError: true,
    };
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
  const requested = await ctx.requestConversationBinding({
    summary:
      "Allow OpenClaw Travel Companion to own this conversation for travel postcards and delayed chat replies.",
    detachHint:
      "Run /travel-companion deactivate to stop the trip and return this chat to the default assistant.",
  });

  await logBindingEvent(logger, {
    event: "binding.requested",
    decision: "Requested official OpenClaw conversation binding for travel companion.",
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

  if (requested.status === "pending") {
    return {
      reply: {
        text: [
          "Conversation binding approval is required before takeover can start.",
          `approvalId: ${requested.approvalId}`,
          "Approve it, then run /travel-companion activate again.",
        ].join("\n"),
        isError: true,
      },
    };
  }

  if (requested.status === "error") {
    return {
      reply: {
        text: requested.message,
        isError: true,
      },
    };
  }

  const existing = await bindings.get(
    bindingKey({
      channel: requested.binding.channel,
      accountId: requested.binding.accountId,
      target: requested.binding.conversationId,
      threadId: requested.binding.threadId,
    }),
  );
  const related = await findRelatedBindingRecord(bindings, ctx, {
    channel: requested.binding.channel,
    accountId: requested.binding.accountId,
    target: requested.binding.conversationId,
    threadId: requested.binding.threadId,
  });
  const seed =
    existing && (existing.defaultPersonaId || existing.lastTripId)
      ? existing
      : related ?? existing;
  const record = {
    ...(seed ?? {}),
    key: bindingKey({
      channel: requested.binding.channel,
      accountId: requested.binding.accountId,
      target: requested.binding.conversationId,
      threadId: requested.binding.threadId,
    }),
    bindingId: requested.binding.bindingId,
    channel: requested.binding.channel,
    accountId: requested.binding.accountId,
    target: requested.binding.conversationId,
    parentConversationId: requested.binding.parentConversationId,
    threadId: requested.binding.threadId,
    boundAt: requested.binding.boundAt,
    mode,
    defaultPersonaId: seed?.defaultPersonaId,
    lastTripId: seed?.lastTripId,
  };
  await bindings.upsert(record);
  await logBindingEvent(logger, {
    event: "binding.stored",
    decision: "Stored conversation binding metadata locally after official binding request.",
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
      mode: record.mode,
    },
  });

  return { record };
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

function helpText(): string {
  return [
    "/travel-companion bind",
    "/travel-companion activate",
    "/travel-companion deactivate",
    "/travel-companion setup                      # edit the current Ta",
    "/travel-companion create                     # create a brand new Ta",
    "/travel-companion model                      # reconfigure text model / Gemini key",
    "/travel-companion setup --name Mori --origin-city Hong-Kong --traits gentle,curious --tone warm --relationship soulmate --user-address baby --image /abs/path/ref.png",
    "/travel-companion setup --name Mori --origin-city Hong-Kong --traits gentle,curious --tone warm --relationship soulmate --user-address baby --image https://example.com/ref.webp",
    "/travel-companion start --to Tokyo [--from Hong-Kong] [--when next-week]",
    "/travel-companion status [--trip <id>]",
    "/travel-companion tick [--trip <id>]  # force delayed replies + the next trip step immediately",
    "/travel-companion tick-reply           # force delayed replies only",
    "/travel-companion stop [--trip <id>]",
  ].join("\n");
}
