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
  SystemLocale,
  TripRepository,
} from "../domain/types.js";
import { bindingKey } from "./binding-state.js";
import { buildInboundTargetCandidates } from "./channel-compatibility.js";
import { handleTravelCompanionCommand } from "./command.js";
import { TravelCompanionPluginConfig } from "./config.js";
import {
  extractSetupImageCommandUrl,
  isSupportedSlashCommand,
  normalizeSupportedSlashCommand,
} from "./command-alias.js";
import { RuntimeDataPaths } from "../infrastructure/json-file-repositories.js";
import {
  advanceSetupSessionWithPhoto,
  advanceSetupSessionWithText,
  buildModelSetupDraft,
  buildOnboardingGateMessage,
  buildPersonaCreatedMessage,
  buildPersonaUpdatedMessage,
  createCompletedPersonaProfile,
  createSetupSession,
  evaluateOnboardingReadiness,
  renderSetupStepPrompt,
} from "./onboarding.js";
import { hasConfiguredGeminiProvider } from "./gemini-provider-config.js";
import { getSystemCatalog, getSystemLocale } from "./i18n/catalog.js";
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

interface BeforeDispatchEvent {
  content: string;
  body?: string;
  channel?: string;
  senderId?: string;
  isGroup?: boolean;
  mediaUrl?: string;
  mediaUrls?: string[];
  hasMedia?: boolean;
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

interface BeforeDispatchContext {
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  senderId?: string;
}

interface BeforeDispatchResult {
  handled: boolean;
  text?: string;
}

interface ReplyDispatchEvent {
  ctx?: {
    Body?: string;
    From?: string;
    To?: string;
    AccountId?: string;
    OriginatingChannel?: string;
    OriginatingTo?: string;
    MessageSid?: string;
    Provider?: string;
    ChatType?: string;
    MediaPath?: string;
    MediaUrl?: string;
    MediaPaths?: string[];
    MediaUrls?: string[];
    MediaType?: string;
    MediaTypes?: string[];
  };
  runId?: string;
  sessionKey?: string;
}

interface ReplyDispatchContext {
  dispatcher?: {
    getQueuedCounts?: () => Record<string, number>;
  };
}

interface ReplyDispatchResult {
  handled: boolean;
  queuedFinal: boolean;
  counts: Record<string, number>;
}

export interface InboundClaimDependencies {
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
  runtimeVersion?: string;
  logger: LoggerPort;
}

const REFERENCE_PHOTO_PROBE_WINDOW_MS = 15_000;

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
  const binding = await resolveConversationBindingForHandling(event, ctx, deps);
  if (!binding) {
    await logBindingLookupMiss(event, ctx, deps.logger);
    return;
  }

  const channel = event.channel ?? ctx.channelId;
  const rawText =
    event.bodyForAgent ?? event.body ?? event.transcript ?? event.content ?? "";
  const trimmed = sanitizeInboundText(channel, rawText);
  return await handleResolvedInboundTakeover(
    {
      event,
      ctx,
      binding,
      trimmed,
    },
    deps,
  );
}

