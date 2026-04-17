import type { ConversationCompanionState, SystemLocale } from "../../domain/types.js";
import { en } from "./locales/en.js";
import { jaJP } from "./locales/ja-JP.js";
import { zhCN } from "./locales/zh-CN.js";
import type { SystemLocaleCatalog } from "./types.js";

const catalogs: Record<SystemLocale, SystemLocaleCatalog> = {
  "zh-CN": zhCN,
  "ja-JP": jaJP,
  en,
};

export const DEFAULT_SYSTEM_LOCALE: SystemLocale = "zh-CN";

export function getSystemCatalog(
  locale: SystemLocale | undefined | null,
): SystemLocaleCatalog {
  return catalogs[locale ?? DEFAULT_SYSTEM_LOCALE] ?? zhCN;
}

export function getSystemLocale(
  state: Pick<ConversationCompanionState, "systemLocale"> | null | undefined,
): SystemLocale {
  return state?.systemLocale ?? DEFAULT_SYSTEM_LOCALE;
}

export function parseSystemLocaleChoice(
  value: string,
): SystemLocale | null {
  const trimmed = value.trim();
  if (trimmed === "1") {
    return "zh-CN";
  }
  if (trimmed === "2") {
    return "ja-JP";
  }
  if (trimmed === "3") {
    return "en";
  }
  return null;
}

export function buildLocaleSelectionMenu(): string {
  return zhCN.locale.menu;
}
