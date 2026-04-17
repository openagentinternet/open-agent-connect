# Ask Master Trace 与可观测性设计说明

**日期：** 2026-04-17

## 1. 文档目标

本文档是基于总纲文档 [2026-04-17-metaweb-ask-master-design.zh-CN.md](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-17-metaweb-ask-master-design.zh-CN.md) 的第五份子模块细化 spec。

本文档只解决这些问题：

- Ask Master 在本地 trace 体系中应如何被表示
- caller / provider 两侧应保留哪些最小可观测信息
- `metabot master trace --id <trace_id>` 应读取什么
- Ask Master trace 如何与普通 private chat、旧 service order / services call 语义分开

本文档**不处理**：

- `master-service` 的发布与发现
- caller 侧 preview / confirmation 的具体实现
- provider runner 的内部业务逻辑
- `simplemsg` / `master_request` / `master_response` schema 细节
- trigger engine 的判断算法
- trace UI 的具体视觉样式

这份 spec 的目标是：

- 给 Ask Master 定一套独立但复用现有基础设施的 trace 语义
- 让 caller / provider / host 都能明确看出“这是一条 Ask Master 流”
- 为后续 `master trace` CLI、trace route、SSE/watch、provider summary 与 e2e 验收提供统一基线

---

## 2. 设计原则

### 2.1 Ask Master 必须有独立 trace 语义

Ask Master 可以复用现有 trace 基础设施，但不能在语义上混成：

- 普通 private chat
- 旧 `services call`
- skill-service 订单闭环

也就是说：

- 存储层可以复用
- route 层可以复用
- artifacts 导出可以复用
- 但 trace 里的产品流标识必须明确是 Ask Master

还需要特别强调：

- `simplemsg` 只是 Ask Master 的 transport
- `master_request / master_response` 只是 Ask Master 的 wire message
- Ask Master trace 关注的是“协作产品流”，不是“simplemsg 的某种聊天类型”

### 2.2 一条 Ask Master 流应是可追踪的

用户或开发者应能通过 trace 看清：

- 是谁发起的
- 问的是哪个 Master
- 何时进入 preview / confirmation
- 何时真正发送
- 何时收到远端响应
- 最终是成功、超时还是失败

### 2.3 同一条逻辑流可以在 caller / provider 两侧各有本地 trace

Ask Master 是跨 MetaWeb 的协作流程，因此：

- caller 侧应保留 caller 本地 trace
- provider 侧应保留 provider 本地 trace

它们可以共享：

- `traceId`
- `requestId`
- `servicePinId`
- `providerGlobalMetaId`

但它们仍然是各自本地环境里的 trace 记录，不需要假装成“一份全局共享 trace 数据库”。

### 2.4 Trace 先服务调试与验收，再服务 UI 装饰

V1 的 trace 目标优先级应是：

1. 让 CLI、日志、测试、排障看得懂
2. 让 host-facing flow 能读取结构化结果
3. 再考虑更丰富的 UI 展示

因此，这份 spec 先定义数据语义，不定义复杂视觉样式。

### 2.5 超时语义必须保持一致

Ask Master trace 必须继承现有语义：

- `timed_out`
  - 表示 caller 本地停止等待
  - 不等于远端 definitively failed

这是 trace 里最容易被误读的点之一，必须写死。

---

## 3. 与现有代码的关系

### 3.1 可直接借鉴的现有骨架

当前仓库中，以下实现可作为后续开发的技术参考：

- `src/core/chat/sessionTrace.ts`
  - 当前 trace record 与 artifacts 路径骨架
- `src/core/a2a/publicStatus.ts`
  - 当前 trace event 到 public status 的映射骨架
- `src/core/a2a/sessionTypes.ts`
  - 当前 session state / task run state 的枚举骨架
- `src/daemon/routes/trace.ts`
  - 当前 trace get/watch/events 路由
- `src/ui/pages/trace/viewModel.ts`
  - 当前 trace inspector 的读法与结果面板骨架