export async function handleTravelCompanionReplyDispatch(
  event: ReplyDispatchEvent,
  ctx: ReplyDispatchContext,
  deps: InboundClaimDependencies,
): Promise<ReplyDispatchResult | void> {
  const inboundContext = event.ctx;
  const mediaPath = normalizeOptionalString(inboundContext?.MediaPath);
  const mediaUrl = normalizeOptionalString(inboundContext?.MediaUrl);
  const mediaPaths = Array.isArray(inboundContext?.MediaPaths)
    ? inboundContext.MediaPaths.filter((value): value is string => typeof value === "string")
    : [];
  const mediaUrls = Array.isArray(inboundContext?.MediaUrls)
    ? inboundContext.MediaUrls.filter((value): value is string => typeof value === "string")
    : [];
  if (!mediaPath && !mediaUrl && mediaPaths.length === 0 && mediaUrls.length === 0) {
    return;
  }

  const channel =
    normalizeOptionalString(inboundContext?.OriginatingChannel) ??
    normalizeOptionalString(inboundContext?.Provider);
  if (!channel) {
    return;
  }

  const syntheticEvent: InboundClaimEvent = {
    content: inboundContext?.Body ?? "",
    body: inboundContext?.Body ?? "",
    bodyForAgent: inboundContext?.Body ?? "",
    channel,
    accountId: normalizeOptionalString(inboundContext?.AccountId),
    conversationId:
      normalizeOptionalString(inboundContext?.OriginatingTo) ??
      normalizeOptionalString(inboundContext?.To) ??
      normalizeOptionalString(inboundContext?.From),
    senderId: normalizeOptionalString(inboundContext?.From),
    messageId: normalizeOptionalString(inboundContext?.MessageSid),
    isGroup: inboundContext?.ChatType === "group",
    mediaUrl,
    mediaUrls,
    metadata: {
      mediaPath,
      mediaUrl,
      mediaPaths,
      mediaUrls,
      mediaType: inboundContext?.MediaType,
      mediaTypes: inboundContext?.MediaTypes,
    },
    attachments: [
      ...[mediaPath, ...mediaPaths].filter(Boolean).map((path) => ({
        path,
        contentType: inboundContext?.MediaType,
        kind: "image",
      })),
      ...[mediaUrl, ...mediaUrls].filter(Boolean).map((url) => ({
        url,
        contentType: inboundContext?.MediaType,
        kind: "image",
      })),
    ],
  };
  const syntheticContext: InboundClaimContext = {
    channelId: channel,
    accountId: syntheticEvent.accountId,
    conversationId: syntheticEvent.conversationId,
    senderId: syntheticEvent.senderId,
    messageId: syntheticEvent.messageId,
  };
  const binding = await resolveConversationBindingForHandling(
    syntheticEvent,
    syntheticContext,
    deps,
  );
  if (!binding) {
    await logBindingLookupMiss(syntheticEvent, syntheticContext, deps.logger);
    return;
  }

  const state = await deps.conversationStates.getByKey(binding.key);
  if (!state?.setupSession?.awaitingReferencePhoto) {
    return;
  }

  const handled = await handleResolvedInboundTakeover(
    {
      event: syntheticEvent,
      ctx: syntheticContext,
      binding,
      trimmed: (inboundContext?.Body ?? "").trim(),
      state,
    },
    deps,
  );
  if (handled?.handled) {
    return {
      handled: true,
      queuedFinal: true,
      counts: ctx.dispatcher?.getQueuedCounts?.() ?? {},
    };
  }
}

export async function handleTravelCompanionBeforeDispatch(
  event: BeforeDispatchEvent,
  ctx: BeforeDispatchContext,
  deps: InboundClaimDependencies,
): Promise<BeforeDispatchResult | void> {
  const channel = event.channel ?? ctx.channelId;
  if (!channel) {
    return;
  }

  const rawText = event.body ?? event.content ?? "";
  const trimmed = sanitizeInboundText(channel, rawText);
  if (trimmed.startsWith("/")) {
    return;
  }

  const syntheticEvent: InboundClaimEvent = {
    content: event.content,
    body: event.body,
    bodyForAgent: event.body,
    channel,
    accountId: ctx.accountId,
    conversationId: ctx.conversationId,
    senderId: event.senderId ?? ctx.senderId,
    isGroup: event.isGroup ?? false,
    mediaUrl: event.mediaUrl,
    mediaUrls: event.mediaUrls,
    metadata: event.metadata,
    attachments: event.attachments,
  };
  const imageSource = extractInboundImageSource(syntheticEvent);
  if (!trimmed && !imageSource && !event.hasMedia) {
    return;
  }
  const syntheticContext: InboundClaimContext = {
    channelId: channel,
    accountId: ctx.accountId,
    conversationId: ctx.conversationId,
    senderId: event.senderId ?? ctx.senderId,
  };
  const binding = await resolveConversationBindingForHandling(
    syntheticEvent,
    syntheticContext,
    deps,
  );
  if (!binding) {
    return;
  }

  const state = await deps.conversationStates.getByKey(binding.key);
  if (!state?.setupSession && binding.mode !== "companion-exclusive") {
    return;
  }
  if (
    !trimmed &&
    !(
      state?.setupSession?.awaitingReferencePhoto &&
      (imageSource || event.hasMedia)
    )
  ) {
    return;
  }

  const handled = await handleResolvedInboundTakeover(
    {
      event: syntheticEvent,
      ctx: syntheticContext,
      binding,
      trimmed,
      state,
    },
    deps,
  );
  if (handled?.handled) {
    return { handled: true };
  }
}

