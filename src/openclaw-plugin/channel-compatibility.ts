export function inferConversationTargetForCommand(input: {
  channel: string;
  from?: string | null;
  to?: string | null;
  senderId?: string | null;
}): string | null {
  const senderId = normalizeRoutePart(input.senderId);
  const from = normalizeRoutePart(input.from);
  const to = normalizeRoutePart(input.to);

  if (input.channel === "telegram") {
    if (to?.startsWith("-")) {
      return to;
    }
    return senderId ?? from ?? to;
  }

  if (input.channel === "feishu") {
    const userScoped = [from, to].find((value) => value?.startsWith("user:"));
    if (userScoped) {
      return userScoped;
    }
    const openId = [from, to].find((value) => value?.startsWith("ou_"));
    if (openId) {
      return `user:${openId}`;
    }
    return from ?? to ?? senderId;
  }

  return to ?? from ?? senderId;
}

export function buildInboundTargetCandidates(input: {
  channel: string;
  conversationId?: string | null;
  senderId?: string | null;
  isGroup?: boolean;
}): string[] {
  const conversationId = normalizeRoutePart(input.conversationId);
  const senderId = normalizeRoutePart(input.senderId);
  const rawCandidates = [conversationId, senderId].filter(
    (value): value is string => Boolean(value),
  );
  const candidates = new Set<string>();

  for (const candidate of rawCandidates) {
    candidates.add(candidate);
    if (!candidate.includes(":")) {
      candidates.add(`${input.channel}:${candidate}`);
    }
  }

  if (input.channel === "telegram" && conversationId?.startsWith("-")) {
    candidates.add(conversationId);
    candidates.add(`telegram:${conversationId}`);
  }

  if (input.channel === "qqbot" && !input.isGroup && senderId) {
    candidates.add(`qqbot:c2c:${senderId}`);
  }

  if (input.channel === "feishu" && senderId) {
    if (senderId.startsWith("user:")) {
      candidates.add(senderId.slice("user:".length));
    } else if (senderId.startsWith("ou_")) {
      candidates.add(`user:${senderId}`);
    }
  }

  return [...candidates];
}

function normalizeRoutePart(
  value: string | number | null | undefined,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}
