import type {
  TravelCompanionGlobalConfig,
  TravelCompanionPlanningImageProviderConfig,
  TravelCompanionPlanningImageProviderKind,
} from "../domain/types.js";
import type { TravelCompanionPluginConfig } from "./config.js";

export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

function parseLegacyKind(
  kind: string | undefined,
): TravelCompanionPlanningImageProviderKind | undefined {
  switch (kind) {
    case "google-direct":
      return "gemini-direct";
    case "openrouter":
      return "gemini-openrouter";
    case "openai-direct":
      return "openai-direct";
    default:
      return undefined;
  }
}

function normalizeProvider(
  kind: TravelCompanionPlanningImageProviderKind,
  apiKey: string | undefined,
  pluginConfig: TravelCompanionPluginConfig,
  configuredBaseUrl?: string,
): TravelCompanionPlanningImageProviderConfig {
  const family = kind.startsWith("openai") ? "openai" : "gemini";
  const channel = kind.endsWith("openrouter") ? "openrouter" : "native";
  const baseUrl =
    configuredBaseUrl?.trim() ||
    (channel === "openrouter"
      ? pluginConfig.openrouterBaseUrl || DEFAULT_OPENROUTER_BASE_URL
      : family === "openai"
        ? pluginConfig.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL
        : pluginConfig.geminiBaseUrl);

  return {
    kind,
    family,
    channel,
    apiKey: apiKey?.trim() || undefined,
    baseUrl,
  };
}

export function resolveConfiguredGeminiProvider(input: {
  globalConfig: TravelCompanionGlobalConfig;
  pluginConfig: TravelCompanionPluginConfig;
}): TravelCompanionPlanningImageProviderConfig | undefined {
  const configured = input.globalConfig.planningImageProvider;
  if (configured?.kind) {
    return normalizeProvider(
      configured.kind,
      configured.apiKey,
      input.pluginConfig,
      configured.baseUrl,
    );
  }

  const legacyKind = parseLegacyKind(input.globalConfig.geminiProvider?.kind);
  if (legacyKind) {
    return normalizeProvider(
      legacyKind,
      input.globalConfig.geminiProvider?.apiKey ?? input.globalConfig.geminiApiKey,
      input.pluginConfig,
      input.globalConfig.geminiProvider?.baseUrl,
    );
  }

  if (input.pluginConfig.openrouterApiKey?.trim()) {
    return normalizeProvider(
      "gemini-openrouter",
      input.pluginConfig.openrouterApiKey,
      input.pluginConfig,
    );
  }

  if (input.pluginConfig.openaiApiKey?.trim()) {
    return normalizeProvider(
      "openai-direct",
      input.pluginConfig.openaiApiKey,
      input.pluginConfig,
    );
  }

  if (input.pluginConfig.geminiApiKey?.trim()) {
    return normalizeProvider(
      "gemini-direct",
      input.pluginConfig.geminiApiKey,
      input.pluginConfig,
    );
  }

  return undefined;
}

export function hasConfiguredGeminiProvider(input: {
  globalConfig: TravelCompanionGlobalConfig;
  pluginConfig?: Pick<
    TravelCompanionPluginConfig,
    "geminiApiKey" | "openrouterApiKey" | "openaiApiKey"
  >;
}): boolean {
  return Boolean(
    input.globalConfig.planningImageProvider?.apiKey?.trim() ||
      input.globalConfig.geminiProvider?.apiKey?.trim() ||
      input.globalConfig.geminiApiKey?.trim() ||
      input.pluginConfig?.geminiApiKey?.trim() ||
      input.pluginConfig?.openrouterApiKey?.trim() ||
      input.pluginConfig?.openaiApiKey?.trim(),
  );
}

export function describeConfiguredGeminiProvider(input: {
  globalConfig: TravelCompanionGlobalConfig;
  pluginConfig: TravelCompanionPluginConfig;
}): string {
  const provider = resolveConfiguredGeminiProvider(input);
  return provider ? `${provider.family}/${provider.channel}` : "none";
}