async function resolveConversationBindingForHandling(
  event: InboundClaimEvent,
  ctx: InboundClaimContext,
  deps: Pick<
    InboundClaimDependencies,
    "bindings" | "conversationStates" | "logger"
  >,
): Promise<ConversationBindingRecord | null> {
  return (
    (await resolveBindingForInbound(event, ctx, deps.bindings)) ??
    (await recoverBindingForInbound(event, ctx, deps))
  );
}

async function handleResolvedInboundTakeover(
  input: {
    event: InboundClaimEvent;
    ctx: InboundClaimContext;
    binding: ConversationBindingRecord;
    trimmed: string;
    state?: Awaited<ReturnType<ConversationStateRepository["getByKey"]>>;
  },
  deps: InboundClaimDependencies,
): Promise<InboundClaimResult | void> {
  const state =
    input.state ?? (await deps.conversationStates.getByKey(input.binding.key));

  if (state?.setupSession) {
    const handled = await handleSetupSessionInbound(
      {
        event: input.event,
        ctx: input.ctx,
        binding: input.binding,
        state,
        trimmed: input.trimmed,
      },
      deps,
    );
    if (handled) {
      return { handled: true };
    }
  }

  if (isSupportedSlashCommand(input.trimmed)) {
    const normalizedCommandBody = normalizeSupportedSlashCommand(
      input.event.bodyForAgent ??
        input.event.body ??
        input.event.transcript ??
        input.event.content ??
        "",
    );
    const messageId = String(input.event.messageId ?? "");
    const duplicateByMessageId =
      messageId.length > 0
        ? await deps.conversationService.isInboundCommandDuplicate({
            conversationKey: input.binding.key,
            messageId,
          })
        : false;
    const inFlightKey =
      messageId.length > 0
        ? `${input.binding.key}:${messageId}`
        : `${input.binding.key}:${normalizedCommandBody}`;
    const inFlightBodyKey = `${input.binding.key}:${normalizedCommandBody}`;
    if (duplicateByMessageId || inFlightCommandKeys.has(inFlightKey) || inFlightCommandBodies.has(inFlightBodyKey)) {
      await logCommandBridgeEvent(deps.logger, {
        binding: input.binding,
        runId: `command:${messageId || randomUUID()}`,
        event: "command.bridge.duplicate",
        decision:
          "Skipped a duplicate bridged companion slash command delivery.",
        provider: "inbound-claim",
        status: "skipped",
        details: {
          commandBody: normalizedCommandBody,
          messageId,
          mode: input.binding.mode,
          duplicateByMessageId,
        },
      });
      return { handled: true };
    }

    inFlightCommandKeys.add(inFlightKey);
    inFlightCommandBodies.add(inFlightBodyKey);
    const commandRunId = `command:${String(input.event.messageId ?? randomUUID())}`;
    try {
      await logCommandBridgeEvent(deps.logger, {
        binding: input.binding,
        runId: commandRunId,
        event: "command.bridge.received",
        decision: "Received a companion slash command inside a companion-exclusive conversation.",
        provider: "inbound-claim",
        status: "success",
        details: {
          commandBody: normalizedCommandBody,
          messageId,
          mode: input.binding.mode,
        },
      });

      const commandStartedAt = Date.now();
      const reply = await handleTravelCompanionCommand(
        buildSyntheticCommandContext(
          input.event,
          input.ctx,
          normalizedCommandBody,
        ),
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
          runtimeVersion: deps.runtimeVersion,
          logger: deps.logger,
        },
      );
      await logCommandBridgeEvent(deps.logger, {
        binding: input.binding,
        runId: commandRunId,
        event: "command.bridge.executed",
        decision: "Executed the bridged companion slash command.",
        provider: "command-handler",
        status: "success",
        startedAtMs: commandStartedAt,
        details: {
          commandBody: normalizedCommandBody,
          messageId,
          isError: reply.isError ?? false,
        },
      });

      const replyStartedAt = Date.now();
      await deps.messenger.sendTextReply({
        binding: input.binding,
        text: reply.text,
        dedupeKey: `command:${input.binding.key}:${String(input.event.messageId ?? randomUUID())}`,
      });
      await logCommandBridgeEvent(deps.logger, {
        binding: input.binding,
        runId: commandRunId,
        event: "command.bridge.replied",
        decision: "Delivered bridged slash-command output back into the bound conversation.",
        provider: "command-bridge",
        status: "success",
        startedAtMs: replyStartedAt,
        details: {
          commandBody: normalizedCommandBody,
          messageId,
          replyLength: reply.text.length,
        },
      });
      await deps.conversationService.rememberHandledInboundCommand({
        conversationKey: input.binding.key,
        messageId: messageId || undefined,
      });
    } catch (error) {
      await logCommandBridgeEvent(deps.logger, {
        binding: input.binding,
        runId: commandRunId,
        event: "command.bridge.reply_failed",
        decision: "Failed to deliver bridged slash-command output back into the bound conversation.",
        provider: "command-bridge",
        status: "failure",
        startedAtMs: Date.now(),
        errorCode: error instanceof Error ? error.name : "command_bridge_reply_failed",
        details: {
          commandBody: normalizedCommandBody,
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

  if (input.binding.mode !== "companion-exclusive") {
    return;
  }

  if (input.trimmed.startsWith("/")) {
    return;
  }

  await deps.conversationService.claimInboundMessage({
    binding: input.binding,
    messageId: String(input.event.messageId ?? randomUUID()),
    content: input.trimmed,
    senderId: input.event.senderId ?? input.ctx.senderId,
    senderName: input.event.senderName,
    senderUsername: input.event.senderUsername,
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

  const locale = getSystemLocale(input.state);
  const catalog = getSystemCatalog(locale);
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
    if (configPatch?.geminiApiKey || configPatch?.geminiProvider?.apiKey) {
      await logCommandBridgeEvent(deps.logger, {
        binding: input.binding,
        runId,
        event: "config.gemini_key.updated",
        decision:
          "Stored planning/image provider credentials during setup.",
        provider: "setup-session",
        status: "success",
        details: {
          hasGeminiKey: true,
          providerKind: configPatch.geminiProvider?.kind ?? "google-direct",
        },
      });
    }
  };

  if (session.awaitingReferencePhoto) {
    const imageSource =
      extractInboundImageSource(input.event) ??
      extractReferenceImageSourceFromText(input.trimmed);
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
      if (shouldStartReferencePhotoProbe(input.event, input.trimmed)) {
        const existingProbe = input.state.pendingReferencePhotoProbe;
        const now = new Date();
        const nextProbe = existingProbe ?? {
          startedAt: now.toISOString(),
          deadlineAt: new Date(
            now.getTime() + REFERENCE_PHOTO_PROBE_WINDOW_MS,
          ).toISOString(),
          noticeSentAt: null,
          fallbackSentAt: null,
        };
        await deps.conversationStates.save({
          ...input.state,
          pendingReferencePhotoProbe: {
            ...nextProbe,
            noticeSentAt: nextProbe.noticeSentAt ?? now.toISOString(),
          },
          updatedAt: now.toISOString(),
        });
        if (!existingProbe?.noticeSentAt) {
          await deps.messenger.sendTextReply({
            binding: input.binding,
            text:
              catalog.setup.photoChecking ??
              catalog.setup.errorWaitingForPhotoWithFallback,
            dedupeKey: `setup-photo-checking:${input.binding.key}`,
          });
        }
        return true;
      }
      if (input.trimmed) {
        await deps.messenger.sendTextReply({
          binding: input.binding,
          text: catalog.setup.errorWaitingForPhotoWithFallback,
          dedupeKey: `setup-photo-reminder:${input.binding.key}:${runId}`,
        });
        return true;
      }
      return false;
    }

    return await completeSetupReferencePhotoFromSource({
      binding: input.binding,
      state: input.state,
      deps,
      runId,
      imageSource,
      sourceKind: "inbound-hook",
    });
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
      locale,
      globalConfig,
      fallbackGeminiApiKey: deps.pluginConfig.geminiApiKey,
      fallbackOpenRouterApiKey: deps.pluginConfig.openrouterApiKey,
    });
  } catch (error) {
    if (session.kind === "locale") {
      await logCommandBridgeEvent(deps.logger, {
        binding: input.binding,
        runId,
        event: "locale.selection.invalid_input",
        decision: "Rejected invalid locale selection input.",
        provider: "setup-session",
        status: "failure",
        details: {
          input: input.trimmed,
        },
      });
    }
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
          ? catalog.setup.cancelledEdit
          : catalog.setup.cancelledCreate,
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
      pendingReferencePhotoProbe: undefined,
      updatedAt: new Date().toISOString(),
    });
    await deps.messenger.sendTextReply({
      binding: input.binding,
      text: renderSetupStepPrompt(advanced.session, locale),
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
    selectedLocale: advanced.selectedLocale,
  });
  return true;
}

export async function completeSetupReferencePhotoFromSource(input: {
  binding: NonNullable<Awaited<ReturnType<ConversationBindingStore["get"]>>>;
  state: NonNullable<Awaited<ReturnType<ConversationStateRepository["getByKey"]>>>;
  deps: InboundClaimDependencies;
  runId: string;
  imageSource: string;
  sourceKind: "inbound-hook" | "media-inbound-fallback";
}): Promise<boolean> {
  const session = input.state.setupSession;
  if (!session?.awaitingReferencePhoto) {
    return false;
  }

  const locale = getSystemLocale(input.state);
  await logCommandBridgeEvent(input.deps.logger, {
    binding: input.binding,
    runId: input.runId,
    event: "setup.photo.received",
    decision: "Received the next inbound image as the setup reference photo.",
    provider: "setup-session",
    status: "success",
    details: {
      source: input.imageSource,
      sourceKind: input.sourceKind,
    },
  });

  let referenceImageAsset: string;
  try {
    referenceImageAsset = await materializeReferenceImage({
      source: input.imageSource,
      personasDir: input.deps.runtimeDataPaths.personasDir,
    });
  } catch (error) {
    await logCommandBridgeEvent(input.deps.logger, {
      binding: input.binding,
      runId: input.runId,
      event: "setup.photo.materialize_failed",
      decision: "Failed to materialize the inbound setup reference photo.",
      provider: "setup-session",
      status: "failure",
      errorCode: "setup_reference_photo_materialize_failed",
      details: {
        sourceKind: input.sourceKind,
        message: error instanceof Error ? error.message : String(error),
      },
    });
    await input.deps.messenger.sendTextReply({
      binding: input.binding,
      text: getSystemCatalog(locale).setup.errorImageDownloadFailed,
      dedupeKey: `setup-photo-error:${input.binding.key}:${input.runId}`,
    });
    return true;
  }

  const nextSession = advanceSetupSessionWithPhoto({
    session,
    referenceImageAsset,
    locale,
  });
  if (nextSession.step === "complete") {
    await finalizeSetupSession({
      input: {
        event: {
          content: "",
          channel: input.binding.channel,
          accountId: input.binding.accountId,
          conversationId: input.binding.target,
          parentConversationId: input.binding.parentConversationId,
          threadId: input.binding.threadId,
        },
        ctx: {
          channelId: input.binding.channel,
          accountId: input.binding.accountId,
          conversationId: input.binding.target,
        },
        binding: input.binding,
        state: input.state,
        trimmed: "",
      },
      deps: input.deps,
      runId: input.runId,
      session: nextSession,
      globalConfig: await input.deps.globalConfigRepository.get(),
      selectedLocale: undefined,
    });
    return true;
  }

  await input.deps.conversationStates.save({
    ...input.state,
    setupSession: nextSession,
    pendingReferencePhotoProbe: undefined,
    updatedAt: new Date().toISOString(),
  });
  await input.deps.messenger.sendTextReply({
    binding: input.binding,
    text: renderSetupStepPrompt(nextSession, locale),
    dedupeKey: `setup-step:${input.binding.key}:${input.runId}`,
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
  selectedLocale?: SystemLocale;
}): Promise<void> {
  const {
    input: inbound,
    deps,
    runId,
    session,
    globalConfig,
    selectedLocale,
  } = input;
  if (!session) {
    return;
  }

  const locale = getSystemLocale(inbound.state);
  const catalog = getSystemCatalog(locale);

  if (session.kind === "locale") {
    const localeToPersist = selectedLocale ?? locale;
    const nextState = {
      ...inbound.state,
      systemLocale: localeToPersist,
      setupSession: undefined,
      pendingReferencePhotoProbe: undefined,
      updatedAt: new Date().toISOString(),
    };
    await deps.conversationStates.save(nextState);
    await logCommandBridgeEvent(deps.logger, {
      binding: inbound.binding,
      runId,
      event: "locale.selection.completed",
      decision: "Persisted system locale selection.",
      provider: "setup-session",
      status: "success",
      details: {
        locale: localeToPersist,
      },
    });

    const selectedCatalog = getSystemCatalog(localeToPersist);
    const readiness = evaluateOnboardingReadiness({
      binding: inbound.binding,
      config: globalConfig,
      fallbackGeminiApiKey: deps.pluginConfig.geminiApiKey,
      fallbackOpenRouterApiKey: deps.pluginConfig.openrouterApiKey,
    });
    if (readiness.isComplete && !inbound.binding.lastTripId && !nextState.awaitingDestination) {
      await deps.conversationService.enterIdleAwaitingDestination({
        binding: inbound.binding,
        sendGuideNow: true,
        reason: "activate",
      });
    }
    await deps.messenger.sendTextReply({
      binding: inbound.binding,
      text: [
        selectedCatalog.setup.localeSelectionPersisted(
          selectedCatalog.locale.eventLabel(localeToPersist),
        ),
        selectedCatalog.command.activateEnabled,
        readiness.isComplete
          ? selectedCatalog.command.activateReady
          : selectedCatalog.onboarding.gateFirstTime,
      ].join("\n"),
      dedupeKey: `setup-complete:${inbound.binding.key}:locale`,
    });
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
      fallbackOpenRouterApiKey: deps.pluginConfig.openrouterApiKey,
    });
    const shouldSendImmediateIdleGuide =
      readiness.isComplete &&
      !isEditingExistingPersona &&
      !inbound.state.awaitingDestination &&
      !inbound.state.idleGuideSentAt;
    const nextState = {
      ...inbound.state,
      systemLocale: inbound.state.systemLocale,
      setupSession: undefined,
      pendingReferencePhotoProbe: undefined,
      idleEnteredAt:
        readiness.isComplete && !isEditingExistingPersona
          ? new Date().toISOString()
          : inbound.state.idleEnteredAt ?? null,
      idleGuideSentAt:
        readiness.isComplete && !isEditingExistingPersona
          ? null
          : inbound.state.idleGuideSentAt ?? null,
      awaitingDestination:
        readiness.isComplete && !isEditingExistingPersona
          ? true
          : inbound.state.awaitingDestination,
      pendingDestinationCandidate: null,
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
        hasGeminiKey: hasConfiguredGeminiProvider({
          globalConfig,
          pluginConfig: deps.pluginConfig,
        }),
      },
    });

    if (!readiness.isComplete) {
      const modelSession = createSetupSession({
        kind: "model",
        draft: buildModelSetupDraft(globalConfig),
      });
      const continuedState = {
        ...nextState,
        setupSession: modelSession,
        updatedAt: new Date().toISOString(),
      };
      await deps.conversationStates.save(continuedState);
      await deps.logger?.log({
        tripId: `conversation:${updatedBinding.key}`,
        runId: `setup-model-continue:${Date.now()}`,
        phase: "system",
        event: "setup.session.started",
        decision:
          "Continued directly into model setup after persona setup completed during onboarding.",
        provider: "setup-session",
        status: "success",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        latencyMs: 0,
        details: {
          conversationKey: updatedBinding.key,
          kind: "model",
          step: modelSession.step,
          trigger: "persona-complete-onboarding",
        },
      });
      await deps.messenger.sendTextReply({
        binding: updatedBinding,
        text: [
          isEditingExistingPersona
            ? buildPersonaUpdatedMessage(persona, locale)
            : buildPersonaCreatedMessage(persona, locale),
          catalog.onboarding.setupContinueModel,
          renderSetupStepPrompt(modelSession, locale),
        ].join("\n\n"),
        dedupeKey: `setup-complete:${updatedBinding.key}:${persona.personaId}:continue-model`,
      });
      return;
    }

    await deps.messenger.sendTextReply({
      binding: updatedBinding,
      text: isEditingExistingPersona
        ? buildPersonaUpdatedMessage(persona, locale)
        : buildPersonaCreatedMessage(persona, locale),
      dedupeKey: `setup-complete:${updatedBinding.key}:${persona.personaId}`,
    });
    if (shouldSendImmediateIdleGuide) {
      await deps.conversationService.enterIdleAwaitingDestination({
        binding: updatedBinding,
        sendGuideNow: true,
        reason: "first_onboarding_complete",
      });
    }
    return;
  }

  const readiness = evaluateOnboardingReadiness({
    binding: inbound.binding,
    config: globalConfig,
    fallbackGeminiApiKey: deps.pluginConfig.geminiApiKey,
    fallbackOpenRouterApiKey: deps.pluginConfig.openrouterApiKey,
  });
  const shouldSendImmediateIdleGuide =
    readiness.isComplete &&
    Boolean(inbound.binding.defaultPersonaId) &&
    !inbound.state.awaitingDestination &&
    !inbound.state.idleGuideSentAt;
  const nextState = {
    ...inbound.state,
    systemLocale: inbound.state.systemLocale,
    setupSession: undefined,
    pendingReferencePhotoProbe: undefined,
    idleEnteredAt:
      readiness.isComplete && inbound.binding.defaultPersonaId
        ? new Date().toISOString()
        : inbound.state.idleEnteredAt ?? null,
    idleGuideSentAt:
      readiness.isComplete && inbound.binding.defaultPersonaId
        ? null
        : inbound.state.idleGuideSentAt ?? null,
    awaitingDestination:
      readiness.isComplete && Boolean(inbound.binding.defaultPersonaId)
        ? true
        : inbound.state.awaitingDestination,
    pendingDestinationCandidate: null,
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
      hasGeminiKey: hasConfiguredGeminiProvider({
        globalConfig,
        pluginConfig: deps.pluginConfig,
      }),
    },
  });

  const persona = inbound.binding.defaultPersonaId
    ? await deps.personaRepository.getById(inbound.binding.defaultPersonaId)
    : null;
  await deps.messenger.sendTextReply({
    binding: inbound.binding,
    text:
      readiness.isComplete && persona
        ? catalog.onboarding.modelUpdated
        : [
            catalog.onboarding.modelUpdated,
            buildOnboardingGateMessage({
              binding: inbound.binding,
              readiness,
              setupSession: null,
              locale,
            }),
          ].join("\n"),
    dedupeKey: `setup-complete:${inbound.binding.key}:model`,
  });
  if (shouldSendImmediateIdleGuide && persona) {
    await deps.conversationService.enterIdleAwaitingDestination({
      binding: inbound.binding,
      sendGuideNow: true,
      reason: "first_onboarding_complete",
    });
  }
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

