import { describe, expect, it } from "vitest";

import {
  mergeLegacyPluginConfig,
  resolvePluginConfig,
} from "../src/openclaw-plugin/config.js";

describe("elsewhere plugin config", () => {
  it("defaults only the text model and leaves plan/image models provider-specific", () => {
    const config = resolvePluginConfig({}, {});

    expect(config.planningModel).toBeUndefined();
    expect(config.textModel).toBe("gemini-3-flash-preview");
    expect(config.imageModel).toBeUndefined();
  });

  it("merges legacy plugin config into the new elsewhere entry during upgrades", () => {
    const config = resolvePluginConfig(
      mergeLegacyPluginConfig(
        { textModel: "gemini-3-flash-preview" },
        {
          plugins: {
            entries: {
              "openclaw-travel-companion": {
                config: {
                  geminiApiKey: "legacy-key",
                  pollIntervalSeconds: 90,
                },
              },
            },
          },
        },
      ),
      {},
    );

    expect(config.geminiApiKey).toBe("legacy-key");
    expect(config.pollIntervalSeconds).toBe(90);
    expect(config.textModel).toBe("gemini-3-flash-preview");
  });

  it("supports the renamed log mode environment variable", () => {
    const config = resolvePluginConfig(
      {},
      {
        OPENCLAW_ELSEWHERE_LOG_MODE: "debug",
      } as NodeJS.ProcessEnv,
    );

    expect(config.logMode).toBe("debug");
  });
});
