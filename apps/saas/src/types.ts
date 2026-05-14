import type {
  ConversationBindingRecord,
  StoredPersonaProfile,
} from "../../../src/domain/types.js";

export type ProvisioningStatus =
  | "pending_user_confirmation"
  | "configuring"
  | "ready"
  | "failed";

export interface TelegramLoginProfile {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
}

export interface SaasUser {
  id: string;
  telegramId: number;
  telegramUsername?: string;
  displayName: string;
  photoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaasPersonaRecord extends StoredPersonaProfile {
  ownerUserId: string;
  updatedAt: string;
}

export interface TelegramBotRecord {
  id: string;
  ownerUserId: string;
  personaId: string;
  telegramBotId: number;
  username: string;
  displayName: string;
  encryptedToken: string;
  webhookSecret: string;
  status: "ready" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface TelegramChatRecord {
  id: string;
  botId: string;
  userId: string;
  chatId: number;
  telegramUserId?: number;
  bindingKey: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ProvisioningSessionRecord {
  id: string;
  userId: string;
  personaId: string;
  requestId: number;
  suggestedName: string;
  suggestedUsername: string;
  createBotUrl: string;
  status: ProvisioningStatus;
  botId?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaasDataStore {
  upsertTelegramUser(profile: TelegramLoginProfile): Promise<SaasUser>;
  getUser(id: string): Promise<SaasUser | null>;
  getUserByTelegramId(telegramId: number): Promise<SaasUser | null>;

  savePersona(persona: SaasPersonaRecord): Promise<void>;
  getPersona(personaId: string): Promise<SaasPersonaRecord | null>;
  getLatestPersonaForUser(userId: string): Promise<SaasPersonaRecord | null>;

  createProvisioningSession(input: {
    user: SaasUser;
    persona: SaasPersonaRecord;
    managerBotUsername: string;
  }): Promise<ProvisioningSessionRecord>;
  getProvisioningSession(id: string): Promise<ProvisioningSessionRecord | null>;
  findPendingProvisioningForTelegramUser(
    telegramId: number,
  ): Promise<ProvisioningSessionRecord | null>;
  markProvisioningConfiguring(id: string): Promise<ProvisioningSessionRecord>;
  markProvisioningReady(input: {
    provisioningId: string;
    botId: string;
  }): Promise<ProvisioningSessionRecord>;
  markProvisioningFailed(input: {
    provisioningId: string;
    errorMessage: string;
  }): Promise<ProvisioningSessionRecord>;

  saveTelegramBot(bot: TelegramBotRecord): Promise<void>;
  getTelegramBot(botId: string): Promise<TelegramBotRecord | null>;
  getTelegramBotByTelegramId(
    telegramBotId: number,
  ): Promise<TelegramBotRecord | null>;

  saveTelegramChat(chat: TelegramChatRecord): Promise<void>;
  getTelegramChatByBotAndChat(input: {
    botId: string;
    chatId: number;
  }): Promise<TelegramChatRecord | null>;

  rememberTelegramUpdate(input: {
    source: string;
    updateId: number;
  }): Promise<boolean>;

  toConversationBinding(input: {
    bot: TelegramBotRecord;
    chat: TelegramChatRecord;
  }): ConversationBindingRecord;
}

