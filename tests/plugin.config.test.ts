import { describe, expect, it } from "vitest";

import { resolvePluginConfig } from "../src/openclaw-plugin/config.js";

describe("travel companion plugin config", () => {
  it("defaults to Gemini 3 models that support search plus structured outputs", () => {
    const config = resolvePluginConfig({}, {});

    expect(config.planningModel).toBe("gemini-3-flash-preview");
    expect(config.textModel).toBe("gemini-3-flash-preview");
    expect(config.imageModel).toBe("gemini-3.1-flash-image-preview");
  });
});
