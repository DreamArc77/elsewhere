import { join, resolve } from "node:path";

export interface SaasConfig {
  port: number;
  publicBaseUrl: string;
  stateDir: string;
  cookieSecret: string;
  encryptionKey: Buffer;
  telegramLoginBotToken: string;
  telegramManagerBotToken: string;
  telegramManagerBotUsername: string;
  managerWebhookSecret: string;
  pollIntervalSeconds: number;
}

export function loadSaasConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): SaasConfig {
  const publicBaseUrl =
    readRequired(env, "SAAS_PUBLIC_BASE_URL") ?? "http://localhost:8787";
  const managerBotToken = readRequired(env, "TELEGRAM_MANAGER_BOT_TOKEN");
  const loginBotToken =
    env.TELEGRAM_LOGIN_BOT_TOKEN?.trim() || managerBotToken;
  const managerBotUsername = readRequired(env, "TELEGRAM_MANAGER_BOT_USERNAME");
  const cookieSecret = readRequired(env, "SAAS_COOKIE_SECRET");
  const encryptionKey = resolveEncryptionKey(
    readRequired(env, "SAAS_ENCRYPTION_KEY"),
  );

  return {
    port: Number.parseInt(env.PORT ?? "8787", 10),
    publicBaseUrl: publicBaseUrl.replace(/\/$/, ""),
    stateDir: resolve(env.SAAS_STATE_DIR ?? join(cwd, ".saas-data")),
    cookieSecret,
    encryptionKey,
    telegramLoginBotToken: loginBotToken,
    telegramManagerBotToken: managerBotToken,
    telegramManagerBotUsername: managerBotUsername.replace(/^@/u, ""),
    managerWebhookSecret:
      env.TELEGRAM_MANAGER_WEBHOOK_SECRET?.trim() ?? randomEnvFallback(),
    pollIntervalSeconds: Number.parseInt(
      env.SAAS_POLL_INTERVAL_SECONDS ?? "30",
      10,
    ),
  };
}

function readRequired(
  env: NodeJS.ProcessEnv,
  key: string,
): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required for the SaaS app.`);
  }
  return value;
}

function resolveEncryptionKey(value: string): Buffer {
  const base64 = Buffer.from(value, "base64");
  if (base64.length === 32) {
    return base64;
  }
  const utf8 = Buffer.from(value, "utf8");
  if (utf8.length === 32) {
    return utf8;
  }
  throw new Error(
    "SAAS_ENCRYPTION_KEY must decode to exactly 32 bytes for AES-256-GCM.",
  );
}

function randomEnvFallback(): string {
  return "dev-manager-webhook-secret";
}