### 3.2 不应直接照搬的部分

以下内容不应继续作为 Ask Master 的默认展示语义：

- “Private Chat”
- “Remote Service Call”
- 订单支付 / 退款 / 评分

这些在数据结构上可共存，但不应成为 Ask Master trace 的主心智。

### 3.3 设计策略

推荐策略是：

- 继续复用 `SessionTraceRecord`
- 在其上增加 Ask Master 专属 metadata
- 继续复用现有 trace route / watch route / artifacts 导出
- 新增 `metabot master trace` 作为 Ask Master 语义入口

---

## 4. Trace 分层模型

Ask Master 的 trace 建议分为三层：

### 4.1 基础存储层

复用现有：

- trace json
- trace markdown
- transcript markdown

### 4.2 运行态层

复用或扩展现有：

- session state
- task run state
- public status
- latest event

### 4.3 产品语义层

新增 Ask Master 专属 metadata，例如：

- `flow = master`
- `transport = simplemsg`
- `canonicalStatus`
- `triggerMode`
- `contextMode`
- `confirmationMode`
- `requestId`
- `masterKind`
- `servicePinId`
- `providerGlobalMetaId`

关键点是：

- 底层 trace record 仍统一
- Ask Master 通过 metadata 拿到自己的产品语义层

---

## 5. Trace Record 设计

### 5.1 V1 建议最小扩展

在现有 `SessionTraceRecord` 基础上，建议增加一段 Ask Master metadata：

```json
{
  "traceId": "trace-master-01",
  "channel": "a2a",
  "session": {
    "id": "session-trace-master-01",
    "title": "Official Debug Master Ask",
    "type": "a2a",
    "peerGlobalMetaId": "idq1provider..."
  },
  "a2a": {
    "role": "caller",
    "publicStatus": "awaiting_confirmation",
    "latestEvent": "master_preview_ready",
    "callerGlobalMetaId": "idq1caller...",
    "providerGlobalMetaId": "idq1provider...",
    "servicePinId": "abcd1234...i0"
  },
  "askMaster": {
    "flow": "master",
    "transport": "simplemsg",
    "canonicalStatus": "awaiting_confirmation",
    "triggerMode": "manual",
    "contextMode": "standard",
    "confirmationMode": "always",
    "requestId": "master-req-01",
    "masterKind": "debug",
    "servicePinId": "abcd1234...i0",
    "providerGlobalMetaId": "idq1provider..."
  }
}
```

其中需要写死一个约束：

- `askMaster.canonicalStatus` 是 Ask Master trace 的唯一规范状态字段

任何一侧都不应再另外发明：

- 第二个 canonical status 字段
- 以 display text 代替 canonical status
- 以 transcript sender 或 transport 类型代替 canonical status

### 5.2 为什么不单独新建 Trace Schema

V1 不建议为了 Ask Master 再发明一套全新 trace schema。

原因：

- route / watch / artifacts / inspector 都已有骨架
- 只要产品语义层清楚，复用基础设施收益更大

因此更稳的路径是：

- 复用现有 trace record
- 追加 Ask Master metadata

### 5.3 `channel` 与 `transport`

建议：

- `channel`
  - 继续使用现有 `a2a`
- `askMaster.transport`
  - 显式写为 `simplemsg`

这样可同时表达：

- 这是 A2A 形态的协作流
- 实际 transport 是 `simplemsg`

### 5.4 Source Of Truth 与派生展示

为避免 caller/provider/host 三侧各自发明不同映射，V1 建议明确：

- `a2a.latestEvent`
  - 保存 raw event
- `askMaster.canonicalStatus`
  - 保存 Ask Master 唯一规范状态
- display text / CLI 文案 / markdown 文案
  - 只能在读取层派生，不应反向写回当 source of truth
- transcript sender / `session.title` / `askMaster.transport`
  - 只属于辅助展示或 transport 元信息，不能承担状态语义

也就是说：

