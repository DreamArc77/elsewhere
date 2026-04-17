export interface TravelCompanionPluginConfig {
  geminiApiKey?: string;
  openrouterApiKey?: string;
  defaultOriginCity?: string;
  pollIntervalSeconds?: number;
  openclawBinaryPath?: string;
  planningModel?: string;
  textModel?: string;
  imageModel?: string;
  geminiBaseUrl?: string;
  openrouterBaseUrl?: string;
  logMode?: "safe" | "debug";
}

export function resolvePluginConfig(
  raw: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Required<Pick<TravelCompanionPluginConfig, "pollIntervalSeconds" | "openclawBinaryPath">> &
  TravelCompanionPluginConfig {
  return {
    geminiApiKey:
      asString(raw?.geminiApiKey) ?? env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY,
    openrouterApiKey:
      asString(raw?.openrouterApiKey) ?? env.OPENROUTER_API_KEY,
    defaultOriginCity: asString(raw?.defaultOriginCity) ?? "Hong Kong",
    pollIntervalSeconds: asInteger(raw?.pollIntervalSeconds) ?? 60,
    openclawBinaryPath: asString(raw?.openclawBinaryPath) ?? "openclaw",
    planningModel: asString(raw?.planningModel) ?? "gemini-3-flash-preview",
    textModel: asString(raw?.textModel) ?? "gemini-3-flash-preview",
    imageModel: asString(raw?.imageModel) ?? "gemini-3.1-flash-image-preview",
    geminiBaseUrl: asString(raw?.geminiBaseUrl) ?? env.GEMINI_BASE_URL,
    openrouterBaseUrl:
      asString(raw?.openrouterBaseUrl) ??
      env.OPENROUTER_BASE_URL ??
      "https://openrouter.ai/api/v1",
    logMode:
      asLogMode(raw?.logMode) ??
      asLogMode(env.OPENCLAW_TRAVEL_COMPANION_LOG_MODE) ??
      "safe",
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function asLogMode(value: unknown): "safe" | "debug" | undefined {
  return value === "safe" || value === "debug" ? value : undefined;
}
