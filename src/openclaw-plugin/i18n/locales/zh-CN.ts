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
    runtimeTooOld({ currentVersion, minimumVersion }): string {
      return [
        "当前 OpenClaw 版本过低，暂时无法使用 elsewhere。",
        `当前版本：${currentVersion}`,
        `最低要求：${minimumVersion} 或更高版本`,
        "请先运行：openclaw update",
        "更新后重启 gateway，再重新执行 /elsewhere activate。",
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
    tickInProgress({ id, phase, nextRunAt }): string {
      const lines = [
        `已收到 tick：${id}`,
        "reply: 已处理待发送回复",
        "trip: 当前步骤已在处理中，无需重复 tick",
      ];
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
      "首次设置还没完成。继续运行 /elsewhere setup，我会从上次停下的地方继续。",
    gateContinueModel:
      "首次设置还没完成。继续运行 /elsewhere setup，我会直接接着配置模型这一步。",
    gateFirstTime: [
      "欢迎来到 elsewhere。",
      "你会在这里拥有一位属于自己的旅伴，陪你聊天，也替你去远方看看。",
      "您需要先创建您的专属旅伴，运行 /elsewhere setup，我会一步步带你完成首次设置。",
    ].join("\n"),
    setupContinueModel: [
      "好的，旅伴资料已经创建好了。",
      "接下来您还需要配置Gemini API Key来获取旅行规划和自拍生成能力",
    ].join("\n"),
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
      "接下来你可以直接告诉Ta一个想去的目的地，",
      "比如：东京 / 北京 / 巴黎",
      "Ta就会开始准备这次旅行。",
    ].join("\n"),
  },
  setup: {
    cancelledCreate: "已取消本次设置。",
    cancelledEdit: "已取消本次修改。",
    readyReplyOne: "准备好了就回复 1。",
    keepCurrentHint: "回复新内容，或回复 0 沿用当前值。",
    personaIntro: [
      "我们先来创建您的旅伴。",
      "",
      "接下来我会依次向您确认Ta的：",
      "1. 名字",
      "2. 居住的城市",
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
    askName: "先给Ta起个名字吧。",
    askOriginCity: "Ta现在居住在哪座城市？这会作为她的默认出发地。",
    askTraits: "用一句话或几个词写下Ta的性格特征。",
    askTone: "Ta平时说话是什么感觉？",
    askRelationship: "Ta和你是什么关系？",
    askUserAddressing: "Ta平时怎么称呼你？",
    traitsExample: "例如：热情、傲娇、敏感、黏人、地雷系",
    toneExample: "",
    relationshipExample: "例如：爱人、朋友、旅行搭子",
    userAddressingExample: "例如：哥哥、宝宝、宝、名字里的称呼",
    reviewTitle: "当前资料如下：",
    reviewFieldName: "名字",
    reviewFieldOriginCity: "Ta居住的城市",
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
      "参考图会用于后续自拍生成，主要影响旅伴的长相和气质。",
      "",
      "回复：",
      "1. 上传一张新参考图",
      "2. 沿用当前参考图",
      "3. 返回资料确认",
    ].join("\n"),
    referencePhotoChoiceWithoutCurrent: [
      "最后一步是参考图。",
      "它会用于后续自拍生成，主要影响旅伴的长相和气质。",
      "建议发送一张单人、正脸清楚、无遮挡、光线自然的照片，尽量不要用合照或滤镜太重的图。",
      "",
      "回复：",
      "1. 上传参考图",
      "2. 返回资料确认",
    ].join("\n"),
    referencePhotoAwaiting:
      "现在直接发一张图片就行。最好是单人、正脸清楚、无遮挡、光线自然的照片，尽量不要用多人合照、过度滤镜或表情包。",
    completePersonaCreated: "旅伴创建完成。",
    completePersonaUpdated: "旅伴资料已更新。",
    completeModel: "模型配置已完成。",
    completeGeneric: "继续完成设置。",
    textProviderChoice(current: string): string {
      return [
        "请确认旅伴聊天时要用的文本模型。大多数情况下直接选 1 就够了：",
        `当前：${current}`,
        "1. default（使用当前 OpenClaw 默认模型）",
        "2. gemini",
        "3. openai-compatible",
      ].join("\n");
    },
    askOpenAiBaseUrl(current: string): string {
      return [`请输入 OpenAI-compatible 的 base URL。`, `当前：${current}`].join(
        "\n",
      );
    },
    askOpenAiApiKey: "请输入这个 OpenAI-compatible provider 的 API key。",
    askOpenAiModel(current: string): string {
      return [`请输入要使用的模型名。`, `当前：${current}`].join("\n");
    },
    geminiProviderChoice(current: string): string {
      return [
        "最后一步，给 旅行规划 和 生图 选一个 Gemini 通道：",
        `当前：${current}`,
        "1. google-direct（Gemini API key / AI Studio）",
        "2. openrouter（用 OpenRouter key 调 Gemini）",
      ].join("\n");
    },
    askGeminiApiKey: [
      "还需要一个 Gemini API key。",
      "旅行规划 和生图都会共用这一个 Google Gemini key。",
      "Gemini key 获取链接：https://aistudio.google.com/app/apikey",
      "直接把 key 发我就行。",
    ].join("\n"),
    askOpenRouterApiKey: [
      "还需要一个 OpenRouter API key。",
      "旅行规划 和生图都会共用这一个 OpenRouter key，并通过 OpenRouter 调 Gemini。",
      "OpenRouter key 获取链接：https://openrouter.ai/settings/keys",
      "直接把 key 发我就行。",
    ].join("\n"),
    localeSelectionPersisted(localeLabel: string): string {
      return `已切换为：${localeLabel}`;
    },
    errorReplyOne: "准备好了就回复 1。",
    errorContinueOrCancel: "请回复 1 继续修改，或回复 2 取消。",
    errorReviewOption: "请回复 1-8 里的一个选项。",
    errorReferencePhotoChoiceWithCurrent: "请回复 1、2 或 3。",
    errorReferencePhotoChoiceWithoutCurrent: "请回复 1 或 2。",
    errorModelChoice:
      "请直接回复 1 / 2 / 3",
    errorGeminiProviderChoice:
      "请直接回复 1 / 2",
    errorNeedUserAddressing:
      "当前还没有设置旅伴对你的称呼，这一项需要补一个。",
    errorWaitingForPhoto: "当前 setup 步骤不在等待照片。",
    photoChecking:
      "正在检查你刚发来的图片，请稍等一下。",
    errorWaitingForPhotoWithFallback:
      "正在检查你刚发来的图片，请稍等一下。如果稍后还没有继续，你可以重发一次图片，或发送一个可访问的图片 URL。",
    errorUnsupportedImage:
      "这张图片现在还不能用作参考图，请换一张常见格式的图片试试。",
    errorImageDownloadFailed:
      "参考图处理失败了。你可以重发一张图，或者直接发一个可访问的图片 URL。",
    errorGeneric: "这一步没有处理成功，请按提示再试一次。",
  },
  replyErrors: {
    personaRequired:
      "人设还没准备好呢，先用 /elsewhere setup 帮我设定形象和性格吧。",
    idleDestinationStartFailed:
      "行程规划失败。你晚一点再跟我说一次目的地，我会继续试。",
    planningFailed: "这次行程生成失败了，请稍后再试。",
    postcardFailed: "这次 消息 发送没确认成功，请稍后再试。",
    replyFailed: "这次回复发送没确认成功，请稍后再试。",
  },
};
