import type {
  TravelCompanionGeminiProviderConfig,
  TravelCompanionGlobalConfig,
} from "../domain/types.js";
import type { TravelCompanionPluginConfig } from "./config.js";

export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function resolveConfiguredGeminiProvider(input: {
  globalConfig: TravelCompanionGlobalConfig;
  pluginConfig: TravelCompanionPluginConfig;
}): TravelCompanionGeminiProviderConfig | undefined {
  const configured = input.globalConfig.geminiProvider;
  if (configured?.kind) {
    return {
      kind: configured.kind,
      apiKey: configured.apiKey?.trim() || undefined,
      baseUrl:
        configured.baseUrl?.trim() ||
        (configured.kind === "openrouter"
          ? input.pluginConfig.openrouterBaseUrl || DEFAULT_OPENROUTER_BASE_URL
          : input.pluginConfig.geminiBaseUrl),
    };
  }

  if (input.globalConfig.geminiApiKey?.trim()) {
    return {
      kind: "google-direct",
      apiKey: input.globalConfig.geminiApiKey.trim(),
      baseUrl: input.pluginConfig.geminiBaseUrl,
    };
  }

  if (input.pluginConfig.openrouterApiKey?.trim()) {
    return {
      kind: "openrouter",
      apiKey: input.pluginConfig.openrouterApiKey.trim(),
      baseUrl: input.pluginConfig.openrouterBaseUrl || DEFAULT_OPENROUTER_BASE_URL,
    };
  }

  if (input.pluginConfig.geminiApiKey?.trim()) {
    return {
      kind: "google-direct",
      apiKey: input.pluginConfig.geminiApiKey.trim(),
      baseUrl: input.pluginConfig.geminiBaseUrl,
    };
  }

  return undefined;
}

export function hasConfiguredGeminiProvider(input: {
  globalConfig: TravelCompanionGlobalConfig;
  pluginConfig?: Pick<
    TravelCompanionPluginConfig,
    "geminiApiKey" | "openrouterApiKey"
  >;
}): boolean {
  return Boolean(
    input.globalConfig.geminiProvider?.apiKey?.trim() ||
      input.globalConfig.geminiApiKey?.trim() ||
      input.pluginConfig?.geminiApiKey?.trim() ||
      input.pluginConfig?.openrouterApiKey?.trim(),
  );
}

export function describeConfiguredGeminiProvider(input: {
  globalConfig: TravelCompanionGlobalConfig;
  pluginConfig: TravelCompanionPluginConfig;
}): string {
  const provider = resolveConfiguredGeminiProvider(input);
  return provider?.kind ?? "none";
}
