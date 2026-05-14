import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHmac, createHash } from "node:crypto";

import { describe, expect, it, afterEach, vi } from "vitest";

import {
  createSessionToken,
  decryptSecret,
  encryptSecret,
  readSessionToken,
  verifyTelegramLogin,
} from "../apps/saas/src/crypto.js";
import { JsonSaasDataStore } from "../apps/saas/src/store.js";
import {
  TelegramMessengerPort,
  extractManagedBotCreated,
  type TelegramApiClient,
} from "../apps/saas/src/telegram.js";
import type { TripRepository } from "../src/domain/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("SaaS Telegram auth and crypto", () => {
  it("verifies Telegram login payloads and rejects tampering", () => {
    const token = "123456:test-token";
    const raw = {
      id: "42",
      first_name: "Ada",
      username: "ada",
      auth_date: "1700000000",
    };
    const dataCheckString = Object.entries(raw)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    const secret = createHash("sha256").update(token).digest();
    const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");

    expect(verifyTelegramLogin({ ...raw, hash }, token, 1700000100)).toMatchObject({
      id: 42,
      first_name: "Ada",
    });
    expect(() =>
      verifyTelegramLogin({ ...raw, first_name: "Eve", hash }, token, 1700000100),
    ).toThrow(/invalid/u);
  });

  it("encrypts bot tokens and signs web sessions", () => {
    const key = Buffer.from("12345678901234567890123456789012");
    const encrypted = encryptSecret("bot-token", key);
    expect(encrypted).not.toContain("bot-token");
    expect(decryptSecret(encrypted, key)).toBe("bot-token");

    const session = createSessionToken({
      userId: "user-1",
      secret: "cookie-secret",
      now: 100,
    });
    expect(readSessionToken(session, "cookie-secret", 200)).toEqual({
      userId: "user-1",
    });
    expect(readSessionToken(session, "wrong-secret", 200)).toBeNull();
  });
});

describe("SaaS Managed Bot provisioning", () => {
  it("turns a managed_bot update into a configured child bot record", async () => {
    const root = await tempRoot();
    const store = new JsonSaasDataStore(root);
    const user = await store.upsertTelegramUser({
      id: 100,
      first_name: "User",
      auth_date: 1700000000,
    });
    const persona = {
      personaId: "persona-1",
      ownerUserId: user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      name: "Mori",
      originCity: "Hong Kong",
      traits: ["warm"],
      toneStyle: "gentle",
      relationship: "companion",
      userAddressing: "baby",
      referenceImageAsset: join(root, "missing.jpg"),
    };
    await store.savePersona(persona);
    await store.createProvisioningSession({
      user,
      persona,
      managerBotUsername: "ManagerBot",
    });

    const manager = new FakeTelegramClient({ getManagedBotToken: "child-token" });
    const child = new FakeTelegramClient({});
    const bot = await extractManagedBotCreated({
      update: {
        update_id: 1,
        managed_bot: {
          user: { id: 100 },
          bot: { id: 200, is_bot: true, username: "mori_bot" },
        },
      },
      store,
      encryptionKey: Buffer.from("12345678901234567890123456789012"),
      managerClient: manager,
      publicBaseUrl: "https://example.com",
      createChildClient: () => child,
    });

    expect(bot?.username).toBe("mori_bot");
    expect(child.calls.map((call) => call.method)).toEqual(
      expect.arrayContaining(["setMyName", "setWebhook"]),
    );
    expect(await store.getTelegramBotByTelegramId(200)).toMatchObject({
      username: "mori_bot",
      status: "ready",
    });
  });

  it("deduplicates webhook update ids per source", async () => {
    const store = new JsonSaasDataStore(await tempRoot());
    await expect(
      store.rememberTelegramUpdate({ source: "manager", updateId: 1 }),
    ).resolves.toBe(true);
    await expect(
      store.rememberTelegramUpdate({ source: "manager", updateId: 1 }),
    ).resolves.toBe(false);
  });
});

describe("TelegramMessengerPort", () => {
  it("sends text replies through the child bot token", async () => {
    vi.useFakeTimers();
    const store = new JsonSaasDataStore(await tempRoot());
    await store.saveTelegramBot({
      id: "bot-1",
      ownerUserId: "user-1",
      personaId: "persona-1",
      telegramBotId: 200,
      username: "mori_bot",
      displayName: "Mori",
      encryptedToken: encryptSecret(
        "child-token",
        Buffer.from("12345678901234567890123456789012"),
      ),
      webhookSecret: "secret",
      status: "ready",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 777 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    const messenger = new TelegramMessengerPort({
      store,
      encryptionKey: Buffer.from("12345678901234567890123456789012"),
      tripRepository: emptyTripRepository(),
      fetchImpl,
    });
    const promise = messenger.sendTextReply({
      binding: {
        bindingId: "bot-1",
        channel: "telegram",
        target: "123",
      },
      text: "hello",
      dedupeKey: "k",
    });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toMatchObject({
      messageId: "777",
      provider: "telegram",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.telegram.org/botchild-token/sendMessage",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

class FakeTelegramClient implements TelegramApiClient {
  readonly calls: Array<{ method: string; payload?: Record<string, unknown> }> = [];

  constructor(private readonly responses: Record<string, unknown>) {}

  async call<T = unknown>(method: string, payload?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, payload });
    return this.responses[method] as T;
  }

  async upload<T = unknown>(
    method: string,
    payload: Record<string, string | Blob>,
  ): Promise<T> {
    this.calls.push({ method, payload });
    return this.responses[method] as T;
  }
}

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "elsewhere-saas-"));
  tempDirs.push(dir);
  return dir;
}

function emptyTripRepository(): TripRepository {
  return {
    async save() {},
    async getById() {
      return null;
    },
    async listDueTrips() {
      return [];
    },
  };
}

