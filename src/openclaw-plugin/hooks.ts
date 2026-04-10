import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginCommandContext } from "openclaw/plugin-sdk/plugin-entry";

import { CompanionConversationService } from "../application/companion-conversation-service.js";
import { OpenClawTravelCompanionService } from "../application/openclaw-travel-companion-service.js";
import {
  ConversationBindingStore,
  HostMessengerPort,
  LoggerPort,
  TripRepository,
} from "../domain/types.js";
import { bindingKey } from "./binding-state.js";
import { handleTravelCompanionCommand } from "./command.js";
import { TravelCompanionPluginConfig } from "./config.js";
import { RuntimeDataPaths } from "../infrastructure/json-file-repositories.js";

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

export async function handleTravelCompanionInboundClaim(
  event: InboundClaimEvent,
  ctx: InboundClaimContext,
  deps: InboundClaimDependencies,
): Promise<InboundClaimResult | void> {
  const rawText =
    event.bodyForAgent ?? event.body ?? event.transcript ?? event.content ?? "";
  const binding = await resolveBindingForInbound(event, ctx, deps.bindings);
  if (!binding || binding.mode !== "companion-exclusive") {
    return;
  }

  const trimmed = rawText.trim();
  if (trimmed.startsWith("/travel-companion")) {
    const reply = await handleTravelCompanionCommand(
      buildSyntheticCommandContext(event, ctx, rawText),
      {
        service: deps.service,
        conversationService: deps.conversationService,
        tripRepository: deps.tripRepository,
        bindings: deps.bindings,
        pluginConfig: deps.pluginConfig,
        runtimeDataPaths: deps.runtimeDataPaths,
        logger: deps.logger,
      },
    );
    await deps.messenger.sendTextReply({
      binding,
      text: reply.text,
      dedupeKey: `command:${binding.key}:${String(event.messageId ?? randomUUID())}`,
    });
    return { handled: true };
  }

  if (trimmed.startsWith("/")) {
    return;
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

function getConversationBindingInternals(): Promise<ConversationBindingInternals> {
  bindingInternalsPromise ??= loadConversationBindingInternals();
  return bindingInternalsPromise;
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