- trace record 里不应把展示文案当主状态字段
- `latestEvent` 和 `canonicalStatus` 的职责必须分开
- `canonicalStatus` 的真值来源只能是 `askMaster.canonicalStatus`

### 5.5 `session.title`

`session.title` 只属于便于 host-facing 识别的辅助显示字段，不是 Ask Master 语义层的 source of truth。

如果需要默认命名，建议采用：

- `<displayName> Ask`
- 例如：
  - `Official Debug Master Ask`

而不建议继续落成：

- `Private Chat`
- `<serviceName> Call`

---

## 6. Caller 侧 Trace 语义

### 6.1 Caller 最小可观测阶段

caller 侧至少应保留这些阶段：

- preview 已生成
- 正在等待确认
- 已正式发送
- 已收到结构化响应
- 已完成
- 已超时
- 已失败

### 6.2 Caller 建议状态

V1 规范上建议的 Ask Master caller 状态是：

- `discovered`
- `suggested`
- `awaiting_confirmation`
- `requesting_remote`
- `remote_received`
- `master_responded`
- `completed`
- `timed_out`
- `failed`

### 6.3 与现有底层状态的兼容

当前基础设施中已有：

- `requesting_remote`
- `remote_received`
- `completed`
- `timeout`
- `remote_failed`

因此 V1 建议采用“双层表达”：

- 底层兼容层
  - 可继续保留 `timeout` / `remote_failed` 等已有 event/status
- Ask Master 规范层
  - 对外统一展示为：
    - `timed_out`
    - `failed`

也就是说：

- `latestEvent` 可以保留现有兼容值
- Ask Master 视图层可以做规范化映射

### 6.4 Preview 阶段的 trace

一旦 preview 生成成功，就应写入 trace。

至少包括：

- `traceId`
- `requestId`
- 目标 Master 信息
- preview 摘要
- 发送前安全边界说明
- 当前状态 `awaiting_confirmation`

这能保证：

- preview 阶段不是“一次无记录的临时内存操作”
- 后续 `--confirm` 与 `master trace --id` 都有稳定依据

### 6.5 Confirm 后的 trace 推进

正式发送后，caller 侧 trace 至少应推进：

1. `awaiting_confirmation`
2. `requesting_remote`
3. `completed` / `timed_out` / `failed`

如果 transport 或 provider 侧信号足够可靠，也可加入：

- `remote_received`
- `master_responded`

但这不是 V1 最小闭环的硬依赖。

---

## 7. Provider 侧 Trace 语义

### 7.1 Provider 本地 trace 的必要性

provider 侧应保留本地 trace，原因包括：

- 调试 fixture 行为
- 证明确实收到了请求
- 查看 provider 处理成功/失败/缺上下文
- 支持 provider summary / console / trace inspection

### 7.2 Provider 建议状态

provider 侧建议至少映射这些状态：

- `provider_received`
- `provider_completed`
- `provider_failed`
- `clarification_needed`

在 Ask Master 视图层可进一步解释为：

- `remote_received`
- `completed`
- `failed`
- `need_more_context`

### 7.3 Provider 侧单次生命周期

provider trace 必须只绑定一次 `master_request` 的处理生命周期。

不要把 provider trace 误设计成：

- 长期 Debug Master 会话窗口
- 长期上下文容器
- 开放式多轮聊天记录

### 7.4 Provider 与 caller 的关联键

为便于两侧排障，provider trace 至少应保留：

- `traceId`
- `requestId`
- `callerGlobalMetaId`
- `providerGlobalMetaId`
- `servicePinId`
- `masterKind`

---

## 8. Event / Status / Display 三层映射

V1 建议明确区分三层：

### 8.1 原始事件层

例如：

- `master_preview_ready`
- `request_sent`
- `provider_received`
- `provider_completed`
- `provider_failed`
- `timeout`

### 8.2 规范状态层

例如：

