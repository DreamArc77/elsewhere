import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
  TripRepository,
} from "../domain/types.js";
import { bindingKey } from "./binding-state.js";
import { handleTravelCompanionCommand } from "./command.js";
import { TravelCompanionPluginConfig } from "./config.js";
import { RuntimeDataPaths } from "../infrastructure/json-file-repositories.js";
import {
  advanceSetupSessionWithPhoto,
  advanceSetupSessionWithText,
  buildIdleGuideMessage,
  buildOnboardingGateMessage,
  buildPersonaUpdatedMessage,
  createCompletedPersonaProfile,
  evaluateOnboardingReadiness,
  renderSetupStepPrompt,
} from "./onboarding.js";
import { materializeReferenceImage } from "./reference-image.js";

interface InboundClaimEvent {
  content: string;
  body?: string;
  bodyForAgent?: string;
  transcript?: string;
  channel: string;
  accountId?: string;
  conversationId?: string;
  parentConversationId?: string;
  senderId?: string;
  senderName?: string;
  senderUsername?: string;
  threadId?: string | number;
  messageId?: string;
  isGroup?: boolean;
  commandAuthorized?: boolean;
  mediaUrl?: string;
  mediaUrls?: string[];
  metadata?: Record<string, unknown>;
  attachments?: Array<{
    path?: string;
    url?: string;
    mediaUrl?: string;
    contentType?: string;
    mimeType?: string;
    kind?: string;
  }>;
}

interface InboundClaimContext {
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  senderId?: string;
  messageId?: string;
}

interface InboundClaimResult {
  handled: boolean;
}

interface InboundClaimDependencies {
  bindings: ConversationBindingStore;
  conversationService: CompanionConversationService;
  service: OpenClawTravelCompanionService;
  tripRepository: TripRepository;
  personaRepository: PersonaRepository;
  conversationStates: ConversationStateRepository;
  globalConfigRepository: GlobalConfigRepository;
  messenger: HostMessengerPort;
  pluginConfig: TravelCompanionPluginConfig;
  runtimeDataPaths: RuntimeDataPaths;
  logger: LoggerPort;
}

type ConversationBindingInternals = {
  requestPluginConversationBinding: (input: {
    pluginId: string;
    pluginName: string;
    pluginRoot: string;
    requestedBySenderId?: string;
    conversation: {
      channel: string;
      accountId: string;
      conversationId: string;
      parentConversationId?: string;
      threadId?: string | number;
    };
    binding?: { summary?: string; detachHint?: string };
  }) => Promise<unknown>;
  detachPluginConversationBinding: (input: {
    pluginRoot: string;
    conversation: {
      channel: string;
      accountId: string;
      conversationId: string;
      parentConversationId?: string;
      threadId?: string | number;
    };
  }) => Promise<{ removed: boolean }>;
  getCurrentPluginConversationBinding: (input: {
    pluginRoot: string;
    conversation: {
      channel: string;
      accountId: string;
      conversationId: string;
      parentConversationId?: string;
      threadId?: string | number;
    };
  }) => Promise<unknown>;
};

let bindingInternalsPromise: Promise<ConversationBindingInternals> | undefined;
const inFlightCommandKeys = new Set<string>();
const inFlightCommandBodies = new Set<string>();

