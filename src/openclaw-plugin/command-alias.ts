export const PRIMARY_COMMAND_NAME = "elsewhere";
export const LEGACY_COMMAND_NAME = "travel-companion";
export const DIRECT_SUBCOMMAND_ALIASES = [
  "activate",
  "deactivate",
  "setup",
  "create",
  "model",
  "start",
  "status",
  "tick",
  "tick-reply",
  "stop",
] as const;

export const PRIMARY_SLASH_COMMAND = `/${PRIMARY_COMMAND_NAME}`;
export const LEGACY_SLASH_COMMAND = `/${LEGACY_COMMAND_NAME}`;

const COMMAND_PREFIX_PATTERN =
  /^\/(?:elsewhere|travel-companion)\b/iu;
const DIRECT_COMMAND_PREFIX_PATTERN =
  /^\/(?:elsewhere|travel-companion)-([a-z-]+)\b/iu;

export function isSupportedSlashCommand(text: string): boolean {
  const trimmed = text.trim();
  return (
    COMMAND_PREFIX_PATTERN.test(trimmed) ||
    DIRECT_COMMAND_PREFIX_PATTERN.test(trimmed)
  );
}

export function normalizeSupportedSlashCommand(text: string): string {
  const trimmed = text.trim();
  const directMatch = trimmed.match(DIRECT_COMMAND_PREFIX_PATTERN);
  if (directMatch?.[1]) {
    return trimmed.replace(
      DIRECT_COMMAND_PREFIX_PATTERN,
      `${PRIMARY_SLASH_COMMAND} ${directMatch[1]}`,
    );
  }
  return trimmed.replace(COMMAND_PREFIX_PATTERN, PRIMARY_SLASH_COMMAND);
}

export function extractSetupImageCommandUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const setupImageMatch = trimmed.match(
    /\/(?:elsewhere|travel-companion)(?:-setup|\s+setup)\b[\s\S]*?--image\s+(\S+)/iu,
  );
  return setupImageMatch?.[1]?.trim() ?? null;
}