- `awaiting_confirmation`
- `requesting_remote`
- `remote_received`
- `master_responded`
- `completed`
- `timed_out`
- `failed`

### 8.3 展示文案层

例如：

- `Preview ready`
- `Waiting for your confirmation`
- `Ask Master request sent`
- `Master has responded`
- `Stopped waiting locally`
- `Provider processing failed`

### 8.4 为什么要三层分离

如果不分层，后续会出现这些混乱：

- 内部 event 名直接暴露给用户
- 不同 transport/adapter 的 raw event 无法兼容
- UI / CLI / trace inspector 的文案不一致

因此建议：

- raw event 保持工程兼容性
- canonical status 作为产品语义
- display text 作为 host-facing 文案

### 8.5 映射职责归属

V1 建议把三层映射职责固定如下：

- runtime / trace writer
  - 负责写入 `a2a.latestEvent`
  - 负责写入 `askMaster.canonicalStatus`
- CLI / trace inspector / host adapter
  - 负责把 `canonicalStatus` 映射成 display text
- 任何展示层
  - 都不应自定义一份与 runtime 不一致的 canonical mapping

也就是说，最终一致性约束是：

- raw event 以 `a2a.latestEvent` 为准
- Ask Master 规范状态以 `askMaster.canonicalStatus` 为准
- 展示文案永远是派生层，不是存储层
- transcript sender / transport / title 永远不是状态判定来源

---

## 9. Trace Artifact 设计

### 9.1 继续复用现有 artifacts

V1 建议继续导出：

- trace json
- trace markdown
- transcript markdown

### 9.2 Ask Master trace json 最小要求

至少应包含：

- 基础 trace 字段
- Ask Master metadata
- preview 摘要
- request/response 摘要
- timeout / failure 信息
- artifacts 路径

### 9.3 Ask Master trace markdown 最小要求

trace markdown 只是从 source-of-truth trace record 派生出的导出物。

V1 至少应可读出：

- 目标 Master
- trigger mode / context mode / confirmation mode
- 当前状态
- preview 摘要
- 请求是否已发送
- 响应摘要
- timeout / failure 说明

### 9.4 Transcript markdown 的 sender 语义

Ask Master transcript 中建议稳定使用：

- `user`
- `assistant`
- `provider`
- `system`

其中：

- caller preview 阶段的说明可落为 `assistant` 或 `system`
- 远端 `master_response` 可落为 `provider`

关键是不要把 provider 返回结果伪装成 caller 自己的普通聊天气泡。

---

## 10. `metabot master trace` 契约

### 10.1 命令定位

`metabot master trace --id <trace_id>` 应是 Ask Master 的一等读取入口。

它的职责是：

- 读取现有 trace 数据
- 用 Ask Master 语义做解读
- 向用户返回当前阶段、摘要与关键标识

### 10.2 最小返回内容

V1 下，建议至少返回：

- `traceId`
- `flow = master`
- `role = caller | provider`
- `displayName`
- `masterKind`
- `providerGlobalMetaId`
- `servicePinId`
- `requestId`
- `canonicalStatus`
- `latestEvent`
- `preview`
- `response`
- `failure`
- artifacts 路径

### 10.3 与现有 trace route 的关系

底层仍可继续复用：

- `GET /api/trace/:id`
- `GET /api/trace/:id/watch`
- `GET /api/trace/:id/events`

也就是说：

- `master trace` 是 CLI 入口
- route 层不需要为 Ask Master 再单独造一套 transport

### 10.4 watch / SSE 语义

如果后续要做 host 侧实时更新，Ask Master 也应复用现有 watch/SSE 骨架。

V1 的最小要求是：

- watch 到状态推进
- watch 到最终 `completed` / `timed_out` / `failed`

但 watch 输出中的 source-of-truth 仍应是：

- raw event
- canonical status

而不是直接推送一堆未约束的展示文案。

---

## 11. 与其他产品流的区分规则

### 11.1 与 private chat 的区分

