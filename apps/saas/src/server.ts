import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { parse as parseUrl } from "node:url";

import type { SaasConfig } from "./config.js";
import {
  createSessionToken,
  readSessionToken,
  signStartState,
  verifyStartState,
  verifyTelegramLogin,
} from "./crypto.js";
import { createTelegramChatRecord } from "./store.js";
import {
  TelegramHttpClient,
  extractManagedBotCreated,
  type TelegramUpdate,
} from "./telegram.js";
import type { SaasRuntime } from "./runtime.js";
import type { SaasDataStore, SaasUser } from "./types.js";

export interface SaasServerDependencies {
  config: SaasConfig;
  store: SaasDataStore;
  runtime: SaasRuntime;
  fetchImpl?: typeof fetch;
}

export function createSaasServer(deps: SaasServerDependencies) {
  return createServer(async (req, res) => {
    try {
      await route(req, res, deps);
    } catch (error) {
      console.error(error);
      sendHtml(res, 500, page("Error", `<p>${escapeHtml(String(error))}</p>`));
    }
  });
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SaasServerDependencies,
): Promise<void> {
  const url = parseUrl(req.url ?? "/", true);
  const path = url.pathname ?? "/";

  if (req.method === "GET" && path === "/healthz") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && path === "/auth/telegram/callback") {
    const profile = verifyTelegramLogin(
      queryToRecord(url.query),
      deps.config.telegramLoginBotToken,
    );
    const user = await deps.store.upsertTelegramUser(profile);
    setCookie(res, "elsewhere_session", createSessionToken({
      userId: user.id,
      secret: deps.config.cookieSecret,
    }));
    redirect(res, "/");
    return;
  }

  if (req.method === "POST" && path === "/logout") {
    clearCookie(res, "elsewhere_session");
    redirect(res, "/");
    return;
  }

  if (req.method === "POST" && path === "/api/persona") {
    const user = await requireUser(req, deps);
    const form = await readForm(req);
    const persona = await deps.runtime.service.createPersona({
      name: requiredForm(form, "name"),
      originCity: requiredForm(form, "originCity"),
      traits: requiredForm(form, "traits")
        .split(",")
        .map((trait) => trait.trim())
        .filter(Boolean),
      toneStyle: requiredForm(form, "toneStyle"),
      relationship: requiredForm(form, "relationship"),
      userAddressing: requiredForm(form, "userAddressing"),
      referenceImageAsset: requiredForm(form, "referenceImageAsset"),
    });
    const now = new Date().toISOString();
    await deps.store.savePersona({
      ...persona,
      ownerUserId: user.id,
      updatedAt: now,
    });
    const session = await deps.store.createProvisioningSession({
      user,
      persona: { ...persona, ownerUserId: user.id, updatedAt: now },
      managerBotUsername: deps.config.telegramManagerBotUsername,
    });
    redirect(res, `/setup/${session.id}`);
    return;
  }

  if (req.method === "GET" && path.startsWith("/setup/")) {
    const user = await requireUser(req, deps);
    const id = path.split("/").at(-1) ?? "";
    const session = await deps.store.getProvisioningSession(id);
    if (!session || session.userId !== user.id) {
      sendHtml(res, 404, page("Not found", "<p>Provisioning session not found.</p>"));
      return;
    }
    const readyBot = session.botId
      ? await deps.store.getTelegramBot(session.botId)
      : null;
    const startState = readyBot
      ? signStartState({
          botId: readyBot.id,
          userId: user.id,
          secret: deps.config.cookieSecret,
        })
      : null;
    const finalUrl = readyBot
      ? `https://t.me/${readyBot.username}?start=${encodeURIComponent(startState!)}`
      : null;
    sendHtml(
      res,
      200,
      page(
        "Connect Telegram",
        renderSetupPage({
          status: session.status,
          createBotUrl: session.createBotUrl,
          finalUrl,
          errorMessage: session.errorMessage,
          pollingUrl: `/api/provisioning/${session.id}`,
        }),
      ),
    );
    return;
  }

  if (req.method === "GET" && path.startsWith("/api/provisioning/")) {
    const user = await requireUser(req, deps);
    const id = path.split("/").at(-1) ?? "";
    const session = await deps.store.getProvisioningSession(id);
    if (!session || session.userId !== user.id) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    const bot = session.botId ? await deps.store.getTelegramBot(session.botId) : null;
    sendJson(res, 200, {
      id: session.id,
      status: session.status,
      errorMessage: session.errorMessage,
      finalUrl: bot
        ? `https://t.me/${bot.username}?start=${encodeURIComponent(
            signStartState({
              botId: bot.id,
              userId: user.id,
              secret: deps.config.cookieSecret,
            }),
          )}`
        : null,
    });
    return;
  }

  if (
    req.method === "POST" &&
    path === `/telegram/manager/${deps.config.managerWebhookSecret}`
  ) {
    const update = await readJson<TelegramUpdate>(req);
    if (
      !(await deps.store.rememberTelegramUpdate({
        source: "manager",
        updateId: update.update_id,
      }))
    ) {
      sendJson(res, 200, { ok: true, deduped: true });
      return;
    }
    const managerClient = new TelegramHttpClient(
      deps.config.telegramManagerBotToken,
      deps.fetchImpl,
    );
    try {
      const bot = await extractManagedBotCreated({
        update,
        store: deps.store,
        encryptionKey: deps.config.encryptionKey,
        managerClient,
        publicBaseUrl: deps.config.publicBaseUrl,
        createChildClient: (token) => new TelegramHttpClient(token, deps.fetchImpl),
      });
      sendJson(res, 200, { ok: true, botId: bot?.id ?? null });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error) });
    }
    return;
  }

  if (req.method === "POST" && path.startsWith("/telegram/bot/")) {
    const [, , , botId, secret] = path.split("/");
    const bot = botId ? await deps.store.getTelegramBot(botId) : null;
    if (!bot || secret !== bot.webhookSecret) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    const headerSecret = req.headers["x-telegram-bot-api-secret-token"];
    if (headerSecret && headerSecret !== bot.webhookSecret) {
      sendJson(res, 403, { error: "bad_secret" });
      return;
    }
    const update = await readJson<TelegramUpdate>(req);
    if (
      !(await deps.store.rememberTelegramUpdate({
        source: `bot:${bot.id}`,
        updateId: update.update_id,
      }))
    ) {
      sendJson(res, 200, { ok: true, deduped: true });
      return;
    }
    await handleChildBotUpdate({ update, botId: bot.id, deps });
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && path === "/") {
    const user = await getCurrentUser(req, deps);
    if (!user) {
      sendHtml(res, 200, page("Elsewhere", renderLoginPage(deps.config)));
      return;
    }
    const persona = await deps.store.getLatestPersonaForUser(user.id);
    sendHtml(res, 200, page("Elsewhere", renderHomePage({ user, hasPersona: Boolean(persona) })));
    return;
  }

  sendHtml(res, 404, page("Not found", "<p>Not found.</p>"));
}

