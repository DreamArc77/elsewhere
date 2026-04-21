import { describe, expect, it } from "vitest";

import {
  buildInboundTargetCandidates,
  inferConversationTargetForCommand,
} from "../src/openclaw-plugin/channel-compatibility.js";

describe("channel compatibility", () => {
  it("uses Telegram sender id for direct-message command binding", () => {
    expect(
      inferConversationTargetForCommand({
        channel: "telegram",
        from: "telegram:8571518412",
        to: "telegram:8571518412",
        senderId: "1459473177",
      }),
    ).toBe("1459473177");
  });

  it("uses qqbot c2c route for direct-message command binding", () => {
    expect(
      inferConversationTargetForCommand({
        channel: "qqbot",
        from: "qqbot:bot",
        to: "qqbot:bot",
        senderId: "USER123",
      }),
    ).toBe("qqbot:c2c:USER123");
  });

  it("normalizes Feishu direct-message command targets to user scope", () => {
    expect(
      inferConversationTargetForCommand({
        channel: "feishu",
        from: "ou_FEISHU123",
        to: "im:bot",
        senderId: "ou_FEISHU123",
      }),
    ).toBe("user:ou_FEISHU123");
  });

  it("uses WeChat sender id for direct-message command binding", () => {
    expect(
      inferConversationTargetForCommand({
        channel: "wechat",
        from: "wechat-user-1",
        to: "gh_bot_account",
        senderId: "wechat-user-1",
      }),
    ).toBe("wechat-user-1");
  });

  it("adds qqbot c2c and raw sender candidates for inbound recovery", () => {
    expect(
      buildInboundTargetCandidates({
        channel: "qqbot",
        conversationId: "qqbot:bot",
        senderId: "USER123",
        isGroup: false,
      }),
    ).toEqual(
      expect.arrayContaining(["qqbot:bot", "USER123", "qqbot:c2c:USER123"]),
    );
  });

  it("adds normalized Feishu user candidates for inbound recovery", () => {
    expect(
      buildInboundTargetCandidates({
        channel: "feishu",
        conversationId: "im:feishu-dm",
        senderId: "ou_FEISHU123",
        isGroup: false,
      }),
    ).toEqual(
      expect.arrayContaining(["ou_FEISHU123", "feishu:ou_FEISHU123", "user:ou_FEISHU123"]),
    );
  });
});
