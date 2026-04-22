import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  resolvePluginStateRoot,
  resolvePluginStateRootSync,
} from "../src/openclaw-plugin/runtime-paths.js";

describe("elsewhere upgrade migrations", () => {
  it("moves legacy runtime state into the elsewhere directory", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "elsewhere-migrate-"));
    const legacyRoot = join(stateDir, "openclaw-travel-companion");
    await mkdir(legacyRoot, { recursive: true });
    await writeFile(join(legacyRoot, "sentinel.txt"), "ok");

    const messages: string[] = [];
    const root = await resolvePluginStateRoot(stateDir, {
      info(message) {
        messages.push(message);
      },
      warn(message) {
        messages.push(message);
      },
    });

    expect(root).toBe(join(stateDir, "elsewhere"));
    await expect(access(join(root, "sentinel.txt"))).resolves.toBeUndefined();
    expect(messages.some((message) => message.includes("Migrated legacy"))).toBe(
      true,
    );
  });

  it("uses the same migration rules for synchronous startup paths", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "elsewhere-sync-"));
    const legacyRoot = join(stateDir, "openclaw-travel-companion");
    await mkdir(legacyRoot, { recursive: true });

    const root = resolvePluginStateRootSync(stateDir);

    expect(root).toBe(join(stateDir, "elsewhere"));
  });
});