即使底层 transport 是 `simplemsg`，Ask Master trace 也不应显示成：

- `Private Chat`
- `trace-private-*`

只要这是 Ask Master 流，就必须有：

- `askMaster.flow = master`
- `askMaster.canonicalStatus`
- Ask Master 语义的 `session.title`
- Ask Master 专属 `status`

并且需要明确：

- `simplemsg` 只说明网络传输方式
- 它不能定义 Ask Master 的产品类别
- transcript sender 也不能把 Ask Master 降级成“某种私聊消息类型”

### 11.2 与 services call 的区分

Ask Master trace 不应继续依赖这些语义：

- order payment
- order delivery
- buyer / seller rating
- service call success/failure 文案

即使底层复用 A2A / trace 框架，也要把产品流分开。

### 11.3 与 provider summary 的区分

provider summary / console 看到 Ask Master 请求时，应把它看作：

- provider 本地的协作请求处理记录

而不是：

- skill-service paid order
- refund / rating / manual refund work item

---

## 12. V1 状态建议表

### 12.1 Caller 侧

| Ask Master 规范状态 | 典型 raw event / 底层状态 | 说明 |
| --- | --- | --- |
| `awaiting_confirmation` | `master_preview_ready` | preview 已生成，等待用户确认 |
| `requesting_remote` | `request_sent` | 已通过 `simplemsg` 正式发出 |
| `remote_received` | `provider_received` | 已知 provider 收到请求 |
| `master_responded` | `provider_completed` + response validated | 已收到并校验合法结构化响应 |
| `completed` | `provider_completed` | Ask Master 流已完成 |
| `timed_out` | `timeout` | caller 本地停止等待 |
| `failed` | `provider_failed` / local validation failure | 本地或远端失败 |

### 12.2 Provider 侧

| Provider trace 状态 | 典型 raw event | 说明 |
| --- | --- | --- |
| `remote_received` | `provider_received` | 已收到合法请求 |
| `completed` | `provider_completed` | 已生成结构化响应 |
| `need_more_context` | `clarification_needed` | 当前请求上下文不足 |
| `failed` | `provider_failed` | provider 处理失败 |

---

## 13. 测试与 TDD 要求

后续实现这份 spec 时，至少应覆盖：

- Ask Master trace record 包含 `askMaster.flow = master`
- Ask Master trace 不显示为 `Private Chat`
- Ask Master trace 不复用 order payment / refund / rating 语义
- caller preview 阶段就能生成稳定 trace
- `master trace --id` 能读出 Ask Master metadata
- provider trace 能保留 requestId / servicePinId / masterKind
- `timed_out` 仍解释为 caller 本地停止等待
- raw event 到 Ask Master 规范状态的映射正确
- trace watch 能看到 Ask Master 状态推进
- host-facing trace 结果能读到结构化响应摘要

推荐测试分层：

- 单元测试
  - trace metadata builder
  - raw event -> canonical status mapper
  - Ask Master trace view model
- 集成测试
  - caller trace 生命周期
  - provider trace 生命周期
  - trace route / watch route
- e2e 测试
  - official debug master happy path 的 trace 可读性
  - timeout 场景的 trace 可读性

---

## 14. V1 范围与非目标

### 14.1 V1 范围

V1 应做到：

- Ask Master 使用独立 trace metadata
- caller / provider 两侧可分别看到本地 trace
- `metabot master trace --id` 可读
- 复用现有 trace route / artifacts / watch 机制
- 能与 private chat / services call 明确区分

### 14.2 V1 非目标

V1 不做：

- 全新 trace 存储系统
- 专门为 Ask Master 再造一套 trace route 家族
- 复杂图形化分析台
- 长期开放协作会话的全量时序回放

---

## 15. 一句话总结

这一层的正确形态是：

> Ask Master 应在现有 trace 基础设施之上拥有清晰独立的产品语义层；用户看到的必须是一条“向 Master 求助”的协作流，而不是一段 private chat，或一笔旧式 service order。
