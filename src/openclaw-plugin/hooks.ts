import { randomUUID } from "node:crypto";

import { CompanionConversationService } from "../application/companion-conversation-service.js";
import { ConversationBindingStore } from "../domain/types.js";
import { bindingKey } from "./binding-state.js";

interface InboundClaimEvent {
  content: string;
  body?: string;
  bodyForAgent?: string;
  transcript?: string;
  channel: string;
  accountId?: string;
  conversationId?: string;
  senderId?: string;
  senderName?: string;
  senderUsername?: string;
  threadId?: string | number;
  messageId?: string;
  isGroup?: boolean;
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
}

export async function handleTravelCompanionInboundClaim(
  event: InboundClaimEvent,
  ctx: InboundClaimContext,
  deps: InboundClaimDependencies,
): Promise<InboundClaimResult | void> {
  const rawText =
    event.bodyForAgent ?? event.body ?? event.transcript ?? event.content ?? "";
  if (rawText.trim().startsWith("/")) {
    return;
  }

  const binding = await resolveBindingForInbound(event, ctx, deps.bindings);
  if (!binding || binding.mode !== "companion-exclusive") {
    return;
  }

  await deps.conversationService.claimInboundMessage({
    binding,
    messageId: String(event.messageId ?? randomUUID()),
    content: rawText.trim(),
    senderId: event.senderId ?? ctx.senderId,
    senderName: event.senderName,
    senderUsername: event.senderUsername,
  });

  return { handled: true };
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
