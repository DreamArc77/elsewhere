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
      "/elsewhere bind",
      "/elsewhere activate",
      "/elsewhere deactivate",
      "/elsewhere setup                      # 今の相棒を編集",
      "/elsewhere create                     # 新しい相棒を作成",
      "/elsewhere model                      # テキストモデル / Gemini key を再設定",
      "/elsewhere start --to Tokyo [--from Hong-Kong] [--when next-week]",
      "/elsewhere status [--trip <id>]",
      "/elsewhere tick [--trip <id>]         # 遅延返信と次の旅行ステップを即時実行",
      "/elsewhere tick-reply                 # 遅延返信だけ即時実行",
      "/elsewhere stop [--trip <id>]",
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
      "Gemini 側の provider 制限で失敗しており、行き先の入力ミスではありません。",
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
      "相棒のプロフィールはまだ未完成です。/elsewhere setup を続けて、案内どおりに返信してください。",
    gateContinueModel:
      "モデル設定はまだ未完成です。/elsewhere model を続けて、案内どおりに返信してください。",
    gateFirstTime: [
      "elsewhere へようこそ。",
      "ここでは、あなたと話したり、代わりに遠くを見に行ってくれる相棒を持てます。",
      "まずは相棒を設定しましょう。",
      "",
      "/elsewhere setup で相棒のプロフィールを整えてください。",
      "そのあと /elsewhere model でテキストモデルと planning / 画像設定を終えてください。",
    ].join("\n"),
    gateMissingPersona: "相棒のプロフィール",
    gateMissingModel: "テキストモデル設定",
    gateMissingGemini: "planning / 画像チャンネル設定",
    gateMissingSummary: (items) => `不足している項目: ${items.join("、")}`,
    gatePersonaFirstSetup:
      "まず /elsewhere setup を実行すると、順番に相棒のプロフィールを設定できます。",
    gatePersonaFirstModel:
      "相棒のプロフィールが終わったら、/elsewhere model でテキストモデルと planning / 画像設定をしてください。",
    gateModelOnlyIntro: "相棒のプロフィールはすでにあります。",
    gateModelOnlyAction:
      "次は /elsewhere model を実行して、テキストモデルと planning / 画像設定をしてください。",
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
      "次は相棒に行きたい行き先をそのまま伝えてください。",
      "たとえば: 東京 / 北京 / パリ",
      "相棒が旅行の準備を始めます。",
    ].join("\n"),
  },
  setup: {
    cancelledCreate: "今回の設定をキャンセルしました。",
    cancelledEdit: "今回の編集をキャンセルしました。",
    readyReplyOne: "準備できたら 1 で返信してください。",
    keepCurrentHint:
      "新しい内容を返信するか、0 で現在の値をそのまま使ってください。",
    personaIntro: [
      "まずは相棒を設定しましょう。",
      "",
      "次の順で確認します:",
      "1. 名前",
      "2. 相棒が住んでいる都市",
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
    askName: "まずは相棒の名前を決めましょう。",
    askOriginCity:
      "相棒は今どの都市に住んでいますか？ ここが既定の出発地になります。",
    askTraits: "相棒の性格をいくつかの言葉で教えてください。",
    askTone: "相棒の普段の話し方はどんな感じですか？",
    askRelationship: "相棒とあなたの関係は？",
    askUserAddressing: "相棒はあなたをどう呼びますか？",
    traitsExample: "例: 繊細、甘えん坊、重め",
    toneExample: "例: 病み系、甘え系、クール、元気",
    relationshipExample: "例: 遠距離の恋人、曖昧な相手、旅の相棒",
    userAddressingExample: "例: お兄ちゃん、ベイビー、名前、あだ名",
    reviewTitle: "現在の資料：",
    reviewFieldName: "名前",
    reviewFieldOriginCity: "住んでいる都市",
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
      "顔がはっきり見える単独写真で、自然光・遮蔽物なしの画像がおすすめです。",
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
        "テキストモデルをどう設定しますか？ 番号で返信してください。",
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
        "planning と画像生成で使う Gemini チャンネルを選んでください。",
        `現在: ${current}`,
        "1. google-direct（Gemini API key / AI Studio）",
        "2. openrouter（OpenRouter key で Gemini を使う）",
      ].join("\n"),
    askGeminiApiKey: [
      "Gemini API key がまだ必要です。",
      "planning と画像生成でこの Google Gemini key を共用します。",
      "取得先: https://aistudio.google.com/app/apikey",
      "そのまま key を送ってください。",
    ].join("\n"),
    askOpenRouterApiKey: [
      "OpenRouter API key がまだ必要です。",
      "planning と画像生成でこの OpenRouter key を共用し、OpenRouter 経由で Gemini を使います。",
      "取得先: https://openrouter.ai/settings/keys",
      "そのまま key を送ってください。",
    ].join("\n"),
    localeSelectionPersisted: (localeLabel) =>
      `システム言語を ${localeLabel} に設定しました。`,
    errorReplyOne: "準備できたら 1 で返信してください。",
    errorContinueOrCancel: "1 で続行、2 でキャンセルしてください。",
    errorReviewOption: "1-8 のいずれかで返信してください。",
    errorReferencePhotoChoiceWithCurrent:
      "1、2、3 のいずれかで返信してください。",
    errorReferencePhotoChoiceWithoutCurrent:
      "1 または 2 で返信してください。",
    errorModelChoice:
      "そのモデル選択は理解できませんでした。1 / 2 / 3、または default / gemini / openai-compatible で返信してください。",
    errorGeminiProviderChoice:
      "その planning / 画像チャンネル選択は理解できませんでした。1 / 2、または google-direct / openrouter で返信してください。",
    errorNeedUserAddressing:
      "相棒のあなたへの呼び方がまだ設定されていません。この項目は入力が必要です。",
    errorWaitingForPhoto: "現在の setup ステップは写真待ちではありません。",
    errorWaitingForPhotoWithFallback:
      "今は参考画像を待っています。画像をそのまま送ってください。もしこのプラットフォームで画像送信が不安定なら、画像 URL を送るか、`/elsewhere setup --image 画像URL` を送ってください。",
    errorUnsupportedImage:
      "この画像は今は参考画像として使えません。一般的な画像形式で別の画像を試してください。",
    errorImageDownloadFailed:
      "参考画像の処理に失敗しました。画像をもう一度送るか、アクセス可能な画像 URL を直接送ってください。",
    errorGeneric:
      "このステップは完了できませんでした。もう一度試してください。",
  },
  replyErrors: {
    personaRequired:
      "まだ出発の準備ができていません。まず /elsewhere setup で私の人格を設定してくれたら、ちゃんと返事できるようになります。",
    idleDestinationStartFailed:
      "今その行き先で旅行を始めようとしたけど、こちらで詰まってしまいました。少しあとでもう一度行き先を教えてくれたら、また試します。",
    planningFailed:
      "今回の旅行計画は失敗しました。少し待ってからもう一度試してください。",
    postcardFailed:
      "今回の postcard は送信確認ができませんでした。少し待ってからもう一度試してください。",
    replyFailed:
      "今回の返信は送信確認ができませんでした。少し待ってからもう一度試してください。",
  },
};