function shouldStartReferencePhotoProbe(
  event: InboundClaimEvent,
  trimmedText: string,
): boolean {
  const normalizedChannel = event.channel?.trim().toLowerCase();
  if (!trimmedText) {
    return true;
  }

  if (
    typeof event.mediaUrl === "string" && event.mediaUrl.trim().length > 0
  ) {
    return true;
  }
  if (Array.isArray(event.mediaUrls) && event.mediaUrls.length > 0) {
    return true;
  }
  if (Array.isArray(event.attachments) && event.attachments.length > 0) {
    return true;
  }

  const metadata = event.metadata;
  if (
    metadata &&
    ["mediaPath", "mediaUrl", "mediaPaths", "mediaUrls", "mediaType", "mediaTypes"].some(
      (key) => key in metadata,
    )
  ) {
    return true;
  }

  if (shouldPreserveMediaPlaceholder(event.channel, trimmedText)) {
    return true;
  }

  if (normalizedChannel === "feishu") {
    if (
      /^(?:\[(?:image|图片|photo)\]|<(?:image|photo)>|图片|image|photo)$/iu.test(
        trimmedText,
      )
    ) {
      return true;
    }
  }

  return /(?:^|\n)\s*-\s*(?:图片|image)\s*:/iu.test(trimmedText);
}

