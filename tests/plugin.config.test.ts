import { describe, expect, it } from "vitest";

import {
  mergeLegacyPluginConfig,
  resolvePluginConfig,
} from "../src/openclaw-plugin/config.js";

describe("elsewhere plugin config", () => {
  it("defaults to Gemini 3 models that support search plus structured outputs", () => {
    const config = resolvePluginConfig({}, {});

    expect(config.planningModel).toBe("gemini-3-flash-preview");
    expect(config.textModel).toBe("gemini-3-flash-preview");
    expect(config.imageModel).toBe("gemini-3.1-flash-image-preview");
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
