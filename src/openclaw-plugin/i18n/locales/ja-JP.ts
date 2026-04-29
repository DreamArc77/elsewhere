import type { SystemLocale } from "../../../domain/types.js";
import type { SystemLocaleCatalog } from "../types.js";

export const jaJP: SystemLocaleCatalog = {
  common: {
    none: "なし",
    unknown: "不明",
    invalidOption: "無効な選択です。",
    laterRetry: "少し待ってからもう一度試してください。",
  },
  locale: {
    menu: [
      "Choose system language / システム言語を選んでください / 选择系统语言",
      "1. 简体中文",
      "2. 日本語",
      "3. English",
    ].join("\n"),
    invalid: [
      "無効な選択です。1 / 2 / 3 で返信してください。",
      "",
      "1. 简体中文",
      "2. 日本語",
      "3. English",
    ].join("\n"),
    completed: "システム言語を設定しました。",
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
      "/elsewhere activate",
      "/elsewhere deactivate",
      "/elsewhere setup                      # 今の相棒を編集",
      "/elsewhere model                      # テキストモデル / 旅行計画・画像生成プロバイダを再設定",
      "/elsewhere status",
      "/elsewhere stop",
    ],
  },
  command: {
    bindSuccess: "この会話は elsewhere に紐づけられました。",
    bindNextActivate:
      "続けて /elsewhere activate を実行すると、相棒モードに入ります。",
    activateEnabled: "相棒モードを有効にしました。",
    activateReady: "このまま相棒に行きたい行き先を伝えてください。",
    deactivateClosed: "相棒モードを無効にしました。",
    deactivateTripStopped: "現在の旅行を停止しました。",
    deactivateDefaultAssistant:
      "この会話はデフォルトアシスタントに戻りました。",
    notReadyBind:
      "この会話はまだ準備できていません。メッセージを受け取りたいチャットで /elsewhere bind を実行してください。",
    activateFirst:
      "この会話はまだ準備できていません。先に /elsewhere activate を実行してください。",
    notActiveYet:
      "このチャットではまだ相棒が有効ではありません。先に /elsewhere activate を実行してください。",
    approvalRequired(approvalId: string): string {
      return [
        "会話の引き継ぎ承認が必要です。",
        `approvalId: ${approvalId}`,
        "承認後、もう一度 /elsewhere activate を実行してください。",
      ].join("\n");
    },
    runtimeTooOld({ currentVersion, minimumVersion }): string {
      return [
        "銇撱伄 OpenClaw 銇儛銉笺偢銉с儳銉炪伅 elsewhere 銈掍娇銇嗐伀銇彜銇欍亱銇ｃ仹銇欍€?",
        `鐝惧湪銇儛銉笺偢銉с儳銉?: ${currentVersion}`,
        `蹇呰銇儛銉笺偢銉с儳銉?: ${minimumVersion} 浠ヤ笂`,
        "openclaw update 銈掑疅琛屻仐銇︺亸銇犮仌銇勩€?",
        "銇濄伄寰屻€乬ateway 銈掑啀璧峰嫊銇椼€?/elsewhere activate 銈掕│銇椺亗銇椼仸銇忋仩銇曘亜銆?",
      ].join("\n");
    },
    startCreated({ tripId, destination, days }): string {
      return [
        `旅行を作成しました: ${tripId}`,
        `行き先: ${destination}`,
        `日数: ${days}`,
        "バックグラウンドで旅行を進め、この会話に postcard を送ります。",
      ].join("\n");
    },
    startMissingPersona:
      "この会話にはまだ既定の相棒がありません。先に /elsewhere setup を実行するか、start に --persona を付けてください。",
    statusNoTrip(input): string {
      return [
        "この会話にはまだ最近の旅行記録がありません。",
        `channel: ${input.channel}`,
        `channelCombinedPostcard: ${input.channelCombinedPostcard}`,
        `channelMediaPostcard: ${input.channelMediaPostcard}`,
        `channelInboundImageSetup: ${input.channelInboundImageSetup}`,
        `channelProactiveMessaging: ${input.channelProactiveMessaging}`,
      ].join("\n");
    },
    tripNotFound: (tripId) => `旅行が見つかりません: ${tripId}`,
    tickSuccess({ id, status, phase, nextRunAt }): string {
      const lines = [`即時 tick: ${id}`, "reply: 保留中の返信を処理しました"];
      if (status) lines.push(`status: ${status}`);
      if (phase) lines.push(`phase: ${phase}`);
      if (nextRunAt) lines.push(`nextRunAt: ${nextRunAt}`);
      return lines.join("\n");
    },
    tickInProgress: ({ id, phase, nextRunAt }) => {
      const lines = [
        `tick を受け付けました: ${id}`,
        "reply: 保留中の返信を処理しました",
        "trip: 現在のステップはすでに処理中です",
      ];
      if (phase) lines.push(`phase: ${phase}`);
      if (nextRunAt) lines.push(`nextRunAt: ${nextRunAt}`);
      return lines.join("\n");
    },
    tickFailure: (id) =>
      [
        `tick を試しました: ${id}`,
        "今回は postcard または遅延返信の送信確認ができませんでした。",
        "状態は保持されています。少し待ってから /elsewhere tick を試してください。",
      ].join("\n"),
    tickReplySuccess: (id) =>
      [
        `即時 reply tick: ${id}`,
        "reply: 保留中の返信を処理しました",
        "trip: 進んでいません",
      ].join("\n"),
    tickReplyFailure: (id) =>
      [
        `reply tick を試しました: ${id}`,
        "今回は遅延返信の送信確認ができませんでした。",
        "状態は保持されています。少し待ってから /elsewhere tick-reply を試してください。",
      ].join("\n"),
    stopNoTrip: "停止できる旅行がありません。",
    stopSuccess: ({ tripId, status }) =>
      [
        `停止しました: ${tripId}`,
        `status: ${status}`,
        "この旅行はもうメッセージを送信しません。",
        "実行時コンテキストはクリアされ、相棒は有効のまま待機状態に戻りました。",
      ].join("\n"),
    tripStartProviderBlocked: [
      "今回の旅行計画は失敗しました。",
      "今回失敗したのは選択中のプロバイダ側の制限であり、行き先の入力ミスではありません。",
      "今は行き先を送り直さなくて大丈夫です。少し待ってから試してください。",
    ].join("\n"),
    tripStartFailed: (message) =>
      [
        "今回の旅行計画は失敗しました。",
        message ? `エラー: ${message}` : "少し待ってからもう一度試してください。",
      ].join("\n"),
    internalFailure:
      "この操作は今は完了できませんでした。少し待ってからもう一度試してください。",
    channelCapabilitySupported: "supported",
    channelCapabilityLimited: "limited",
    channelCapabilityUnsupported: "unsupported",
    channelCapabilityUnknown: "unknown",
  },
  onboarding: {
    gateContinueSetup:
      "初回設定はまだ終わっていません。/elsewhere setup をもう一度実行すれば、前回の続きから案内します。",
    gateContinueModel:
      "初回設定はまだ終わっていません。/elsewhere setup をもう一度実行すれば、モデル設定の続きから案内します。",
    gateFirstTime: [
      "elsewhere へようこそ。",
      "ここでは、あなたと話したり、代わりに遠くを見に行ってくれる相棒を持てます。",
      "まずはあなただけの相棒を作る必要があります。/elsewhere setup を実行すれば、初回設定を順番に案内します。",
    ].join("\n"),
    setupContinueModel: [
      "相棒のプロフィールは作成できました。",
      "次に、旅行計画と画像生成で使うプロバイダを設定する必要があります。",
    ].join("\n"),
    personaCreated: (name) => `${name} を作成しました。`,
    personaUpdated: (name) => `${name} のプロフィールを更新しました。`,
    personaUpdatedReactivateHint: [
      "古いコンテキストの影響を避けるため、次をおすすめします:",
      "/elsewhere deactivate",
      "",
      "そのあと次を実行してください:",
      "/elsewhere activate",
    ].join("\n"),
    modelUpdated: "モデル設定を更新しました。",
    idleGuideHint: [
      "次は行きたい行き先をそのまま伝えてください。",
      "たとえば: 東京 / 北京 / パリ",
      "そうすると相棒が旅行の準備を始めます。",
    ].join("\n"),
    idleDestinationPrompt: (name: string) =>
      `${name} は次の旅の準備ができています。これからは ${name} に行き先の候補をそのまま伝えてください。たとえば: 東京 / 北京 / パリ。そうすると ${name} が今回の旅の準備を始めます。`,
  },
  setup: {
    cancelledCreate: "今回の設定をキャンセルしました。",
    cancelledEdit: "今回の編集をキャンセルしました。",
    readyReplyOne: "準備できたら 1 で返信してください。",
    keepCurrentHint:
      "新しい内容を返信するか、0 で現在の値をそのまま使ってください。",
    personaIntro: [
      "まずは相棒を作りましょう。",
      "",
      "これから次の順で確認します:",
      "1. 名前",
      "2. 住んでいる都市",
      "3. 性格特性",
      "4. 話し方",
      "5. あなたとの関係",
      "6. あなたの呼び方",
      "7. 参考画像",
      "",
      "準備できたら 1 で返信してください。",
    ].join("\n"),
    existingPersonaConfirm: [
      "すでに相棒の設定があります。",
      "",
      "このコマンドで現在のプロフィールを編集または上書きします。",
      "返信:",
      "1. 続けて編集する",
      "2. キャンセル",
    ].join("\n"),
    currentValue: (value) => `現在の値: ${value}`,
    askName: "まずは名前を決めましょう。",
    askOriginCity:
      "今どの都市に住んでいますか？ ここが既定の出発地になります。",
    askTraits: "性格の特徴を一文またはいくつかの言葉で教えてください。",
    askTone: "普段の話し方はどんな感じですか？",
    askRelationship: "あなたとの関係は？",
    askUserAddressing: "あなたをどう呼びますか？",
    traitsExample: "例: 繊細、甘えん坊、重め",
    toneExample: "例: 病み系、甘え系、クール、元気",
    relationshipExample: "例: 遠距離の恋人、曖昧な相手、旅の相棒",
    userAddressingExample: "例: お兄ちゃん、ベイビー、名前、あだ名",
    reviewTitle: "現在の資料：",
    reviewFieldName: "名前",
    reviewFieldOriginCity: "Taが住んでいる都市",
    reviewFieldTraits: "性格特徴",
    reviewFieldTone: "話し方",
    reviewFieldRelationship: "あなたとの関係",
    reviewFieldUserAddressing: "あなたの呼び方",
    reviewConfirmEdit: "1. 確定して参考画像へ進む",
    reviewConfirmCreate: "1. 確定して参考画像へ進む",
    reviewEditName: "2. 名前を修正",
    reviewEditOriginCity: "3. 住んでいる都市を修正",
    reviewEditTraits: "4. 性格特性を修正",
    reviewEditTone: "5. 話し方を修正",
    reviewEditRelationship: "6. 関係を修正",
    reviewEditUserAddressing: "7. あなたの呼び方を修正",
    reviewCancelEdit: "8. 今回の編集をキャンセル",
    reviewCancelCreate: "8. 今回の設定をキャンセル",
    referencePhotoChoiceWithCurrent: [
      "現在すでに参考画像があります。",
      "この画像は後で自撮り生成に使われ、相棒の見た目や雰囲気に強く影響します。",
      "",
      "返信:",
      "1. 新しい参考画像をアップロード",
      "2. 今の参考画像を使う",
      "3. プロフィール確認に戻る",
    ].join("\n"),
    referencePhotoChoiceWithoutCurrent: [
      "最後のステップは参考画像です。",
      "この画像は後で自撮り生成に使われ、相棒の見た目や雰囲気に強く影響します。",
      "顔がはっきり見える単独写真で、自然光・遮蔽物なしの画像がおすすめです。集合写真や強いフィルターはできるだけ避けてください。",
      "",
      "返信:",
      "1. 参考画像をアップロード",
      "2. プロフィール確認に戻る",
    ].join("\n"),
    referencePhotoAwaiting:
      "では画像を 1 枚そのまま送ってください。単独で顔がはっきり見え、遮蔽物がなく自然光の写真がおすすめです。集合写真、強いフィルター、スタンプ画像はできるだけ避けてください。",
    completePersonaCreated: "相棒を作成しました。",
    completePersonaUpdated: "相棒のプロフィールを更新しました。",
    completeModel: "モデル設定が完了しました。",
    completeGeneric: "設定を続けてください。",
    textProviderChoice: (current) =>
      [
        "まず、相棒との会話に使うテキストモデルを選んでください。通常は 1 で十分です。",
        `現在: ${current}`,
        "1. default（現在の OpenClaw デフォルトモデルを使う）",
        "2. gemini",
        "3. openai-compatible",
      ].join("\n"),
    askOpenAiBaseUrl: (current) =>
      [`OpenAI-compatible の base URL を返信してください。`, `現在: ${current}`].join(
        "\n",
      ),
    askOpenAiApiKey:
      "この OpenAI-compatible provider の API key を返信してください。",
    askOpenAiModel: (current) =>
      [`使いたいモデル名を返信してください。`, `現在: ${current}`].join("\n"),
    geminiProviderChoice: (current) =>
      [
        "最後に、旅行計画と画像生成で使うモデル系統を選んでください。",
        `現在: ${current}`,
        "1. gemini",
        "2. openai",
      ].join("\n"),
    planImageChannelChoice: (current, family) =>
      [
        `選択中の系統: ${family}`,
        `現在の通路: ${current}`,
        "1. native（公式 API）",
        "2. openrouter",
      ].join("\n"),
    askGeminiApiKey: [
      "Gemini API key がまだ必要です。",
      "旅行計画と画像生成でこの Google Gemini key を共用します。",
      "取得先: https://aistudio.google.com/app/apikey",
      "そのまま key を送ってください。",
    ].join("\n"),
    askPlanImageOpenAiApiKey: [
      "OpenAI API key がまだ必要です。",
      "旅行計画と画像生成でこの OpenAI key を共用します。",
      "取得先: https://platform.openai.com/api-keys",
      "そのまま key を送ってください。",
    ].join("\n"),
    askOpenRouterApiKey: (family) =>
      [
        "OpenRouter API key がまだ必要です。",
        `旅行計画と画像生成でこの OpenRouter key を共用し、OpenRouter 経由で ${family} 系モデルを使います。`,
        "取得先: https://openrouter.ai/settings/keys",
        "そのまま key を送ってください。",
      ].join("\n"),
    localeSelectionPersisted: (localeLabel) =>
      `${localeLabel} に切り替えました。`,
    errorReplyOne: "準備できたら 1 で返信してください。",
    errorContinueOrCancel: "1 で続行、2 でキャンセルしてください。",
    errorReviewOption: "1-8 のいずれかで返信してください。",
    errorReferencePhotoChoiceWithCurrent:
      "1、2、3 のいずれかで返信してください。",
    errorReferencePhotoChoiceWithoutCurrent:
      "1 または 2 で返信してください。",
    errorModelChoice:
      "1 / 2 / 3 で返信してください。",
    errorGeminiProviderChoice:
      "1 / 2 で返信してください。",
    errorNeedUserAddressing:
      "相棒のあなたへの呼び方がまだ設定されていません。この項目は入力が必要です。",
    errorWaitingForPhoto: "現在の setup ステップは写真待ちではありません。",
    errorWaitingForPhotoWithFallback:
      "今は参考画像を待っています。画像をそのまま送ってください。もしこのプラットフォームで画像送信が不安定なら、公開アクセスできる画像 URL を送ってみてください。",
    errorUnsupportedImage:
      "この画像は今は参考画像として使えません。一般的な画像形式で別の画像を試してください。",
    errorImageDownloadFailed:
      "参考画像の処理に失敗しました。画像をもう一度送るか、アクセス可能な画像 URL を直接送ってください。",
    errorGeneric:
      "このステップは完了できませんでした。もう一度試してください。",
  },
  replyErrors: {
    personaRequired:
      "まだ相棒の設定が終わっていません。まず /elsewhere setup を使ってください。",
    idleDestinationStartFailed:
      "旅行計画に失敗しました。少しあとでもう一度行き先を教えてくれたら、また試します。",
    planningFailed:
      "今回の旅行計画は失敗しました。少し待ってからもう一度試してください。",
    postcardFailed:
      "今回のメッセージは送信確認ができませんでした。少し待ってからもう一度試してください。",
    replyFailed:
      "今回の返信は送信確認ができませんでした。少し待ってからもう一度試してください。",
  },
};
