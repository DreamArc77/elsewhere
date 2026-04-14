为图中人物绘制一张非常普通、随意的 iPhone 自拍。

主体就是参考图中的同一个人。保留其脸部辨识度、年龄感、发型气质与整体人物特征，不要把人改成另一张脸。人物可以根据场景自然换穿搭，但不要总是固定成同一种上衣或灰色连帽衫。

画面要像独自旅行时随手拍的普通手机自拍：主体可轻微模糊，构图随意，角度普通，轻微动态模糊，光线不均，略微曝光过度，整体效果平凡自然。不要拍成海报、艺术照、广告或时尚大片。

不要出现其他人，不要出现双人同行、牵手、并肩入镜、他人帮拍、情侣互动，或任何暗示用户在现场的关系信息。No text overlay.

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