export async function handleTravelCompanionInboundClaim(
  event: InboundClaimEvent,
  ctx: InboundClaimContext,
  deps: InboundClaimDependencies,
): Promise<InboundClaimResult | void> {
  const rawText =
    event.bodyForAgent ?? event.body ?? event.transcript ?? event.content ?? "";
  const trimmed = rawText.trim();
  const binding =
    (await resolveBindingForInbound(event, ctx, deps.bindings)) ??
    (await recoverBindingForInbound(event, ctx, deps));
  if (!binding) {
    return;
  }

  const state = await deps.conversationStates.getByKey(binding.key);

  if (state?.setupSession) {
    const handled = await handleSetupSessionInbound(
      {
        event,
        ctx,
        binding,
        state,
        trimmed,
      },
      deps,
    );
    if (handled) {
      return { handled: true };
    }
  }

  if (trimmed.startsWith("/travel-companion")) {
    const messageId = String(event.messageId ?? "");
    const duplicateByMessageId =
      messageId.length > 0
        ? await deps.conversationService.isInboundCommandDuplicate({
            conversationKey: binding.key,
            messageId,
          })
        : false;
    const inFlightKey =
      messageId.length > 0
        ? `${binding.key}:${messageId}`
        : `${binding.key}:${trimmed}`;
    const inFlightBodyKey = `${binding.key}:${trimmed}`;
    if (duplicateByMessageId || inFlightCommandKeys.has(inFlightKey) || inFlightCommandBodies.has(inFlightBodyKey)) {
      await logCommandBridgeEvent(deps.logger, {
        binding,
        runId: `command:${messageId || randomUUID()}`,
        event: "command.bridge.duplicate",
        decision:
          "Skipped a duplicate bridged travel-companion slash command delivery.",
        provider: "inbound-claim",
        status: "skipped",
        details: {
          commandBody: rawText,
          messageId,
          mode: binding.mode,
          duplicateByMessageId,
        },
      });
      return { handled: true };
    }

    inFlightCommandKeys.add(inFlightKey);
    inFlightCommandBodies.add(inFlightBodyKey);
    const commandRunId = `command:${String(event.messageId ?? randomUUID())}`;
    try {
      await logCommandBridgeEvent(deps.logger, {
        binding,
        runId: commandRunId,
        event: "command.bridge.received",
        decision: "Received travel-companion slash command inside a companion-exclusive conversation.",
        provider: "inbound-claim",
        status: "success",
        details: {
          commandBody: rawText,
          messageId,
          mode: binding.mode,
        },
      });

      const commandStartedAt = Date.now();
      const reply = await handleTravelCompanionCommand(
        buildSyntheticCommandContext(event, ctx, rawText),
        {
          service: deps.service,
          conversationService: deps.conversationService,
          tripRepository: deps.tripRepository,
          personaRepository: deps.personaRepository,
          conversationStates: deps.conversationStates,
          globalConfigRepository: deps.globalConfigRepository,
          messenger: deps.messenger,
          bindings: deps.bindings,
          pluginConfig: deps.pluginConfig,
          runtimeDataPaths: deps.runtimeDataPaths,
          logger: deps.logger,
        },
      );
      await logCommandBridgeEvent(deps.logger, {
        binding,
        runId: commandRunId,
        event: "command.bridge.executed",
        decision: "Executed the bridged travel-companion slash command.",
        provider: "command-handler",
        status: "success",
        startedAtMs: commandStartedAt,
        details: {
          commandBody: rawText,
          messageId,
          isError: reply.isError ?? false,
        },
      });

      const replyStartedAt = Date.now();
      await deps.messenger.sendTextReply({
        binding,
        text: reply.text,
        dedupeKey: `command:${binding.key}:${String(event.messageId ?? randomUUID())}`,
      });
      await logCommandBridgeEvent(deps.logger, {
        binding,
        runId: commandRunId,
        event: "command.bridge.replied",
        decision: "Delivered bridged slash-command output back into the bound conversation.",
        provider: "command-bridge",
        status: "success",
        startedAtMs: replyStartedAt,
        details: {
          commandBody: rawText,
          messageId,
          replyLength: reply.text.length,
        },
      });
      await deps.conversationService.rememberHandledInboundCommand({
        conversationKey: binding.key,
        messageId: messageId || undefined,
      });
    } catch (error) {
      await logCommandBridgeEvent(deps.logger, {
        binding,
        runId: commandRunId,
        event: "command.bridge.reply_failed",
        decision: "Failed to deliver bridged slash-command output back into the bound conversation.",
        provider: "command-bridge",
        status: "failure",
        startedAtMs: Date.now(),
        errorCode: error instanceof Error ? error.name : "command_bridge_reply_failed",
        details: {
          commandBody: rawText,
          messageId,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    } finally {
      inFlightCommandKeys.delete(inFlightKey);
      inFlightCommandBodies.delete(inFlightBodyKey);
    }

    return { handled: true };
  }

  if (binding.mode !== "companion-exclusive") {
    return;
  }

  if (trimmed.startsWith("/")) {
    return;
  }

  if (state?.awaitingDestination && trimmed) {
    const globalConfig = await deps.globalConfigRepository.get();
    const readiness = evaluateOnboardingReadiness({
      binding,
      config: globalConfig,
      fallbackGeminiApiKey: deps.pluginConfig.geminiApiKey,
    });
    if (readiness.isComplete && binding.defaultPersonaId) {
      const synthetic = `/travel-companion start --to "${trimmed.replace(/"/g, '\\"')}"`;
      const reply = await handleTravelCompanionCommand(
        buildSyntheticCommandContext(event, ctx, synthetic),
        {
          service: deps.service,
          conversationService: deps.conversationService,
          tripRepository: deps.tripRepository,
          personaRepository: deps.personaRepository,
          conversationStates: deps.conversationStates,
          globalConfigRepository: deps.globalConfigRepository,
          messenger: deps.messenger,
          bindings: deps.bindings,
          pluginConfig: deps.pluginConfig,
          runtimeDataPaths: deps.runtimeDataPaths,
          logger: deps.logger,
        },
      );
      await deps.messenger.sendTextReply({
        binding,
        text: reply.text,
        dedupeKey: `idle-destination:${binding.key}:${String(event.messageId ?? randomUUID())}`,
      });
      return { handled: true };
    }
  }

  await deps.conversationService.claimInboundMessage({
    binding,
    messageId: String(event.messageId ?? randomUUID()),
    content: trimmed,
    senderId: event.senderId ?? ctx.senderId,
    senderName: event.senderName,
    senderUsername: event.senderUsername,
  });

  return { handled: true };
}

async function recoverBindingForInbound(
  event: InboundClaimEvent,
  ctx: InboundClaimContext,
  deps: Pick<
    InboundClaimDependencies,
    "bindings" | "conversationStates" | "logger"
  >,
): Promise<ConversationBindingRecord | null> {
  const officialBinding = await getOfficialConversationBinding(event, ctx);
  const fallbackChannel = officialBinding?.channel ?? event.channel;
  const fallbackAccountId =
    officialBinding?.accountId ?? event.accountId ?? ctx.accountId ?? "default";
  const fallbackTarget =
    normalizeRoutePart(officialBinding?.conversationId) ??
    normalizeRoutePart(event.conversationId ?? ctx.conversationId) ??
    normalizeRoutePart(event.senderId ?? ctx.senderId);
  if (!fallbackTarget) {
    return null;
  }

  const fallbackThreadId = officialBinding?.threadId ?? event.threadId;
  const key = bindingKey({
    channel: fallbackChannel,
    accountId: fallbackAccountId,
    target: fallbackTarget,
    threadId: fallbackThreadId,
  });
  const existing = await deps.bindings.get(key);
  if (existing) {
    return existing;
  }

  const state = await deps.conversationStates.getByKey(key);
  if (!officialBinding && !state) {
    return null;
  }

  const record: ConversationBindingRecord = {
    key,
    bindingId: officialBinding?.bindingId,
    channel: fallbackChannel,
    accountId: fallbackAccountId,
    target: fallbackTarget,
    parentConversationId:
      officialBinding?.parentConversationId ?? event.parentConversationId,
    threadId: fallbackThreadId,
    boundAt: officialBinding?.boundAt ?? Date.now(),
    mode: state?.mode ?? "default",
    defaultPersonaId: undefined,
    lastTripId: undefined,
  };
  await deps.bindings.upsert(record);
  await logCommandBridgeEvent(deps.logger, {
    binding: record,
    runId: `binding-recover:${String(event.messageId ?? randomUUID())}`,
    event: "binding.recovered",
    decision:
      "Recovered a missing local binding record from the official binding surface or saved conversation state.",
    provider: officialBinding ? "binding-recovery:official" : "binding-recovery:state",
    status: "success",
    details: {
      recoveredFromOfficialBinding: Boolean(officialBinding),
      recoveredFromConversationState: Boolean(state),
      mode: record.mode,
      accountId: record.accountId ?? "default",
      target: record.target,
      threadId: record.threadId ?? "main",
    },
  });
  return record;
}

async function handleSetupSessionInbound(
  input: {
    event: InboundClaimEvent;
    ctx: InboundClaimContext;
    binding: NonNullable<Awaited<ReturnType<ConversationBindingStore["get"]>>>;
    state: NonNullable<Awaited<ReturnType<ConversationStateRepository["getByKey"]>>>;
    trimmed: string;
  },
  deps: InboundClaimDependencies,
): Promise<boolean> {
  const session = input.state.setupSession;
  if (!session) {
    return false;
  }

  const runId = `setup:${String(input.event.messageId ?? randomUUID())}`;
  const logConfigPatch = async (
    configPatch: Partial<
      Awaited<ReturnType<GlobalConfigRepository["get"]>>
    > | undefined,
  ) => {
    if (configPatch?.textProvider) {
      await logCommandBridgeEvent(deps.logger, {
        binding: input.binding,
        runId,
        event: "config.text_provider.updated",
        decision: "Updated the configured text provider during setup.",
        provider: "setup-session",
        status: "success",
        details: { kind: configPatch.textProvider.kind },
      });
    }
    if (configPatch?.geminiApiKey) {
      await logCommandBridgeEvent(deps.logger, {
        binding: input.binding,
        runId,
        event: "config.gemini_key.updated",
        decision: "Stored Gemini API key during setup.",
        provider: "setup-session",
        status: "success",
        details: { hasGeminiKey: true },
      });
    }
  };

  if (session.awaitingReferencePhoto) {
    const imageSource = extractInboundImageSource(input.event);
    if (!imageSource) {
      await logCommandBridgeEvent(deps.logger, {
        binding: input.binding,
        runId,
        event: "setup.photo.missing_source",
        decision:
          "Inbound message arrived while setup was waiting for a reference photo, but no usable media source was found on the event.",
        provider: "setup-session",
        status: "success",
        details: buildSetupPhotoDebugDetails(input.event),
      });
      if (input.trimmed) {
        await deps.messenger.sendTextReply({
          binding: input.binding,
          text: "我现在在等你的参考图，接下来发一张图片就行。",
          dedupeKey: `setup-photo-reminder:${input.binding.key}:${runId}`,
        });
        return true;
      }
      return false;
    }

    await logCommandBridgeEvent(deps.logger, {
      binding: input.binding,
      runId,
      event: "setup.photo.received",
      decision: "Received the next inbound image as the setup reference photo.",
      provider: "setup-session",
      status: "success",
      details: { source: imageSource },
    });
    const referenceImageAsset = await materializeReferenceImage({
      source: imageSource,
      personasDir: deps.runtimeDataPaths.personasDir,
    });
    const nextSession = advanceSetupSessionWithPhoto({
      session,
      referenceImageAsset,
    });
    if (nextSession.step === "complete") {
      await finalizeSetupSession({
        input,
        deps,
        runId,
        session: nextSession,
        globalConfig: await deps.globalConfigRepository.get(),
      });
      return true;
    }

    await deps.conversationStates.save({
      ...input.state,
      setupSession: nextSession,
      updatedAt: new Date().toISOString(),
    });
    await deps.messenger.sendTextReply({
      binding: input.binding,
      text: renderSetupStepPrompt(nextSession),
      dedupeKey: `setup-step:${input.binding.key}:${runId}`,
    });
    return true;
  }

  if (!input.trimmed) {
    return false;
  }

  const globalConfig = await deps.globalConfigRepository.get();
  let advanced: ReturnType<typeof advanceSetupSessionWithText>;
  try {
    advanced = advanceSetupSessionWithText({
      session,
      text: input.trimmed,
      globalConfig,
      fallbackGeminiApiKey: deps.pluginConfig.geminiApiKey,
    });
  } catch (error) {
    await deps.messenger.sendTextReply({
      binding: input.binding,
      text: error instanceof Error ? error.message : String(error),
      dedupeKey: `setup-error:${input.binding.key}:${runId}`,
    });
    return true;
  }

  if (advanced.cancelled) {
    await deps.conversationStates.save({
      ...input.state,
      setupSession: undefined,
      updatedAt: new Date().toISOString(),
    });
    await deps.messenger.sendTextReply({
      binding: input.binding,
      text:
        session.kind === "persona" && session.personaTargetId
          ? "已取消本次修改。"
          : "已取消本次设置。",
      dedupeKey: `setup-cancel:${input.binding.key}:${runId}`,
    });
    return true;
  }
  const mergedConfig = advanced.configPatch
    ? {
        ...globalConfig,
        ...advanced.configPatch,
        updatedAt: new Date().toISOString(),
      }
    : globalConfig;
  if (advanced.configPatch) {
    await deps.globalConfigRepository.save(mergedConfig);
  }

  if (!advanced.completed) {
    await logCommandBridgeEvent(deps.logger, {
      binding: input.binding,
      runId,
      event: "setup.step.completed",
      decision: "Accepted setup input and advanced to the next step.",
      provider: "setup-session",
      status: "success",
      details: {
        previousStep: session.step,
        nextStep: advanced.session.step,
      },
    });
    if (advanced.session.awaitingReferencePhoto) {
      await logCommandBridgeEvent(deps.logger, {
        binding: input.binding,
        runId,
        event: "setup.photo.awaiting",
        decision: "Setup wizard is now waiting for the next inbound photo.",
        provider: "setup-session",
        status: "success",
        details: { nextStep: advanced.session.step },
      });
    }
    await logConfigPatch(advanced.configPatch);
    await deps.conversationStates.save({
      ...input.state,
      setupSession: advanced.session,
      updatedAt: new Date().toISOString(),
    });
    await deps.messenger.sendTextReply({
      binding: input.binding,
      text: renderSetupStepPrompt(advanced.session),
      dedupeKey: `setup-step:${input.binding.key}:${runId}`,
    });
    return true;
  }

  await logCommandBridgeEvent(deps.logger, {
    binding: input.binding,
    runId,
    event: "setup.step.completed",
    decision: "Accepted the final setup input and completed onboarding.",
    provider: "setup-session",
    status: "success",
    details: {
      previousStep: session.step,
      nextStep: advanced.session.step,
    },
  });
  await logConfigPatch(advanced.configPatch);
  await finalizeSetupSession({
    input,
    deps,
    runId,
    session: advanced.session,
    globalConfig: mergedConfig,
  });
  return true;
}

async function finalizeSetupSession(input: {
  input: {
    event: InboundClaimEvent;
    ctx: InboundClaimContext;
    binding: NonNullable<Awaited<ReturnType<ConversationBindingStore["get"]>>>;
    state: NonNullable<
      Awaited<ReturnType<ConversationStateRepository["getByKey"]>>
    >;
    trimmed: string;
  };
  deps: InboundClaimDependencies;
  runId: string;
  session: NonNullable<
    Awaited<ReturnType<ConversationStateRepository["getByKey"]>>
  >["setupSession"];
  globalConfig: Awaited<ReturnType<GlobalConfigRepository["get"]>>;
}): Promise<void> {
  const { input: inbound, deps, runId, session, globalConfig } = input;
  if (!session) {
    return;
  }

  if (session.kind === "persona") {
    const targetPersonaId =
      session.personaTargetId ?? inbound.binding.defaultPersonaId;
    const existingPersona =
      targetPersonaId != null
        ? await deps.personaRepository.getById(targetPersonaId)
        : null;
    const isEditingExistingPersona = Boolean(existingPersona);
    const persona = createCompletedPersonaProfile({
      draft: session.draft,
      existing: existingPersona,
    });
    await deps.personaRepository.save(persona);
    const updatedBinding = {
      ...inbound.binding,
      defaultPersonaId: persona.personaId,
    };
    await deps.bindings.upsert(updatedBinding);
    const readiness = evaluateOnboardingReadiness({
      binding: updatedBinding,
      config: globalConfig,
      fallbackGeminiApiKey: deps.pluginConfig.geminiApiKey,
    });
    const nextState = {
      ...inbound.state,
      setupSession: undefined,
      idleGuideSentAt:
        readiness.isComplete && !isEditingExistingPersona
          ? new Date().toISOString()
          : inbound.state.idleGuideSentAt ?? null,
      awaitingDestination:
        readiness.isComplete && !isEditingExistingPersona,
      updatedAt: new Date().toISOString(),
    };
    await deps.conversationStates.save(nextState);
    await logCommandBridgeEvent(deps.logger, {
      binding: updatedBinding,
      runId,
      event: "setup.completed",
      decision: "Completed persona setup and persisted the current Ta profile.",
      provider: "setup-session",
      status: "success",
      details: {
        kind: session.kind,
        personaId: persona.personaId,
        textProvider: globalConfig.textProvider?.kind ?? "none",
        hasGeminiKey: Boolean(
          globalConfig.geminiApiKey?.trim() || deps.pluginConfig.geminiApiKey,
        ),
      },
    });
    await deps.messenger.sendTextReply({
      binding: updatedBinding,
      text: readiness.isComplete
        ? isEditingExistingPersona
          ? buildPersonaUpdatedMessage(persona)
          : buildIdleGuideMessage(persona)
        : [
            isEditingExistingPersona
              ? buildPersonaUpdatedMessage(persona)
              : `${persona.name} 创建完成。`,
            buildOnboardingGateMessage({
              binding: updatedBinding,
              readiness,
              hasSetupSession: false,
            }),
          ].join("\n"),
      dedupeKey: `setup-complete:${updatedBinding.key}:${persona.personaId}`,
    });
    return;
  }

  const readiness = evaluateOnboardingReadiness({
    binding: inbound.binding,
    config: globalConfig,
    fallbackGeminiApiKey: deps.pluginConfig.geminiApiKey,
  });
  const nextState = {
    ...inbound.state,
    setupSession: undefined,
    idleGuideSentAt:
      readiness.isComplete && inbound.binding.defaultPersonaId
        ? new Date().toISOString()
        : inbound.state.idleGuideSentAt ?? null,
    awaitingDestination:
      readiness.isComplete && Boolean(inbound.binding.defaultPersonaId),
    updatedAt: new Date().toISOString(),
  };
  await deps.conversationStates.save(nextState);
  await logCommandBridgeEvent(deps.logger, {
    binding: inbound.binding,
    runId,
    event: "setup.completed",
    decision: "Completed model setup and persisted provider configuration.",
    provider: "setup-session",
    status: "success",
    details: {
      kind: session.kind,
      textProvider: globalConfig.textProvider?.kind ?? "none",
      hasGeminiKey: Boolean(
        globalConfig.geminiApiKey?.trim() || deps.pluginConfig.geminiApiKey,
      ),
    },
  });

  const persona = inbound.binding.defaultPersonaId
    ? await deps.personaRepository.getById(inbound.binding.defaultPersonaId)
    : null;
  await deps.messenger.sendTextReply({
    binding: inbound.binding,
    text:
      readiness.isComplete && persona
        ? ["模型配置已更新。", buildIdleGuideMessage(persona)].join("\n")
        : [
            "模型配置已更新。",
            buildOnboardingGateMessage({
              binding: inbound.binding,
              readiness,
              hasSetupSession: false,
            }),
          ].join("\n"),
    dedupeKey: `setup-complete:${inbound.binding.key}:model`,
  });
}

function extractInboundImageSource(event: InboundClaimEvent): string | null {
  const direct = [event.mediaUrl, ...(event.mediaUrls ?? [])].filter(Boolean);
  for (const candidate of direct) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  for (const attachment of event.attachments ?? []) {
    for (const candidate of [
      attachment.path,
      attachment.url,
      attachment.mediaUrl,
    ]) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  }

  const metadataMedia = extractMetadataMediaCandidates(event.metadata);
  for (const candidate of metadataMedia) {
    if (candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function extractMetadataMediaCandidates(
  metadata: Record<string, unknown> | undefined,
): string[] {
  if (!metadata) {
    return [];
  }

  const candidates: string[] = [];
  for (const value of [
    metadata.mediaPath,
    metadata.mediaUrl,
    ...(Array.isArray(metadata.mediaPaths) ? metadata.mediaPaths : []),
    ...(Array.isArray(metadata.mediaUrls) ? metadata.mediaUrls : []),
  ]) {
    if (typeof value === "string" && value.trim()) {
      candidates.push(value);
    }
  }
  return candidates;
}

function buildSetupPhotoDebugDetails(event: InboundClaimEvent) {
  const metadata = event.metadata;
  return {
    messageId: event.messageId,
    contentPreview: event.content.slice(0, 120),
    bodyPreview: (event.body ?? "").slice(0, 120),
    hasMediaUrl:
      typeof event.mediaUrl === "string" && event.mediaUrl.trim().length > 0,
    mediaUrlsCount: Array.isArray(event.mediaUrls) ? event.mediaUrls.length : 0,
    attachmentsCount: Array.isArray(event.attachments) ? event.attachments.length : 0,
    attachmentKinds: Array.isArray(event.attachments)
      ? event.attachments.map((attachment) => ({
          kind: attachment.kind ?? null,
          contentType: attachment.contentType ?? null,
          mimeType: attachment.mimeType ?? null,
          hasPath:
            typeof attachment.path === "string" && attachment.path.trim().length > 0,
          hasUrl:
            typeof attachment.url === "string" && attachment.url.trim().length > 0,
          hasMediaUrl:
            typeof attachment.mediaUrl === "string" &&
            attachment.mediaUrl.trim().length > 0,
        }))
      : [],
    metadataKeys: metadata ? Object.keys(metadata).sort() : [],
    metadataMediaPath:
      typeof metadata?.mediaPath === "string" ? metadata.mediaPath : null,
    metadataMediaPathsCount: Array.isArray(metadata?.mediaPaths)
      ? metadata.mediaPaths.length
      : 0,
    metadataMediaType:
      typeof metadata?.mediaType === "string" ? metadata.mediaType : null,
    metadataMediaTypesCount: Array.isArray(metadata?.mediaTypes)
      ? metadata.mediaTypes.length
      : 0,
  };
}

function buildSyntheticCommandContext(
  event: InboundClaimEvent,
  ctx: InboundClaimContext,
  rawText: string,
) {
  const [, ...rest] = rawText.trim().split(/\s+/u);
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const bindingInternals = getConversationBindingInternals();
  const conversation = {
    channel: event.channel,
    accountId: event.accountId ?? ctx.accountId ?? "default",
    conversationId: event.conversationId ?? ctx.conversationId ?? "",
    parentConversationId: event.parentConversationId,
    threadId: event.threadId,
  };
  const senderId = event.senderId ?? ctx.senderId;

  return {
    senderId,
    channel: event.channel,
    isAuthorizedSender: event.commandAuthorized ?? true,
    args: rest.join(" "),
    commandBody: rawText,
    config: {},
    from: event.senderId ?? ctx.senderId ?? conversation.conversationId,
    to: conversation.conversationId,
    accountId: conversation.accountId,
    messageThreadId: event.threadId,
    threadParentId: event.parentConversationId,
    requestConversationBinding: async (binding = {}) =>
      (await bindingInternals).requestPluginConversationBinding({
        pluginId: "openclaw-travel-companion",
        pluginName: "OpenClaw Travel Companion",
        pluginRoot,
        requestedBySenderId: senderId,
        conversation,
        binding,
      }),
    detachConversationBinding: async () =>
      (await bindingInternals).detachPluginConversationBinding({
        pluginRoot,
        conversation,
      }),
    getCurrentConversationBinding: async () =>
      (await bindingInternals).getCurrentPluginConversationBinding({
        pluginRoot,
        conversation,
      }),
  } as unknown as PluginCommandContext;
}

type OfficialConversationBinding = {
  bindingId?: string;
  channel: string;
  accountId?: string;
  conversationId: string;
  parentConversationId?: string;
  threadId?: string | number;
  boundAt?: number;
};

async function getOfficialConversationBinding(
  event: InboundClaimEvent,
  ctx: InboundClaimContext,
): Promise<OfficialConversationBinding | null> {
  const conversationId = event.conversationId ?? ctx.conversationId;
  if (!conversationId) {
    return null;
  }

  try {
    const binding = await (
      await getConversationBindingInternals()
    ).getCurrentPluginConversationBinding({
      pluginRoot: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."),
      conversation: {
        channel: event.channel,
        accountId: event.accountId ?? ctx.accountId ?? "default",
        conversationId,
        parentConversationId: event.parentConversationId,
        threadId: event.threadId,
      },
    });

    if (!isOfficialConversationBinding(binding)) {
      return null;
    }
    return binding;
  } catch {
    return null;
  }
}

function getConversationBindingInternals(): Promise<ConversationBindingInternals> {
  bindingInternalsPromise ??= loadConversationBindingInternals();
  return bindingInternalsPromise;
}

export function setConversationBindingInternalsForTests(
  value?: ConversationBindingInternals,
): void {
  bindingInternalsPromise = value ? Promise.resolve(value) : undefined;
}

async function loadConversationBindingInternals(): Promise<ConversationBindingInternals> {
  const require = createRequire(import.meta.url);
  const entryPath = require.resolve("openclaw");
  const moduleUrl = pathToFileURL(
    join(dirname(entryPath), "conversation-binding-vluCrcjh.js"),
  ).href;
  const module = await import(moduleUrl);
  return {
    requestPluginConversationBinding: module.p as ConversationBindingInternals["requestPluginConversationBinding"],
    detachPluginConversationBinding: module.o as ConversationBindingInternals["detachPluginConversationBinding"],
    getCurrentPluginConversationBinding:
      module.s as ConversationBindingInternals["getCurrentPluginConversationBinding"],
  };
}

async function resolveBindingForInbound(
  event: InboundClaimEvent,
  ctx: InboundClaimContext,
  bindings: ConversationBindingStore,
): Promise<Awaited<ReturnType<ConversationBindingStore["get"]>>> {
  const channel = event.channel;
  const accountCandidates = [
    normalizeRoutePart(ctx.accountId),
    normalizeRoutePart(event.accountId),
  ].filter((value): value is string => Boolean(value));
  const targetCandidates = buildTargetCandidates(event, ctx);
  const threadCandidates = buildThreadCandidates(event.threadId);

  for (const accountId of accountCandidates.length > 0 ? accountCandidates : ["default"]) {
    for (const target of targetCandidates) {
      for (const threadId of threadCandidates) {
        const key = bindingKey({
          channel,
          accountId,
          target,
          threadId,
        });
        const match = await bindings.get(key);
        if (match) {
          return match;
        }
      }
    }
  }

  const allBindings = await bindings.list();
  return (
    allBindings.find((binding) => {
      if (binding.channel !== channel) {
        return false;
      }
      if (
        accountCandidates.length > 0 &&
        binding.accountId &&
        !accountCandidates.includes(binding.accountId)
      ) {
        return false;
      }
      if (
        event.threadId !== undefined &&
        binding.threadId !== undefined &&
        String(binding.threadId) !== String(event.threadId)
      ) {
        return false;
      }
      return targetCandidates.includes(binding.target);
    }) ?? null
  );
}

function buildTargetCandidates(
  event: InboundClaimEvent,
  ctx: InboundClaimContext,
): string[] {
  const conversationId = normalizeRoutePart(
    event.conversationId ?? ctx.conversationId,
  );
  const senderId = normalizeRoutePart(event.senderId ?? ctx.senderId);
  const rawCandidates = [conversationId, senderId].filter(
    (value): value is string => Boolean(value),
  );
  const candidates = new Set<string>();

  for (const candidate of rawCandidates) {
    candidates.add(candidate);
    if (!candidate.includes(":")) {
      candidates.add(`${event.channel}:${candidate}`);
    }
  }

  if (
    event.channel === "telegram" &&
    conversationId?.startsWith("-")
  ) {
    candidates.add(conversationId);
    candidates.add(`telegram:${conversationId}`);
  }

  return [...candidates];
}

function buildThreadCandidates(
  threadId: string | number | undefined,
): Array<string | number | undefined> {
  if (threadId === undefined || threadId === null) {
    return [undefined, "main"];
  }
  return [threadId, String(threadId)];
}

function normalizeRoutePart(value: string | number | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function isOfficialConversationBinding(
  value: unknown,
): value is OfficialConversationBinding {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.channel === "string" &&
    typeof candidate.conversationId === "string"
  );
}

async function logCommandBridgeEvent(
  logger: LoggerPort,
  input: {
    binding: { key: string };
    runId: string;
    event: string;
    decision: string;
    provider: string;
    status: "success" | "failure" | "skipped";
    startedAtMs?: number;
    errorCode?: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  const finishedAtMs = Date.now();
  const startedAtMs = input.startedAtMs ?? finishedAtMs;
  await logger.log({
    tripId: `conversation:${input.binding.key}`,
    runId: input.runId,
    phase: "system",
    event: input.event,
    decision: input.decision,
    provider: input.provider,
    status: input.status,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    latencyMs: Math.max(0, finishedAtMs - startedAtMs),
    errorCode: input.errorCode,
    details: {
      conversationKey: input.binding.key,
      ...(input.details ?? {}),
    },
  });
}
