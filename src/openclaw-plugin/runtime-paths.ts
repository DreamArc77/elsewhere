import { existsSync, renameSync } from "node:fs";
import { rename } from "node:fs/promises";
import { join } from "node:path";

import { LEGACY_PLUGIN_ID, PLUGIN_ID } from "./metadata.js";

type RuntimePathLogger = {
  info(message: string): void;
  warn(message: string): void;
};

function buildPaths(stateDir: string) {
  return {
    currentRoot: join(stateDir, PLUGIN_ID),
    legacyRoot: join(stateDir, LEGACY_PLUGIN_ID),
  };
}

export function resolvePluginStateRootSync(
  stateDir: string,
  logger?: RuntimePathLogger,
): string {
  const { currentRoot, legacyRoot } = buildPaths(stateDir);
  if (existsSync(currentRoot)) {
    return currentRoot;
  }
  if (!existsSync(legacyRoot)) {
    return currentRoot;
  }

  try {
    renameSync(legacyRoot, currentRoot);
    logger?.info("Migrated legacy plugin state into elsewhere.");
    return currentRoot;
  } catch (error) {
    logger?.warn(
      `Failed to migrate legacy plugin state to elsewhere; continuing with the legacy state directory. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return legacyRoot;
  }
}

export async function resolvePluginStateRoot(
  stateDir: string,
  logger?: RuntimePathLogger,
): Promise<string> {
  const { currentRoot, legacyRoot } = buildPaths(stateDir);
  if (existsSync(currentRoot)) {
    return currentRoot;
  }
  if (!existsSync(legacyRoot)) {
    return currentRoot;
  }

  try {
    await rename(legacyRoot, currentRoot);
    logger?.info("Migrated legacy plugin state into elsewhere.");
    return currentRoot;
  } catch (error) {
    logger?.warn(
      `Failed to migrate legacy plugin state to elsewhere; continuing with the legacy state directory. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return legacyRoot;
  }
}
