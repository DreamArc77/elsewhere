import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import type {
  DeliveryBinding,
  HostMessengerPort,
  Postcard,
  SendReceipt,
  TripRepository,
} from "../../../src/domain/types.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import type {
  SaasDataStore,
  SaasPersonaRecord,
  TelegramBotRecord,
} from "./types.js";

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number; type: string };
    from?: TelegramUser;
    managed_bot_created?: { bot: TelegramUser };
  };
  managed_bot?: {
    user: TelegramUser;
    bot: TelegramUser;
  };
}

export interface TelegramApiClient {
  call<T = unknown>(method: string, payload?: Record<string, unknown>): Promise<T>;
  upload<T = unknown>(
    method: string,
    payload: Record<string, string | Blob>,
  ): Promise<T>;
}

export class TelegramHttpClient implements TelegramApiClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async call<T = unknown>(
    method: string,
    payload: Record<string, unknown> = {},
  ): Promise<T> {
    const response = await this.fetchImpl(this.url(method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return parseTelegramResponse<T>(method, response);
  }

  async upload<T = unknown>(
    method: string,
    payload: Record<string, string | Blob>,
  ): Promise<T> {
    const form = new FormData();
    for (const [key, value] of Object.entries(payload)) {
      form.append(key, value);
    }
    const response = await this.fetchImpl(this.url(method), {
      method: "POST",
      body: form,
    });
    return parseTelegramResponse<T>(method, response);
  }

  private url(method: string): string {
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }
}

export async function configureManagedTelegramBot(input: {
  managerClient: TelegramApiClient;
  childToken: string;
  childClient: TelegramApiClient;
  bot: TelegramUser;
  persona: SaasPersonaRecord;
  publicBaseUrl: string;
  webhookSecret: string;
}): Promise<void> {
  await input.childClient.call("setMyName", { name: input.persona.name });
  await input.childClient.call("setMyDescription", {
    description: `${input.persona.name} is waiting to travel with you.`,
  });
  await input.childClient.call("setMyShortDescription", {
    short_description: "Your private Elsewhere travel companion.",
  });
  await input.childClient.call("setMyCommands", { commands: [] });

  const photo = await loadProfilePhoto(input.persona.referenceImageAsset);
  if (photo) {
    await input.childClient.upload("setMyProfilePhoto", { photo });
  }

  await input.childClient.call("setWebhook", {
    url: `${input.publicBaseUrl}/telegram/bot/${input.bot.id}/${input.webhookSecret}`,
    secret_token: input.webhookSecret,
    allowed_updates: ["message"],
    drop_pending_updates: true,
    max_connections: 20,
  });
}

export async function extractManagedBotCreated(input: {
  update: TelegramUpdate;
  store: SaasDataStore;
  encryptionKey: Buffer;
  managerClient: TelegramApiClient;
  publicBaseUrl: string;
  createChildClient?: (token: string) => TelegramApiClient;
}): Promise<TelegramBotRecord | null> {
  const source =
    input.update.managed_bot ??
    (input.update.message?.managed_bot_created && input.update.message.from
      ? {
          user: input.update.message.from,
          bot: input.update.message.managed_bot_created.bot,
        }
      : undefined);
  if (!source) {
    return null;
  }

  const provisioning = await input.store.findPendingProvisioningForTelegramUser(
    source.user.id,
  );
  if (!provisioning) {
    throw new Error(`No pending provisioning session for ${source.user.id}.`);
  }

  await input.store.markProvisioningConfiguring(provisioning.id);
  const persona = await input.store.getPersona(provisioning.personaId);
  if (!persona) {
    throw new Error(`Persona not found: ${provisioning.personaId}`);
  }

  const token = await input.managerClient.call<string>("getManagedBotToken", {
    user_id: source.bot.id,
  });
  const webhookSecret = randomUUID();
  const now = new Date().toISOString();
  const bot: TelegramBotRecord = {
    id: randomUUID(),
    ownerUserId: provisioning.userId,
    personaId: persona.personaId,
    telegramBotId: source.bot.id,
    username: source.bot.username ?? provisioning.suggestedUsername,
    displayName: persona.name,
    encryptedToken: encryptSecret(token, input.encryptionKey),
    webhookSecret,
    status: "ready",
    createdAt: now,
    updatedAt: now,
  };
  const childClient =
    input.createChildClient?.(token) ?? new TelegramHttpClient(token);
  await configureManagedTelegramBot({
    managerClient: input.managerClient,
    childToken: token,
    childClient,
    bot: source.bot,
    persona,
    publicBaseUrl: input.publicBaseUrl,
    webhookSecret,
  });
  await input.store.saveTelegramBot(bot);
  await input.store.markProvisioningReady({
    provisioningId: provisioning.id,
    botId: bot.id,
  });
  return bot;
}

export class TelegramMessengerPort implements HostMessengerPort {
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(
    private readonly input: {
      store: SaasDataStore;
      tripRepository: TripRepository;
      encryptionKey: Buffer;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async sendTextReply(input: {
    binding: DeliveryBinding;
    text: string;
    dedupeKey: string;
  }): Promise<SendReceipt> {
    const bot = await this.requireBot(input.binding);
    return await this.enqueue(`${bot.id}:${input.binding.target}`, async () => {
      const client = this.clientForBot(bot);
      const result = await client.call<{ message_id: number }>("sendMessage", {
        chat_id: input.binding.target,
        text: input.text,
      });
      return {
        messageId: String(result.message_id ?? input.dedupeKey),
        deduped: false,
        provider: "telegram",
      };
    });
  }

  async sendPostcard(input: {
    personaId: string;
    postcard: Postcard;
    dedupeKey: string;
  }): Promise<SendReceipt> {
    const trip = await this.input.tripRepository.getById(input.postcard.tripId);
    if (!trip?.deliveryBinding) {
      throw new Error(`Trip ${input.postcard.tripId} is missing a delivery binding.`);
    }
    const bot = await this.requireBot(trip.deliveryBinding);
    return await this.enqueue(`${bot.id}:${trip.deliveryBinding.target}`, async () => {
      const client = this.clientForBot(bot);
      const media = await loadLocalBlob(input.postcard.imageAsset);
      if (!media) {
        return await this.sendTextReply({
          binding: trip.deliveryBinding!,
          text: input.postcard.caption,
          dedupeKey: `${input.dedupeKey}:text-only`,
        });
      }
      const result = await client.upload<{ message_id: number }>("sendPhoto", {
        chat_id: trip.deliveryBinding!.target,
        caption: input.postcard.caption,
        photo: media,
      });
      return {
        messageId: String(result.message_id ?? input.dedupeKey),
        deduped: false,
        provider: "telegram",
        deliveryMode: "combined",
        fallbackUsed: false,
      };
    });
  }

  private async requireBot(binding: DeliveryBinding): Promise<TelegramBotRecord> {
    const botId = binding.bindingId ?? binding.accountId;
    if (!botId) {
      throw new Error("Telegram delivery binding is missing bot id.");
    }
    const bot = await this.input.store.getTelegramBot(botId);
    if (!bot) {
      throw new Error(`Telegram bot not found: ${botId}`);
    }
    return bot;
  }

  private clientForBot(bot: TelegramBotRecord): TelegramApiClient {
    return new TelegramHttpClient(
      decryptSecret(bot.encryptedToken, this.input.encryptionKey),
      this.input.fetchImpl,
    );
  }

  private async enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        const result = await task();
        await new Promise((resolve) => setTimeout(resolve, 1100));
        return result;
      });
    this.chains.set(key, current);
    return current;
  }
}

async function parseTelegramResponse<T>(
  method: string,
  response: Response,
): Promise<T> {
  const payload = (await response.json()) as {
    ok?: boolean;
    result?: T;
    description?: string;
  };
  if (!response.ok || !payload.ok) {
    throw new Error(
      `Telegram ${method} failed: ${response.status} ${payload.description ?? response.statusText}`,
    );
  }
  return payload.result as T;
}

async function loadProfilePhoto(value: string): Promise<Blob | null> {
  if (/^https?:\/\//iu.test(value)) {
    const response = await fetch(value);
    if (!response.ok) {
      throw new Error(`Profile photo fetch failed: ${response.status}`);
    }
    return await response.blob();
  }
  return await loadLocalBlob(value);
}

async function loadLocalBlob(path: string): Promise<Blob | null> {
  try {
    const bytes = await readFile(path);
    return new Blob([bytes], { type: guessImageMime(path) });
  } catch {
    return null;
  }
}

function guessImageMime(path: string): string {
  if (/\.png$/iu.test(path)) return "image/png";
  if (/\.webp$/iu.test(path)) return "image/webp";
  return "image/jpeg";
}