async function handleChildBotUpdate(input: {
  update: TelegramUpdate;
  botId: string;
  deps: SaasServerDependencies;
}): Promise<void> {
  const message = input.update.message;
  if (!message?.chat?.id) {
    return;
  }
  const bot = await input.deps.store.getTelegramBot(input.botId);
  if (!bot) {
    return;
  }
  const startMatch = message.text?.match(/^\/start(?:\s+(.+))?$/u);
  const state = startMatch
    ? verifyStartState(startMatch[1], input.deps.config.cookieSecret)
    : null;
  const userId = state?.botId === bot.id ? state.userId : bot.ownerUserId;
  const existing = await input.deps.store.getTelegramChatByBotAndChat({
    botId: bot.id,
    chatId: message.chat.id,
  });
  const chat =
    existing ??
    createTelegramChatRecord({
      botId: bot.id,
      userId,
      chatId: message.chat.id,
      telegramUserId: message.from?.id,
    });
  await input.deps.store.saveTelegramChat({
    ...chat,
    lastSeenAt: new Date().toISOString(),
  });
  const binding = input.deps.store.toConversationBinding({ bot, chat });
  await input.deps.runtime.bindings.upsert(binding);

  if (startMatch) {
    await input.deps.runtime.conversationService.activateConversation(binding);
    await input.deps.runtime.conversationService.enterIdleAwaitingDestination({
      binding,
      sendGuideNow: true,
      clearConversationContext: true,
      reason: "first_onboarding_complete",
    });
    return;
  }

  const text = message.text?.trim();
  if (!text || text.startsWith("/")) {
    return;
  }
  await input.deps.runtime.conversationService.claimInboundMessage({
    binding,
    messageId: String(message.message_id),
    content: text,
    senderId: message.from ? String(message.from.id) : undefined,
    senderName: message.from?.first_name,
    senderUsername: message.from?.username,
  });
}

async function requireUser(
  req: IncomingMessage,
  deps: SaasServerDependencies,
): Promise<SaasUser> {
  const user = await getCurrentUser(req, deps);
  if (!user) {
    throw new Error("Authentication required.");
  }
  return user;
}

async function getCurrentUser(
  req: IncomingMessage,
  deps: SaasServerDependencies,
): Promise<SaasUser | null> {
  const session = readSessionToken(
    parseCookies(req.headers.cookie).elsewhere_session,
    deps.config.cookieSecret,
  );
  return session ? await deps.store.getUser(session.userId) : null;
}