function extractReferenceImageSourceFromText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const candidate =
    extractSetupImageCommandUrl(trimmed) ??
    trimmed.match(/https?:\/\/\S+/iu)?.[0] ??
    extractEmbeddedLocalImagePath(trimmed) ??
    null;
  if (!candidate) {
    return null;
  }

  return candidate.trim().replace(/[),.;!?]+$/u, "");
}

function extractEmbeddedLocalImagePath(text: string): string | null {
  const explicitLabelMatch = text.match(
    /(?:^|\n)\s*-\s*(?:图片|image)\s*:\s*((?:[A-Za-z]:[\\/]|\/)\S+)/iu,
  );
  if (explicitLabelMatch?.[1]) {
    return explicitLabelMatch[1];
  }

  const absolutePathMatch = text.match(
    /((?:[A-Za-z]:[\\/]|\/)\S+\.(?:png|jpe?g|webp|gif|bmp))/iu,
  );
  return absolutePathMatch?.[1] ?? null;
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
    "default",
  ].filter(
    (value, index, array): value is string =>
      Boolean(value) && array.indexOf(value) === index,
  );
  const targetCandidates = buildTargetCandidates(event, ctx);
  const threadCandidates = buildThreadCandidates(event.threadId);

  for (const accountId of accountCandidates) {
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

async function logBindingLookupMiss(
  event: InboundClaimEvent,
  ctx: InboundClaimContext,
  logger: LoggerPort,
): Promise<void> {
  const targetCandidates = buildTargetCandidates(event, ctx);
  const accountCandidates = [
    normalizeRoutePart(ctx.accountId),
    normalizeRoutePart(event.accountId),
    "default",
  ].filter(
    (value, index, array): value is string =>
      Boolean(value) && array.indexOf(value) === index,
  );
  const threadCandidates = buildThreadCandidates(event.threadId).map((value) =>
    value === undefined || value === null ? "main" : String(value),
  );

  await logCommandBridgeEvent(logger, {
    binding: {
      key: `lookup-miss:${event.channel}:${event.accountId ?? ctx.accountId ?? "default"}`,
    },
    runId: `binding-miss:${String(event.messageId ?? randomUUID())}`,
    event: "binding.lookup_miss",
    decision:
      "Skipped inbound takeover because no local or recoverable binding matched the incoming conversation envelope.",
    provider: "inbound-claim",
    status: "skipped",
    details: {
      channel: event.channel,
      accountId: event.accountId ?? ctx.accountId ?? null,
      conversationId: event.conversationId ?? ctx.conversationId ?? null,
      senderId: event.senderId ?? ctx.senderId ?? null,
      threadId: event.threadId ?? null,
      isGroup: event.isGroup ?? null,
      targetCandidates,
      accountCandidates,
      threadCandidates,
    },
  });
}

function buildTargetCandidates(
  event: InboundClaimEvent,
  ctx: InboundClaimContext,
): string[] {
  return buildInboundTargetCandidates({
    channel: event.channel,
    conversationId: normalizeRoutePart(event.conversationId ?? ctx.conversationId),
    senderId: normalizeRoutePart(event.senderId ?? ctx.senderId),
    isGroup: event.isGroup,
  });
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

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = normalizeRoutePart(value);
  return normalized ?? undefined;
}

function sanitizeInboundText(
  channel: string | undefined,
  value: string,
): string {
  const normalizedChannel = channel?.trim().toLowerCase();
  switch (normalizedChannel) {
    case "feishu":
      return sanitizeFeishuInboundText(value);
    case "telegram":
    case "openclaw-weixin":
    case "weixin":
    case "wechat":
      return sanitizeMediaPlaceholderAwareInboundText(channel, value);
    default:
      return sanitizeDefaultInboundText(value);
  }
}

function shouldPreserveMediaPlaceholder(
  channel: string | undefined,
  value: string,
): boolean {
  if (!/^<media:[^>]+>$/iu.test(value.trim())) {
    return false;
  }

  const normalizedChannel = channel?.trim().toLowerCase();
  return (
    normalizedChannel === "telegram" ||
    normalizedChannel === "openclaw-weixin" ||
    normalizedChannel === "weixin" ||
    normalizedChannel === "wechat"
  );
}

function sanitizeDefaultInboundText(value: string): string {
  const candidate = extractInboundCandidateLine(value);
  const speakerPrefixMatch = candidate.match(/^([^\s:：]{1,32})[:：]\s*(.+)$/u);
  if (speakerPrefixMatch) {
    const messageText = speakerPrefixMatch[2];
    if (messageText) {
      return messageText.trim();
    }
  }
  return candidate.trim();
}

function sanitizeMediaPlaceholderAwareInboundText(
  channel: string | undefined,
  value: string,
): string {
  const candidate = extractInboundCandidateLine(value);
  if (shouldPreserveMediaPlaceholder(channel, candidate)) {
    return candidate.trim();
  }
  return sanitizeDefaultInboundText(value);
}

function sanitizeFeishuInboundText(value: string): string {
  const candidate = extractInboundCandidateLine(value);
  const senderIdPrefixMatch = candidate.match(
    /^((?:user:)?ou_[^:：\s]+)[:：]\s*(.+)$/u,
  );
  if (senderIdPrefixMatch?.[2]) {
    return senderIdPrefixMatch[2].trim();
  }

  const speakerPrefixMatch = candidate.match(/^([^\s:：]{1,64})[:：]\s*(.+)$/u);
  if (speakerPrefixMatch?.[2]) {
    return speakerPrefixMatch[2].trim();
  }

  return candidate.trim();
}

function extractInboundCandidateLine(value: string): string {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\[message_id:\s*[^\]]+\]$/iu.test(line));

  return lines.length > 0 ? lines.at(-1)! : value.trim();
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
