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

  if (req.method === "GET" && path === "/ui-preview") {
    sendHtml(res, 200, page("Elsewhere UI Preview", renderUiPreviewPage()));
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
      <p>Create a private Telegram character that belongs only to you.</p>
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
      <h1>Create your character</h1>
      <form method="post" action="/api/persona" class="form">
        <label>Name <input name="name" required placeholder="Mori"></label>
        <label>Reference photo URL or server path <input name="referenceImageAsset" required placeholder="https://.../mori.jpg"></label>
        <label>Origin city <input name="originCity" required value="Hong Kong"></label>
        <label>Traits <input name="traits" required placeholder="warm, curious, observant"></label>
        <label>Tone <input name="toneStyle" required placeholder="natural, calm, lightly playful"></label>
        <label>Relationship <input name="relationship" required placeholder="private AI character"></label>
        <label>How she addresses you <input name="userAddressing" required placeholder="your nickname"></label>
        <button>Create Telegram character</button>
      </form>
      ${input.hasPersona ? "<p>You can create a new character version any time during the MVP.</p>" : ""}
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
      <h1>${input.finalUrl ? "Your character is ready" : "Confirm in Telegram"}</h1>
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

function renderUiPreviewPage(): string {
  return `
    <main class="preview-shell">
      <nav class="preview-nav">
        <span class="brand">Elsewhere</span>
        <span class="preview-pill">Creation Flow Preview</span>
      </nav>

      <section class="preview-hero">
        <p class="eyebrow">Telegram SaaS MVP</p>
        <h1>Create her on the web. Continue in Telegram.</h1>
        <p class="lead">
          The user creates a dedicated AI character, confirms Telegram bot creation once, then chats with her directly in Telegram.
        </p>
      </section>

      <section class="preview-flow" aria-label="Creation flow">
        <article class="flow-step active">
          <div class="step-index">1</div>
          <h2>Telegram sign-in</h2>
          <p>Use Telegram identity on the web. No email account is required for the MVP.</p>
        </article>
        <article class="flow-step active">
          <div class="step-index">2</div>
          <h2>Create character</h2>
          <p>Set name, photo, personality, tone, relationship, address style, and origin city.</p>
        </article>
        <article class="flow-step">
          <div class="step-index">3</div>
          <h2>Confirm bot creation</h2>
          <p>Telegram asks the user to confirm one dedicated managed bot.</p>
        </article>
        <article class="flow-step">
          <div class="step-index">4</div>
          <h2>Open Telegram</h2>
          <p>After setup, the page switches to the final bot QR code and direct link.</p>
        </article>
      </section>

      <section class="preview-grid">
        <div class="surface">
          <div class="surface-header">
            <span>Create Character</span>
            <span>Web</span>
          </div>
          <form class="form preview-form">
            <label>Name <input value="Mori" readonly></label>
            <label>Reference photo <input value="mori-reference.jpg" readonly></label>
            <label>Origin city <input value="Hong Kong" readonly></label>
            <label>Traits <input value="curious, warm, observant" readonly></label>
            <label>Tone <input value="natural, calm, lightly playful" readonly></label>
            <label>Relationship <input value="private AI character" readonly></label>
            <label>How she addresses you <input value="your nickname" readonly></label>
            <button type="button">Create Telegram character</button>
          </form>
        </div>

        <div class="surface">
          <div class="surface-header">
            <span>Telegram Setup</span>
            <span>Pending</span>
          </div>
          <div class="setup-card">
            <div class="qr-preview" aria-label="QR placeholder"></div>
            <h2>Confirm once in Telegram</h2>
            <p>
              The user scans or opens the link. After confirmation, Elsewhere automatically sets the bot name, avatar, description, and webhook.
            </p>
            <a class="primary" href="#">Open Telegram</a>
          </div>
        </div>

        <div class="surface chat-surface">
          <div class="surface-header">
            <span>Mori</span>
            <span>Telegram chat</span>
          </div>
          <div class="chat-window">
            <div class="bubble companion">
              I am setting off today. I will send you what I see along the way.
            </div>
            <div class="bubble user">Where are you going first?</div>
            <div class="bubble companion">
              Somewhere coastal first. I want to see the morning light before the streets get busy.
            </div>
            <div class="postcard-preview">
              <div class="photo-block"></div>
              <p>First photo from the road. I will keep you updated.</p>
            </div>
          </div>
        </div>
      </section>
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
          .preview-shell { max-width: 1180px; }
          .preview-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 42px; }
          .brand { font-weight: 760; font-size: 18px; }
          .preview-pill { border: 1px solid #c9c0b5; border-radius: 999px; padding: 6px 10px; font-size: 13px; color: #514a43; }
          .preview-hero { max-width: 720px; margin-bottom: 34px; }
          .eyebrow { margin: 0 0 8px; color: #72685d; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; }
          .lead { color: #4f4841; font-size: 18px; margin: 0; }
          .preview-flow { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 28px 0 28px; }
          .flow-step { min-height: 128px; border: 1px solid #d8d0c6; border-radius: 8px; padding: 14px; background: #fbf9f5; }
          .flow-step.active { border-color: #151515; background: #fff; }
          .step-index { width: 28px; height: 28px; display: grid; place-items: center; background: #151515; color: white; border-radius: 50%; font-size: 14px; margin-bottom: 12px; }
          .flow-step h2 { font-size: 16px; margin: 0 0 6px; }
          .flow-step p { margin: 0; color: #5f574f; font-size: 14px; line-height: 1.45; }
          .preview-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: 18px; align-items: start; }
          .surface { border: 1px solid #d5cdc2; border-radius: 8px; background: #fffdf9; overflow: hidden; }
          .surface-header { display: flex; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid #e3dbd0; color: #514a43; font-size: 14px; }
          .preview-form { padding: 18px; }
          .preview-form input { background: #f7f4ef; }
          .setup-card { padding: 22px; }
          .setup-card h2 { margin: 18px 0 8px; font-size: 22px; }
          .setup-card p { color: #5f574f; }
          .qr-preview { width: 180px; height: 180px; background:
            linear-gradient(90deg, #151515 10px, transparent 10px) 0 0 / 20px 20px,
            linear-gradient(#151515 10px, transparent 10px) 0 0 / 20px 20px,
            #f1ece5; border: 10px solid white; box-shadow: 0 0 0 1px #d8d0c6; }
          .chat-surface { grid-column: 1 / -1; }
          .chat-window { padding: 18px; display: grid; gap: 12px; background: #f5efe7; }
          .bubble { max-width: 68%; padding: 12px 14px; border-radius: 8px; line-height: 1.45; }
          .bubble.companion { background: #fff; border: 1px solid #e1d8ce; }
          .bubble.user { justify-self: end; background: #151515; color: white; }
          .postcard-preview { width: min(360px, 100%); background: #fff; border: 1px solid #e1d8ce; border-radius: 8px; overflow: hidden; }
          .postcard-preview p { margin: 12px; color: #514a43; }
          .photo-block { aspect-ratio: 4 / 3; background:
            linear-gradient(135deg, rgba(20, 20, 20, 0.12), rgba(20, 20, 20, 0)),
            linear-gradient(150deg, #b9c4bd 0%, #efe1c7 52%, #7f918d 100%); }
          @media (max-width: 860px) {
            .preview-flow, .preview-grid { grid-template-columns: 1fr; }
            .bubble { max-width: 88%; }
          }
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
