import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { bindingKey } from "../../../src/openclaw-plugin/binding-state.js";
import type {
  SaasDataStore,
  SaasPersonaRecord,
  SaasUser,
  ProvisioningSessionRecord,
  TelegramBotRecord,
  TelegramChatRecord,
  TelegramLoginProfile,
} from "./types.js";

interface SaasState {
  users: Record<string, SaasUser>;
  personas: Record<string, SaasPersonaRecord>;
  provisioningSessions: Record<string, ProvisioningSessionRecord>;
  telegramBots: Record<string, TelegramBotRecord>;
  telegramChats: Record<string, TelegramChatRecord>;
  processedUpdates: Record<string, number[]>;
}

const emptyState = (): SaasState => ({
  users: {},
  personas: {},
  provisioningSessions: {},
  telegramBots: {},
  telegramChats: {},
  processedUpdates: {},
});

export class JsonSaasDataStore implements SaasDataStore {
  private readonly statePath: string;

  constructor(rootDir: string) {
    this.statePath = join(rootDir, "saas-state.json");
  }

  async upsertTelegramUser(profile: TelegramLoginProfile): Promise<SaasUser> {
    const now = new Date().toISOString();
    const state = await this.readState();
    const existing = Object.values(state.users).find(
      (user) => user.telegramId === profile.id,
    );
    const displayName = [profile.first_name, profile.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() || profile.username || `Telegram ${profile.id}`;
    const next: SaasUser = {
      id: existing?.id ?? randomUUID(),
      telegramId: profile.id,
      telegramUsername: profile.username,
      displayName,
      photoUrl: profile.photo_url,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    state.users[next.id] = next;
    await this.writeState(state);
    return next;
  }

  async getUser(id: string): Promise<SaasUser | null> {
    return (await this.readState()).users[id] ?? null;
  }

  async getUserByTelegramId(telegramId: number): Promise<SaasUser | null> {
    return (
      Object.values((await this.readState()).users).find(
        (user) => user.telegramId === telegramId,
      ) ?? null
    );
  }

  async savePersona(persona: SaasPersonaRecord): Promise<void> {
    const state = await this.readState();
    state.personas[persona.personaId] = persona;
    await this.writeState(state);
  }

  async getPersona(personaId: string): Promise<SaasPersonaRecord | null> {
    return (await this.readState()).personas[personaId] ?? null;
  }

  async getLatestPersonaForUser(userId: string): Promise<SaasPersonaRecord | null> {
    return (
      Object.values((await this.readState()).personas)
        .filter((persona) => persona.ownerUserId === userId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ??
      null
    );
  }

  async createProvisioningSession(input: {
    user: SaasUser;
    persona: SaasPersonaRecord;
    managerBotUsername: string;
  }): Promise<ProvisioningSessionRecord> {
    const now = new Date().toISOString();
    const state = await this.readState();
    const requestId = randomRequestId();
    const suggestedUsername = buildSuggestedBotUsername(
      input.persona.name,
      input.user.telegramId,
      requestId,
    );
    const suggestedName = input.persona.name;
    const createBotUrl =
      `https://t.me/newbot/${encodeURIComponent(input.managerBotUsername)}` +
      `/${encodeURIComponent(suggestedUsername)}?name=${encodeURIComponent(suggestedName)}`;
    const session: ProvisioningSessionRecord = {
      id: randomUUID(),
      userId: input.user.id,
      personaId: input.persona.personaId,
      requestId,
      suggestedName,
      suggestedUsername,
      createBotUrl,
      status: "pending_user_confirmation",
      createdAt: now,
      updatedAt: now,
    };
    state.provisioningSessions[session.id] = session;
    await this.writeState(state);
    return session;
  }

  async getProvisioningSession(id: string): Promise<ProvisioningSessionRecord | null> {
    return (await this.readState()).provisioningSessions[id] ?? null;
  }

  async findPendingProvisioningForTelegramUser(
    telegramId: number,
  ): Promise<ProvisioningSessionRecord | null> {
    const state = await this.readState();
    const user = Object.values(state.users).find(
      (candidate) => candidate.telegramId === telegramId,
    );
    if (!user) {
      return null;
    }
    return (
      Object.values(state.provisioningSessions)
        .filter(
          (session) =>
            session.userId === user.id &&
            (session.status === "pending_user_confirmation" ||
              session.status === "configuring"),
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ??
      null
    );
  }

  async markProvisioningConfiguring(id: string): Promise<ProvisioningSessionRecord> {
    return await this.patchProvisioning(id, { status: "configuring" });
  }

  async markProvisioningReady(input: {
    provisioningId: string;
    botId: string;
  }): Promise<ProvisioningSessionRecord> {
    return await this.patchProvisioning(input.provisioningId, {
      status: "ready",
      botId: input.botId,
      errorMessage: undefined,
    });
  }

  async markProvisioningFailed(input: {
    provisioningId: string;
    errorMessage: string;
  }): Promise<ProvisioningSessionRecord> {
    return await this.patchProvisioning(input.provisioningId, {
      status: "failed",
      errorMessage: input.errorMessage,
    });
  }

  async saveTelegramBot(bot: TelegramBotRecord): Promise<void> {
    const state = await this.readState();
    state.telegramBots[bot.id] = bot;
    await this.writeState(state);
  }

  async getTelegramBot(botId: string): Promise<TelegramBotRecord | null> {
    return (await this.readState()).telegramBots[botId] ?? null;
  }

  async getTelegramBotByTelegramId(
    telegramBotId: number,
  ): Promise<TelegramBotRecord | null> {
    return (
      Object.values((await this.readState()).telegramBots).find(
        (bot) => bot.telegramBotId === telegramBotId,
      ) ?? null
    );
  }

  async saveTelegramChat(chat: TelegramChatRecord): Promise<void> {
    const state = await this.readState();
    state.telegramChats[chat.id] = chat;
    await this.writeState(state);
  }

  async getTelegramChatByBotAndChat(input: {
    botId: string;
    chatId: number;
  }): Promise<TelegramChatRecord | null> {
    return (
      Object.values((await this.readState()).telegramChats).find(
        (chat) => chat.botId === input.botId && chat.chatId === input.chatId,
      ) ?? null
    );
  }

  async rememberTelegramUpdate(input: {
    source: string;
    updateId: number;
  }): Promise<boolean> {
    const state = await this.readState();
    const ids = state.processedUpdates[input.source] ?? [];
    if (ids.includes(input.updateId)) {
      return false;
    }
    state.processedUpdates[input.source] = [...ids, input.updateId].slice(-200);
    await this.writeState(state);
    return true;
  }

  toConversationBinding(input: {
    bot: TelegramBotRecord;
    chat: TelegramChatRecord;
  }) {
    return {
      key: input.chat.bindingKey,
      bindingId: input.bot.id,
      bindingSource: "official" as const,
      channel: "telegram",
      accountId: String(input.bot.telegramBotId),
      target: String(input.chat.chatId),
      boundAt: new Date(input.chat.firstSeenAt).getTime(),
      defaultPersonaId: input.bot.personaId,
      mode: "companion-exclusive" as const,
    };
  }

  private async patchProvisioning(
    id: string,
    patch: Partial<ProvisioningSessionRecord>,
  ): Promise<ProvisioningSessionRecord> {
    const state = await this.readState();
    const existing = state.provisioningSessions[id];
    if (!existing) {
      throw new Error(`Provisioning session not found: ${id}`);
    }
    const next = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    state.provisioningSessions[id] = next;
    await this.writeState(state);
    return next;
  }

  private async readState(): Promise<SaasState> {
    try {
      const content = await readFile(this.statePath, "utf8");
      return { ...emptyState(), ...(JSON.parse(content) as SaasState) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyState();
      }
      throw error;
    }
  }

  private async writeState(state: SaasState): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    const tempPath = `${this.statePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
    await rename(tempPath, this.statePath);
  }
}

export function createTelegramChatRecord(input: {
  botId: string;
  userId: string;
  chatId: number;
  telegramUserId?: number;
}): TelegramChatRecord {
  const now = new Date().toISOString();
  const binding = bindingKey({
    channel: "telegram",
    accountId: input.botId,
    target: String(input.chatId),
  });
  return {
    id: randomUUID(),
    botId: input.botId,
    userId: input.userId,
    chatId: input.chatId,
    telegramUserId: input.telegramUserId,
    bindingKey: binding,
    firstSeenAt: now,
    lastSeenAt: now,
  };
}

function buildSuggestedBotUsername(
  name: string,
  telegramId: number,
  requestId: number,
): string {
  const stem = slugName(name) || "elsewhere";
  const suffix = Math.abs(telegramId + requestId).toString(36).slice(-6);
  return `${stem}_${suffix}_bot`.slice(0, 32);
}

function slugName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .toLowerCase()
    .slice(0, 18);
}

function randomRequestId(): number {
  return Math.floor(Math.random() * 2_000_000_000);
}