function renderLoginPage(config: SaasConfig): string {
  return `
    <section class="hero">
      <h1>Elsewhere</h1>
      <p>Create a private Telegram travel companion that belongs only to you.</p>
      <script async src="https://telegram.org/js/telegram-widget.js?22"
        data-telegram-login="${escapeHtml(config.telegramManagerBotUsername)}"
        data-size="large"
        data-auth-url="/auth/telegram/callback"
        data-request-access="write"></script>
    </section>
  `;
}

function renderHomePage(input: { user: SaasUser; hasPersona: boolean }): string {
  return `
    <header class="top">
      <div>Signed in as ${escapeHtml(input.user.displayName)}</div>
      <form method="post" action="/logout"><button>Log out</button></form>
    </header>
    <main>
      <h1>Create your companion</h1>
      <form method="post" action="/api/persona" class="form">
        <label>Name <input name="name" required placeholder="Mori"></label>
        <label>Reference photo URL or server path <input name="referenceImageAsset" required placeholder="https://.../mori.jpg"></label>
        <label>Origin city <input name="originCity" required value="Hong Kong"></label>
        <label>Traits <input name="traits" required placeholder="warm, curious, playful"></label>
        <label>Tone <input name="toneStyle" required placeholder="gentle and intimate"></label>
        <label>Relationship <input name="relationship" required placeholder="travel companion"></label>
        <label>How they address you <input name="userAddressing" required placeholder="baby"></label>
        <button>Create Telegram companion</button>
      </form>
      ${input.hasPersona ? "<p>You can create a new companion version any time during the MVP.</p>" : ""}
    </main>
  `;
}

function renderSetupPage(input: {
  status: string;
  createBotUrl: string;
  finalUrl: string | null;
  pollingUrl: string;
  errorMessage?: string;
}): string {
  const activeUrl = input.finalUrl ?? input.createBotUrl;
  return `
    <main>
      <h1>${input.finalUrl ? "Your companion is ready" : "Confirm in Telegram"}</h1>
      <p>Status: <strong id="status">${escapeHtml(input.status)}</strong></p>
      ${input.errorMessage ? `<p class="error">${escapeHtml(input.errorMessage)}</p>` : ""}
      <a class="primary" id="open-link" href="${escapeHtml(activeUrl)}">Open Telegram</a>
      <img class="qr" id="qr" alt="Telegram QR" src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(activeUrl)}">
      <script>
        const poll = async () => {
          const res = await fetch(${JSON.stringify(input.pollingUrl)});
          if (!res.ok) return;
          const data = await res.json();
          document.getElementById("status").textContent = data.status;
          if (data.finalUrl) {
            document.getElementById("open-link").href = data.finalUrl;
            document.getElementById("qr").src = "https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=" + encodeURIComponent(data.finalUrl);
          } else {
            setTimeout(poll, 2500);
          }
        };
        setTimeout(poll, 2500);
      </script>
    </main>
  `;
}

function page(title: string, body: string): string {
  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Inter, system-ui, sans-serif; margin: 0; color: #151515; background: #f7f4ef; }
          main, .hero { max-width: 760px; margin: 0 auto; padding: 48px 20px; }
          h1 { font-size: 42px; margin: 0 0 16px; letter-spacing: 0; }
          p { line-height: 1.55; }
          .top { display: flex; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid #ddd6ca; }
          .form { display: grid; gap: 14px; }
          label { display: grid; gap: 6px; font-weight: 650; }
          input { padding: 12px; border: 1px solid #bdb5aa; border-radius: 6px; font: inherit; }
          button, .primary { display: inline-block; width: fit-content; border: 0; border-radius: 6px; background: #171717; color: white; padding: 12px 16px; font: inherit; text-decoration: none; cursor: pointer; }
          .qr { display: block; margin-top: 20px; width: 220px; height: 220px; border: 1px solid #ddd6ca; }
          .error { color: #9b1c1c; }
        </style>
      </head>
      <body>${body}</body>
    </html>`;
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  return JSON.parse(await readBody(req)) as T;
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  return new URLSearchParams(await readBody(req));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function requiredForm(form: URLSearchParams, key: string): string {
  const value = form.get(key)?.trim();
  if (!value) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

function queryToRecord(
  query: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(query)) {
    result[key] = Array.isArray(value) ? value[0] : value;
  }
  return result;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header?.split(";") ?? []) {
    const [key, ...rest] = part.trim().split("=");
    if (key) cookies[key] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

function setCookie(res: ServerResponse, key: string, value: string): void {
  res.setHeader(
    "Set-Cookie",
    `${key}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
  );
}

function clearCookie(res: ServerResponse, key: string): void {
  res.setHeader("Set-Cookie", `${key}=; Path=/; HttpOnly; Max-Age=0`);
}

function redirect(res: ServerResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.end();
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

function sendHtml(res: ServerResponse, status: number, value: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}
