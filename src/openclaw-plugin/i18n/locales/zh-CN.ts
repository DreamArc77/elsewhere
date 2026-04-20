import type { SystemLocale } from "../../../domain/types.js";
import type { SystemLocaleCatalog } from "../types.js";

export const zhCN: SystemLocaleCatalog = {
  common: {
    none: "无",
    unknown: "未知",
    invalidOption: "无效选项。",
    laterRetry: "请稍后再试。",
  },
  locale: {
    menu: [
      "Choose system language / システム言語を選んでください / 选择系统语言",
      "1. 简体中文",
      "2. 日本語",
      "3. English",
    ].join("\n"),
    invalid: [
      "无效选项，请回复 1 / 2 / 3。",
      "",
      "1. 简体中文",
      "2. 日本語",
      "3. English",
    ].join("\n"),
    completed: "系统语言已设置。",
    eventLabel(locale: SystemLocale): string {
      return locale === "zh-CN"
        ? "简体中文"
        : locale === "ja-JP"
          ? "日本語"
          : "English";
    },
  },
  help: {
    lines: [
      "/elsewhere bind",
      "/elsewhere activate",
      "/elsewhere deactivate",
      "/elsewhere setup                      # 修改当前旅伴",
      "/elsewhere create                     # 创建新的旅伴",
      "/elsewhere model                      # 重新配置文本模型 / Gemini key",
      "/elsewhere start --to Tokyo [--from Hong-Kong] [--when next-week]",
      "/elsewhere status [--trip <id>]",
      "/elsewhere tick [--trip <id>]         # 立即推进延迟回复和下一步行程",
      "/elsewhere tick-reply                 # 只立即推进延迟回复",
      "/elsewhere stop [--trip <id>]",
    ],
  },
  command: {
    bindSuccess: "这条会话已经和 elsewhere 绑定好了。",
    bindNextActivate: "接下来运行 /elsewhere activate，进入旅伴模式。",
    activateEnabled: "旅伴模式已开启。",
    activateReady: "现在直接告诉旅伴一个想去的目的地就行。",
    deactivateClosed: "旅伴模式已关闭。",
    deactivateTripStopped: "当前行程已停止。",
    deactivateDefaultAssistant: "这条会话已经回到默认助手。",
    notReadyBind:
      "这条会话还没准备好。请在你想接收消息的聊天里运行 /elsewhere bind。",
    activateFirst: "这条会话还没准备好。先运行 /elsewhere activate。",
    notActiveYet: "旅伴还没在这个聊天里激活。先运行 /elsewhere activate。",
    approvalRequired(approvalId: string): string {
      return [
        "需要先批准会话接管。",
        `approvalId: ${approvalId}`,
        "批准后，再运行一次 /elsewhere activate。",
      ].join("\n");
    },
    startCreated({ tripId, destination, days }): string {
      return [
        `行程已创建：${tripId}`,
        `目的地：${destination}`,
        `天数：${days}`,
        "后台会开始推进行程，并主动在这里发送 postcard。",
      ].join("\n");
    },
    startMissingPersona:
      "这条会话还没有默认的旅伴。先运行 /elsewhere setup，或者在 start 时传 --persona。",
    statusNoTrip(input): string {
      return [
        "这条会话还没有记录到最近的行程。",
        `channel: ${input.channel}`,
        `channelCombinedPostcard: ${input.channelCombinedPostcard}`,
        `channelMediaPostcard: ${input.channelMediaPostcard}`,
        `channelInboundImageSetup: ${input.channelInboundImageSetup}`,
        `channelProactiveMessaging: ${input.channelProactiveMessaging}`,
      ].join("\n");
    },
    tripNotFound(tripId: string): string {
      return `未找到行程：${tripId}`;
    },
    tickSuccess({ id, status, phase, nextRunAt }): string {
      const lines = [`已立即 tick：${id}`, "reply: 已处理待发送回复"];
      if (status) lines.push(`status: ${status}`);
      if (phase) lines.push(`phase: ${phase}`);
      if (nextRunAt) lines.push(`nextRunAt: ${nextRunAt}`);
      return lines.join("\n");
    },
    tickFailure(id: string): string {
      return [
        `已尝试 tick：${id}`,
        "这次还没能确认 postcard 或延迟回复发送成功。",
        "状态已经保留，请稍后再试 /elsewhere tick。",
      ].join("\n");
    },
    tickReplySuccess(id: string): string {
      return [
        `已立即 tick reply：${id}`,
        "reply: 已处理待发送回复",
        "trip: 未推进",
      ].join("\n");
    },
    tickReplyFailure(id: string): string {
      return [
        `已尝试 tick reply：${id}`,
        "这次还没能确认延迟回复发送成功。",
        "状态已经保留，请稍后再试 /elsewhere tick-reply。",
      ].join("\n");
    },
    stopNoTrip: "当前没有可停止的行程。",
    stopSuccess({ tripId, status }): string {
      return [
        `已停止：${tripId}`,
        `status: ${status}`,
        "这个行程不会再继续调度消息。",
        "运行时上下文已清空，旅伴仍保持激活，并已回到待机状态。",
      ].join("\n");
    },
    tripStartProviderBlocked: [
      "这次行程生成失败了。",
      "Gemini 当前拒绝了这次请求，像是 provider 侧限制，不是你目的地填错了。",
      "先不用重复发送目的地，稍后再试就行。",
    ].join("\n"),
    tripStartFailed(message?: string): string {
      return [
        "这次行程生成失败了。",
        message ? `错误信息：${message}` : "请稍后再试。",
      ].join("\n");
    },
    internalFailure: "这次操作没有成功完成，请稍后再试。",
    channelCapabilitySupported: "supported",
    channelCapabilityLimited: "limited",
    channelCapabilityUnsupported: "unsupported",
    channelCapabilityUnknown: "unknown",
  },
  onboarding: {
    gateContinueSetup:
      "旅伴资料还没配完。继续运行 /elsewhere setup，然后按提示一步步回复就行。",
    gateContinueModel:
      "模型配置还没配完。继续运行 /elsewhere model，然后按提示一步步回复就行。",
    gateFirstTime: [
      "欢迎来到 elsewhere。",
      "你将在这里拥有一位属于自己的旅伴，陪你聊天，也替你去远方看看。",
      "接下来，我们先把旅伴设定好。",
      "",
      "先运行 /elsewhere setup，完成旅伴资料。",
      "再运行 /elsewhere model，完成文本模型和 planning / 生图配置。",
    ].join("\n"),
    gateMissingPersona: "旅伴资料",
    gateMissingModel: "文本模型配置",
    gateMissingGemini: "planning / 生图通道配置",
    gateMissingSummary(items: string[]): string {
      return `还差：${items.join("、")}`;
    },
    gatePersonaFirstSetup:
      "先运行 /elsewhere setup，我会一步步带你配完旅伴资料。",
    gatePersonaFirstModel:
      "旅伴资料配好后，再用 /elsewhere model 补文本模型和 planning / 生图通道。",
    gateModelOnlyIntro: "旅伴资料已经有了。",
    gateModelOnlyAction:
      "现在运行 /elsewhere model，把文本模型和 planning / 生图通道配完就行。",
    personaCreated(name: string): string {
      return `${name} 创建完成。`;
    },
    personaUpdated(name: string): string {
      return `${name} 的资料已更新。`;
    },
    personaUpdatedReactivateHint: [
      "为了避免旧上下文影响体验，建议先执行：",
      "/elsewhere deactivate",
      "",
      "然后再执行：",
      "/elsewhere activate",
    ].join("\n"),
    modelUpdated: "模型配置已更新。",
    idleGuideHint: [
      "接下来你可以直接告诉旅伴一个想去的目的地，",
      "比如：东京 / 北京 / 巴黎",
      "旅伴就会开始准备这次旅行。",
    ].join("\n"),
  },
  setup: {
    cancelledCreate: "已取消本次设置。",
    cancelledEdit: "已取消本次修改。",
    readyReplyOne: "准备好了就回复 1。",
    keepCurrentHint: "回复新内容，或回复 0 沿用当前值。",
    personaIntro: [
      "我们先来设定旅伴。",
      "",
      "接下来我会依次确认：",
      "1. 名字",
      "2. 旅伴居住的城市",
      "3. 性格特征",
      "4. 说话风格",
      "5. 和你的关系",
      "6. 对你的称呼",
      "7. 参考图",
      "",
      "准备好了就回复 1。",
    ].join("\n"),
    existingPersonaConfirm: [
      "当前已经有一位旅伴了。",
      "",
      "这个命令会用于修改或覆盖现有资料。",
      "回复：",
      "1. 继续修改",
      "2. 取消",
    ].join("\n"),
    currentValue(value: string): string {
      return `当前值：${value}`;
    },
    askName: "先给旅伴起个名字吧。",
    askOriginCity: "旅伴现在居住在哪座城市？这会作为默认出发地。",
    askTraits: "用几个词写下旅伴的性格特征。",
    askTone: "旅伴平时说话是什么感觉？",
    askRelationship: "旅伴和你是什么关系？",
    askUserAddressing: "旅伴平时怎么称呼你？",
    traitsExample: "例如：地雷系、敏感、黏人",
    toneExample: "例如：病娇、撒娇、冷淡、元气",
    relationshipExample: "例如：异地恋对象、暧昧对象、旅行搭子",
    userAddressingExample: "例如：哥哥、宝宝、宝、名字里的称呼",
    reviewTitle: "当前资料如下：",
    reviewFieldName: "名字",
    reviewFieldOriginCity: "旅伴居住的城市",
    reviewFieldTraits: "性格特征",
    reviewFieldTone: "说话风格",
    reviewFieldRelationship: "和你的关系",
    reviewFieldUserAddressing: "对你的称呼",
    reviewConfirmEdit: "1. 确认并继续处理参考图",
    reviewConfirmCreate: "1. 确认并继续处理参考图",
    reviewEditName: "2. 修改名字",
    reviewEditOriginCity: "3. 修改旅伴居住的城市",
    reviewEditTraits: "4. 修改性格特征",
    reviewEditTone: "5. 修改说话风格",
    reviewEditRelationship: "6. 修改和你的关系",
    reviewEditUserAddressing: "7. 修改对你的称呼",
    reviewCancelEdit: "8. 取消本次修改",
    reviewCancelCreate: "8. 取消本次设置",
    referencePhotoChoiceWithCurrent: [
      "当前已经有参考图了。",
      "参考图会用于后续自拍生成，主要决定旅伴的长相和气质。",
      "",
      "回复：",
      "1. 上传一张新参考图",
      "2. 沿用当前参考图",
      "3. 返回资料确认",
    ].join("\n"),
    referencePhotoChoiceWithoutCurrent: [
      "最后一步是参考图。",
      "它会用于后续自拍生成，主要决定旅伴的长相和气质。",
      "建议发送一张单人、正脸清楚、无遮挡、光线自然的照片。",
      "",
      "回复：",
      "1. 上传参考图",
      "2. 返回资料确认",
    ].join("\n"),
    referencePhotoAwaiting:
      "现在直接发一张图片就行。建议单人、正脸清楚、无遮挡、光线自然，尽量不要用多人合照、过度滤镜或表情包。",
    completePersonaCreated: "旅伴创建完成。",
    completePersonaUpdated: "旅伴资料已更新。",
    completeModel: "模型配置已完成。",
    completeGeneric: "继续完成设置。",
    textProviderChoice(current: string): string {
      return [
        "文本模型怎么配？回复一个选项：",
        `当前：${current}`,
        "1. default（使用当前 OpenClaw 默认模型）",
        "2. gemini",
        "3. openai-compatible",
      ].join("\n");
    },
    askOpenAiBaseUrl(current: string): string {
      return [`回复 OpenAI-compatible 的 base URL。`, `当前：${current}`].join(
        "\n",
      );
    },
    askOpenAiApiKey: "回复这个 OpenAI-compatible provider 的 API key。",
    askOpenAiModel(current: string): string {
      return [`回复要使用的模型名。`, `当前：${current}`].join("\n");
    },
    geminiProviderChoice(current: string): string {
      return [
        "planning 和生图要走哪种 Gemini 通道？回复一个选项：",
        `当前：${current}`,
        "1. google-direct（Gemini API key / AI Studio）",
        "2. openrouter（用 OpenRouter key 调 Gemini）",
      ].join("\n");
    },
    askGeminiApiKey: [
      "还差 Gemini API key。",
      "planning 和生图都会共用这一个 Google Gemini key。",
      "Gemini key 获取链接：https://aistudio.google.com/app/apikey",
      "直接把 key 发我就行。",
    ].join("\n"),
    askOpenRouterApiKey: [
      "还差 OpenRouter API key。",
      "planning 和生图都会共用这一个 OpenRouter key，并通过 OpenRouter 调 Gemini。",
      "OpenRouter key 获取链接：https://openrouter.ai/settings/keys",
      "直接把 key 发我就行。",
    ].join("\n"),
    localeSelectionPersisted(localeLabel: string): string {
      return `系统语言已设置为：${localeLabel}`;
    },
    errorReplyOne: "准备好了就回复 1。",
    errorContinueOrCancel: "请回复 1 继续修改，或回复 2 取消。",
    errorReviewOption: "请回复 1-8 里的一个选项。",
    errorReferencePhotoChoiceWithCurrent: "请回复 1、2 或 3。",
    errorReferencePhotoChoiceWithoutCurrent: "请回复 1 或 2。",
    errorModelChoice:
      "没看懂这个模型选项。回复 1 / 2 / 3，或者直接回复 default / gemini / openai-compatible。",
    errorGeminiProviderChoice:
      "没看懂这个 planning / 生图通道选项。回复 1 / 2，或者直接回复 google-direct / openrouter。",
    errorNeedUserAddressing:
      "当前还没有设置旅伴对你的称呼，这一项需要补一个。",
    errorWaitingForPhoto: "当前 setup 步骤不在等待照片。",
    errorWaitingForPhotoWithFallback:
      "我现在在等你的参考图。你可以直接发一张图片；如果这个平台传图不稳定，也可以直接发图片 URL，或者发 `/elsewhere setup --image 图片URL`。",
    errorUnsupportedImage:
      "这张图片现在还不能用作参考图，请换一张常见格式的图片试试。",
    errorImageDownloadFailed:
      "参考图处理失败了。你可以重发一张图，或者直接发一个可访问的图片 URL。",
    errorGeneric: "这一步没有处理成功，请按提示再试一次。",
  },
  replyErrors: {
    personaRequired:
      "我还没准备好出发呢，先用 /elsewhere setup 帮我设定形象和性格吧，然后我就能认真回你了。",
    idleDestinationStartFailed:
      "我刚刚想把这趟行程接起来，不过这边卡住了。你晚一点再跟我说一次目的地，我会继续试。",
    planningFailed: "这次行程生成失败了，请稍后再试。",
    postcardFailed: "这次 postcard 发送没确认成功，请稍后再试。",
    replyFailed: "这次回复发送没确认成功，请稍后再试。",
  },
};
