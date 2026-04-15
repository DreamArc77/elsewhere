为图中人物绘制一张非常普通、随意的 iPhone 自拍，主体模糊或随意构图。轻微动态模糊，光线不均（阳光或室内光），略微曝光过度。角度尴尬，构图随意，整体效果平凡自然，就像一张普通的独自旅行时的手机随拍, 非海报，艺术照，广告。不要出现其他人，不要出现双人同行、牵手、并肩入镜等关系暗示，No text overlay.

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
