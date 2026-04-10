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

  const target = inferInboundTarget(event, ctx);
  if (!target) {
    return;
  }

  const key = bindingKey({
    channel: event.channel,
    accountId: ctx.accountId ?? event.accountId,
    target,
    threadId: event.threadId,
  });
  const binding = await deps.bindings.get(key);
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

function inferInboundTarget(
  event: InboundClaimEvent,
  ctx: InboundClaimContext,
): string | null {
  const conversationId = normalizeRoutePart(
    event.conversationId ?? ctx.conversationId,
  );
  const senderId = normalizeRoutePart(event.senderId ?? ctx.senderId);

  if (event.channel === "telegram") {
    if (conversationId?.startsWith("-")) {
      return conversationId;
    }
    return conversationId ?? senderId;
  }

  return conversationId ?? senderId;
}

function normalizeRoutePart(value: string | number | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}
