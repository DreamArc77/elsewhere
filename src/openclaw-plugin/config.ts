export interface TravelCompanionPluginConfig {
  geminiApiKey?: string;
  defaultOriginCity?: string;
  pollIntervalSeconds?: number;
  openclawBinaryPath?: string;
  planningModel?: string;
  textModel?: string;
  imageModel?: string;
  geminiBaseUrl?: string;
}

export function resolvePluginConfig(
  raw: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Required<Pick<TravelCompanionPluginConfig, "pollIntervalSeconds" | "openclawBinaryPath">> &
  TravelCompanionPluginConfig {
  return {
    geminiApiKey:
      asString(raw?.geminiApiKey) ?? env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY,
    defaultOriginCity: asString(raw?.defaultOriginCity) ?? "Hong Kong",
    pollIntervalSeconds: asInteger(raw?.pollIntervalSeconds) ?? 60,
    openclawBinaryPath: asString(raw?.openclawBinaryPath) ?? "openclaw",
    planningModel: asString(raw?.planningModel) ?? "gemini-3-flash-preview",
    textModel: asString(raw?.textModel) ?? "gemini-3-flash-preview",
    imageModel: asString(raw?.imageModel) ?? "gemini-3.1-flash-image-preview",
    geminiBaseUrl: asString(raw?.geminiBaseUrl) ?? env.GEMINI_BASE_URL,
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}
