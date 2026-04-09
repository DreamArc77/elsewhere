# OpenClaw 旅行伴侣 MVP《测试开发设计文档》

## 1. 目标
- 用最小可验证版本验证“活人感旅行伴侣”是否成立。
- 所有功能开发以前，先定义日志、状态机、契约和自动化覆盖边界。
- 默认以离线测试为主，在线烟测为辅，避免让外部 API 稳定性绑架主开发节奏。

## 2. MVP 边界
- 支持用户配置结构化人格：姓名、性格、关系、语气风格、1 张参考图。
- 支持用户指定出发城市与目的地城市。
- 通过 Gemini + Google Search 生成 3-5 日单城市旅行计划，返回严格 JSON。
- 旅行状态机固定阶段：`planning`、`packing`、`departing`、`in_transit`、`arrival_checkin`、`day_exploration`、`returning`、`home_reflection`。
- 仅在以下阶段发送明信片：`planning`、`departing`、`arrival_checkin`、每个 `day_exploration`、`returning`、`home_reflection`。
- 持久化只用 JSON 文件，不接数据库。
- 宿主只假设已具备“定时触发”和“主动发消息”能力。

## 3. 先测什么

### 3.1 领域状态机
- 测试目标：阶段推进正确、静默阶段不发消息、旅行最终完成、重复 tick 幂等。
- 测试方法：
  - 直接对状态机构造 `TripPlan`，验证时间线展开是否包含固定阶段顺序。
  - 验证 `day_exploration` 会按 `TripPlan.days` 重复展开。
  - 验证每一步推进后 `currentPhase`、`currentDay`、`nextRunAt`、`status` 更新正确。
  - 重复执行同一阶段时，如果存在 `pendingDispatch`，不得重复生成新明信片。
- 通过标准：
  - 3-5 日计划均能走完。
  - `packing` 与 `in_transit` 不会产出消息。
  - 最后一阶段后状态进入 `completed`。

### 3.2 JSON 契约
- 测试目标：Gemini itinerary JSON、phase grounding JSON、image generation 结果都能被严格解析。
- 测试方法：
  - 用 schema 对合法 fixture 进行 parse，必须通过。
  - 对缺字段、错误类型、非 JSON 文本进行 parse，必须报错并带可定位原因。
  - 验证 prompt 构造要求返回严格 JSON，并且 REST payload 包含 `responseMimeType=application/json`。
- 通过标准：
  - 失败时能产出结构化错误。
  - 契约错误不会污染业务状态。

### 3.3 调度与重启恢复
- 测试目标：时间驱动推进可靠，进程重启后继续跑，不会跳步或重复发消息。
- 测试方法：
  - 用假时钟驱动 `runDueTrips`，验证未到时间不执行，到时间才执行。
  - 创建 trip 后重建 service 实例，从 JSON 恢复并继续推进。
  - 模拟“已生成待发送明信片但进程崩溃”与“消息已发但状态未推进”两种中断。
- 通过标准：
  - 恢复后仍只发送 1 次对应 dedupe key 的消息。
  - `nextRunAt` 始终向前推进，不回退。

### 3.4 日志与可观测性
- 测试目标：日志比业务更早具备调试价值。
- 测试方法：
  - 验证创建 trip、生成计划、生成 grounding、生成图片、发送消息、推进状态、异常处理都会写日志。
  - 验证日志行包含最小必填字段：`tripId`、`runId`、`phase`、`event`、`decision`、`startedAt`、`finishedAt`、`status`。
  - 验证失败路径存在 `errorCode`，且同一条链路能靠 `runId` 串起来。
- 通过标准：
  - 任意失败用例都能仅靠 JSONL 定位到出错阶段与外部依赖。

### 3.5 端到端集成
- 测试目标：在全 mock/fixture 环境里完整跑通一次旅行。
- 测试方法：
  - 用固定东京或纽约 fixture，模拟 itinerary、grounding、caption、image generation、消息发送。
  - 从 `createPersona` -> `startTrip` -> 多次 `runDueTrips` 跑完整个流程。
  - 断言产出明信片数量、artifact 数量、最终状态、日志条数和调度调用次数。
- 通过标准：
  - 一次 3 日旅行会产生 `planning + departing + arrival_checkin + 3*day_exploration + returning + home_reflection` 共 8 条消息。
  - 每条消息都能追溯到 grounding artifact 与 image artifact。

## 4. 怎么测
- 测试框架：Vitest。
- 合同校验：Zod schema。
- 文件系统隔离：每个测试用 `mkdtemp` 创建临时 `runtime-data` 目录。
- 外部依赖替身：
  - `FakeClock`
  - `FakeScheduler`
  - `FakeMessenger`，带 dedupe key 记忆
  - `FakeGroundingPort`
  - `FakeImageGenerationPort`
- fixture 组织：
  - 东京 3 日 itinerary fixture
  - 每个阶段的 grounding fixture
  - 生图返回固定 PNG base64 fixture

## 5. 自动化覆盖方案
- `npm test`：
  - 全部离线单测、集成测、日志测、契约测
  - 不访问网络
- `npm run test:live`：
  - 仅在 `RUN_LIVE_GEMINI_SMOKE=1` 且配置 `GEMINI_API_KEY` 时运行
  - 最小成本验证一次 itinerary 生成和一次图片生成
- CI 规则：
  - 默认只跑 `npm test`
  - 在线烟测不作为阻塞项，但失败必须报警

## 6. 异常场景矩阵
- Gemini itinerary 返回非 JSON
- Gemini itinerary JSON 缺字段
- phase grounding 信息不足
- 图片生成失败
- 消息发送失败
- 进程在保存待发送明信片后崩溃
- 进程在消息发送成功后、状态推进前崩溃
- 同一个 tick 被重复执行

## 7. 完成定义
- 代码实现完成前，以上 5 类测试全部存在。
- `npm test` 全绿。
- `npm run build` 通过。
- skill 元数据与运行时导出齐全，宿主只需补端口适配即可接入。
