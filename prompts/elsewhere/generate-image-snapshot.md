绘制一张非常普通、随意的 iPhone 旅行随拍。

没有主体人物，不是自拍，也不是人物肖像。
不要出现双人同行、面对面、牵手、并肩入镜等关系暗示。

以场景、街景、桌面、店内陈设、食物、物件或环境细节为主。
允许环境里存在不构成主体的模糊人流，但不能有明确主角。

构图随意，带轻微动态模糊，光线不均，略微曝光过度，角度普通，整体效果平凡自然。
不要做成海报、拼贴、广告或梦幻特效图。No text overlay.

参考信息：

时间：{{currentTime}}
天气：{{weatherSummary}}
地点：{{promptLocation}}
行为：{{promptBehavior}}

生图后同时输出该图片的提要信息，按 json 格式输出：
{
  "scene": "...",
  "otherPeopleVisible": "none|blurred_background_only|clear_people_present",
  "notableDetails": ["...", "..."]
}
