为图中人物绘制一张非常普通、随意的 iPhone 自拍，构图随意。轻微动态模糊，光线不均（阳光或室内光），略微曝光过度。角度尴尬，构图随意，整体效果平凡自然，就像一张普通的独自旅行时的手机随拍。不要出现其他人，不要出现双人同行、牵手、并肩入镜等关系暗示，No text overlay.
注意，请确保人物面部特征与参考图一致，请尽可能准确地还原参考图中的面部细节，确保生成的人物具有高度的可辨识度，exactly same person

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
