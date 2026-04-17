# Caller 侧 Master Ask 调用流设计说明

**日期：** 2026-04-17

## 1. 文档目标

本文档是基于总纲文档 [2026-04-17-metaweb-ask-master-design.zh-CN.md](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-17-metaweb-ask-master-design.zh-CN.md) 的第三份子模块细化 spec。

本文档只解决 caller 侧的这几个问题：

- `metabot master ask` 应如何组织成本地可执行的两阶段调用流
- caller runtime 如何把本地输入 draft 变成线上 `master_request`
- preview / confirmation contract 应如何定义
- caller 侧如何把 Ask Master 过程映射为本地 trace 与 host-facing 输出

本文档**不处理**：

- `master-service` 的发布与发现细节
- `simplemsg` 下 `master_request / master_response` 的消息 schema 细节
- provider 侧 Master runtime 的具体实现
- 自动/半自动 trigger engine 的完整算法
- trace UI 详情页的视觉实现

这份 spec 的目标是：

- 给 `metabot master ask` 提供稳定的 caller 侧运行模型
- 明确手动与建议式 Ask Master 的用户体验边界
- 把 preview / confirmation、context 打包、trace 投影放在同一层讲清楚
- 为后续 CLI、skill wrapper、runtime handler、测试实现提供边界清晰的落地基线

---

## 2. 设计原则

### 2.1 这是 caller 侧编排层，不是 transport 层

这一层负责：

- 接收本地 Ask Master 请求
- 选择或解析目标 Master
- 组装本次发送内容
- 做 preview / confirmation
- 发出请求并等待响应
- 把结果回注当前 host 会话与 trace

这一层不负责重新定义网络协议。

也就是说：

- publish / discovery 属于 `master-service`
- 线上消息结构属于 `master_request / master_response`
- 实际网络传输属于 `simplemsg`
- caller flow 负责把这几层串起来

### 2.2 CLI 先行，skill 只是封装器

caller 侧的一等入口应是：

```bash
metabot master ask
metabot master trace --id <trace_id>
```

后续 skill 可以把自然语言包装成 Ask Master 流程，但 skill 不应：

- 绕开本地 runtime 自己拼 transport
- 直接退化成 private chat
- 直接走 `services call`

### 2.3 V1 优先支持 `manual` 与 `suggest`

V1 caller flow 重点先放在：

- `manual`
  - 用户明确要求“去问某个 Master”
- `suggest`
  - 本地 runtime 或 skill 提示“现在值得问 Master”

`auto` 需要在架构上留口，但不应成为本阶段 caller flow 的强制落地内容。

### 2.4 V1 必须先经过 preview / confirmation

V1 下，Ask Master 必须先形成一个可见 preview，再决定是否发送。

原因：

- 用户需要知道到底要问谁
- 用户需要看到实际会发出的上下文
- 用户需要知道没有隐式上传整个 repo 或敏感文件

因此：

- 第一步是生成 preview
- 第二步才是正式发送

### 2.5 不隐式扩大上下文边界

caller flow 可以比旧 MVP 更接近 advisor-tool，但不能在 V1 中隐式扩大到“默认把整个本地环境发出去”。

caller flow 必须坚持：

- 发送内容由 runtime 明确打包
- preview 中能看到上下文范围
- `.env`、credentials、keys、wallet secrets、无关文件默认不发送

### 2.6 Trace 是一等产物

Ask Master 不应只是一次“请求发没发成功”的 CLI 调用。

它必须在 caller 侧留下：

- 稳定 `traceId`
- 状态推进
- preview / send / response 的痕迹
- 面向 host 的结果投影

---

## 3. 与现有代码的关系

### 3.1 可直接借鉴的现有骨架

当前仓库中，以下实现可作为后续开发的技术参考：

- `src/cli/commands/services.ts`
  - 现有 payload-file 风格 CLI 入口组织方式
- `src/core/delegation/remoteCall.ts`
  - 可借鉴 traceId 生成与 confirmation policy 骨架
- `src/core/a2a/sessionTypes.ts`
  - 已有 `awaiting_confirmation`、`requesting_remote`、`completed` 等状态名
- `src/core/a2a/publicStatus.ts`
  - 已有 trace 事件到 public status 的投影骨架
- `src/daemon/routes/trace.ts`
  - 已有 trace route / watch route，可继续复用
- `src/daemon/defaultHandlers.ts`
  - 已有远端调用、等待回复、persist trace、导出 artifacts 的主骨架

### 3.2 不应直接照搬的部分

以下内容不应直接沿用成 Ask Master caller flow：

- `services call` 的产品语义
- 普通私聊 `chat.private` 的产品语义
- skill-service 的支付与订单闭环
- 原 `advisor` 命名与 `services call` 路线

Ask Master 可以借这些技术经验，但不能退回这些旧入口。

### 3.3 设计策略

推荐策略是：

- 借现有 CLI / trace / session / waiter / confirmation 骨架
- 新建 `master ask` 自己的 caller orchestration
- 用 `master-service` + `master_request` + `simplemsg` + Ask Master trace 语义拼出独立产品路径

---

## 4. Caller 侧模块划分

caller flow 建议由以下子模块组成：

### 4.1 Config Gate

负责读取并执行本地策略门控，例如：

- `askMaster.enabled`
- `askMaster.triggerMode`
- `askMaster.confirmationMode`
- `askMaster.contextMode`
- `askMaster.trustedMasters`

注意：

- 本文档只定义 caller flow 如何消费这些配置
- 不定义这些配置最终存在哪里

### 4.2 Target Resolver

负责根据本地输入 draft 解析目标 Master。

可能输入包括：

- 显式 `servicePinId + providerGlobalMetaId`
- `masterKind`
- `displayName`
- `official / trusted`
- host mode 限制

### 4.3 Context Packager

负责把 caller 允许发送的上下文整理成可序列化结构。

这一层只做：

- 打包
- 裁剪
- allowlist 约束
- preview 展示需要的摘要

它不定义底层 `master_request` schema 细节，也不等同于自动采集引擎本身。

### 4.4 Preview Builder

负责生成发送前预览。

preview 必须是 machine-first、可审阅、可确认的本地产物。

### 4.5 Pending Ask Store

为了支持“两阶段确认”，caller 侧需要本地保存一个待发送 Ask Master 记录。

它至少应保存：

- `traceId`
- `requestId`
- 解析后的目标 Master
- 已裁剪后的上下文
- 将要发送的最终 `master_request` JSON snapshot
- 当前确认状态

### 4.6 Dispatch Executor

在收到确认后：

- 读取 pending ask
- 发送 `simplemsg`
- 进入等待流程
- 更新 trace

### 4.7 Response Integrator

负责：

- 读取并匹配 `master_response`
- 做严格校验
- 把结构化结果回写本地 trace 与 host-facing 输出

### 4.8 Trace Projector

负责把整个 caller flow 投影成：

- trace 状态
- transcript / markdown / json artifacts
- `metabot master trace` 可读结果

---

## 5. 本地输入模型：`master ask draft`

### 5.1 为什么需要本地 draft

caller 侧输入不应直接要求用户手写完整线上 `master_request`。

原因：

- 线上 `master_request` 需要 runtime 自动补全字段
- `requestId` / `traceId` / `host` / `sentAt` 等应由本地生成
- preview 需要基于“最终即将发送的内容”而不是原始草稿

因此 caller flow 应区分：

- 本地输入 draft
- 最终线上 `master_request`

### 5.2 V1 建议最小 draft

V1 可支持如下本地输入草稿：

```json
{
  "target": {
    "servicePinId": "abcd1234...i0",
    "providerGlobalMetaId": "idq1provider...",
    "masterKind": "debug",
    "displayName": "Official Debug Master"
  },
  "triggerMode": "manual",
  "contextMode": "standard",
  "userTask": "定位当前集成测试为什么失败",
  "question": "最可能的根因是什么，最短修复路径是什么？",
  "goal": "拿到结构化排障建议",
  "workspaceSummary": "当前仓库是 open-agent-connect，问题集中在 caller 侧发送确认闭环。",
  "errorSummary": "测试在确认后没有收到结构化回复。",
  "diffSummary": "本地已有 ask master 相关 spec 改动。",
  "relevantFiles": [
    "src/daemon/defaultHandlers.ts",
    "src/core/chat/privateChat.ts"
  ],
  "artifacts": [
    {
      "kind": "text",
      "label": "failing-test-output",
      "content": "AssertionError ..."
    }
  ],
  "constraints": [
    "不要要求读取 CoT",
    "不要建议上传整个仓库"
  ],
  "desiredOutput": {
    "mode": "structured_help"
  }
}
```

### 5.3 runtime 自动补全字段

caller runtime 需要自动补全至少这些字段：

- `requestId`
- `traceId`
- `callerGlobalMetaId`
- `host`
- `trigger.reason`
- `sentAt`
- 解析后的 `target`

也就是说：

- 用户或 skill 负责表达“我要问什么”
- runtime 负责把它变成可发送的正式请求

---

## 6. Target Resolver 规则

### 6.1 显式目标优先

当 draft 中同时包含：

- `target.servicePinId`
- `target.providerGlobalMetaId`

则应按显式目标模式处理。

此时 runtime 应：

1. 从本地 `master-service` 目录校验该目标是否存在
2. 校验其对当前 host mode 可见
3. 校验其当前是否在线
4. 校验其 `masterKind` 与 draft 是否一致

### 6.2 选择器模式

若没有给出完整显式目标，则 V1 可以支持有限选择器模式，例如：

- `masterKind`
- `displayName`
- `official`
- `trusted`

但它必须满足：

- 过滤后只有一个候选

否则 caller flow 不应自动猜测，而应停止并返回选择问题。

### 6.3 选择失败的返回

V1 建议支持这些本地失败结果：

- `master_not_found`
  - 过滤后没有候选
- `master_ambiguous`
  - 候选超过一个
- `master_offline`
  - 目标存在但当前不在线
- `master_host_mode_unsupported`
  - 目标不支持当前 host mode

这些都属于发送前失败，不应进入远端通讯阶段。

### 6.4 `suggest` 模式下的候选来源

当 caller flow 由 `suggest` 触发时：

- runtime 或 skill 可以先给出一个建议目标
- 但最终仍应进入 preview / confirmation

V1 不要求在此文档中定义自动匹配算法，只要求：

- 进入 preview 前必须已经收敛到唯一目标

---

## 7. `metabot master ask` 命令契约

### 7.1 两阶段命令形态

为保证 preview / confirmation 闭环清晰，建议 caller CLI 使用两阶段形态：

```bash
metabot master ask --request-file master-ask.json
metabot master ask --trace-id <trace_id> --confirm
```

第一步负责：

- 读入本地 draft
- 解析目标
- 组装最终线上请求
- 生成 preview
- 持久化 pending ask
- 返回 `awaiting_confirmation`

第二步负责：

- 读取 pending ask
- 正式发送
- 进入等待与集成流程

### 7.2 为什么不建议“再次传 request-file + --confirm”

如果确认阶段继续重复读取原始 `request-file`，容易带来这些问题：

- 第二次执行时 traceId / requestId 不稳定
- preview 时看到的内容与真正发送的内容可能不一致
- skill 或用户需要重复维护同一个 JSON 输入

因此更稳的设计是：

- preview 阶段生成一个稳定 `traceId`
- `traceId` 成为确认阶段的唯一继续入口

### 7.3 第一阶段返回形态

`metabot master ask --request-file ...` 在 V1 下应默认返回类似：

```json
{
  "ok": true,
  "state": "awaiting_confirmation",
  "data": {
    "traceId": "trace-master-abc123",
    "requestId": "master-req-abc123",
    "confirmation": {
      "requiresConfirmation": true,
      "policyMode": "always",
      "confirmCommand": "metabot master ask --trace-id trace-master-abc123 --confirm"
    },
    "preview": {
      "...": "..."
    }
  }
}
```

### 7.4 第二阶段返回形态

`metabot master ask --trace-id ... --confirm` 发送后应进入：

- `requesting_remote`
- 之后可能变成：
  - `completed`
  - `timed_out`
  - `failed`

必要时也应返回：

- `traceId`
- `requestId`
- `response`
- `traceJsonPath`
- `traceMarkdownPath`
- `transcriptMarkdownPath`

### 7.5 与 `metabot master trace` 的关系

一旦 trace 建立，后续读取结果不应再依赖原始输入文件。

标准读取方式应是：

```bash
metabot master trace --id <trace_id>
```

---

## 8. Preview / Confirmation Contract

### 8.1 preview 必须展示什么

preview 至少应展示：

- 目标 Master
  - `displayName`
  - `masterKind`
  - `providerGlobalMetaId`
  - `servicePinId`
- 信任与可见性信息
  - `official`
  - `trustedTier`
  - `pricingMode`
  - `hostModes`
- 本次请求核心意图
  - `userTask`
  - `question`
  - `goal`
- 上下文范围
  - `contextMode`
  - `workspaceSummary`
  - `errorSummary`
  - `diffSummary`
  - `relevantFiles`
  - `artifacts`
- 安全提示
  - 明确说明不会隐式上传整个 repo、`.env`、credentials、keys
- 发送后动作
  - 将通过 `simplemsg` 发给哪个 Master

### 8.2 preview 中应包含最终线上 JSON snapshot

为了让 preview 真正可审阅，V1 建议返回：

- 人类可读摘要
- 最终将要发送的 `master_request` JSON snapshot

这样可以保证：

- 用户看到的就是将要发出的内容
- skill wrapper 可以直接把 preview 转述给 host 会话

### 8.3 `suggest` 模式额外展示项

当本次 Ask Master 来源于 `suggest` 时，preview 还应展示：

- 为什么建议现在问 Master
- 为什么建议的是这个 Master

但这只是展示层附加信息，不应改变底层 `master_request` 协议。

### 8.4 确认的最小语义

确认阶段至少需要满足：

- 有明确 `traceId`
- 有本地 pending ask 记录
- 确认时发送的是 preview 时保存下来的正式请求

V1 不要求 caller runtime 支持花哨确认 UI，但必须保证确认语义稳定。

---

## 9. Config Gate 与策略消费

### 9.1 `askMaster.enabled`

如果本地总开关为 `false`，则：

- `manual` Ask Master 应直接返回 `ask_master_disabled`
- `suggest` Ask Master 不应给出建议

### 9.2 `askMaster.triggerMode`

caller flow 需要消费 `triggerMode`，但 V1 的公开行为建议如下：

- `manual`
  - 正常支持
- `suggest`
  - 正常支持
- `auto`
  - 仅预留接口，不作为 V1 caller CLI 的默认公开能力

### 9.3 `askMaster.confirmationMode`

长期配置可支持：

- `always`
- `sensitive_only`
- `never`

但 V1 caller flow 建议公开行为仍是：

- 默认 `always`
- `manual` 和 `suggest` 都先经过 preview / confirmation

也就是说：

- 架构为未来自动化留口
- 但 V1 不用急着放开无确认发送

### 9.4 `askMaster.contextMode`

caller flow 需要消费 `contextMode`，但这里的职责是：

- 决定本次要打包多少上下文
- 决定 preview 显示多大范围

不在这里定义自动采集算法。

### 9.5 `askMaster.trustedMasters`

V1 下，trusted 列表可作为：

- suggestion 排序信号
- preview 显示信息

但不应在 caller flow 中把它直接扩张成“自动跳过所有确认”的硬编码特权。

---

## 10. Context Packager 责任边界

### 10.1 本文档定义什么

这一层只定义 caller flow 中上下文打包的责任：

- 接受 caller 侧已有上下文输入
- 根据 `contextMode` 做裁剪
- 生成可发送的 `context`
- 生成 preview 里可展示的摘要

### 10.2 本文档不定义什么

这一层不定义：

- 如何从工具日志自动抓取上下文
- 如何从 host transcript 自动提取最佳片段
- 如何进行 stuck 检测
- 如何做复杂语义压缩

这些属于后续 trigger / context collection 模块。

### 10.3 V1 建议的 `contextMode`

caller flow 可消费三种模式：

- `compact`
- `standard`
- `full_task`

其中 V1 建议行为：

- `compact`
  - 只打包核心摘要与极少量文件/工件
- `standard`
  - 作为默认模式
- `full_task`
  - 在架构上保留，但如果当前 caller runtime 尚未具备稳定 collector，可在 V1 临时归一化为 `standard`

### 10.4 V1 建议的打包预算

为了让 preview 与发送内容稳定，V1 建议在 caller flow 里先定最小预算：

- `compact`
  - 最多 3 个 `relevantFiles`
  - 最多 3 个 `artifacts`
  - 只保留简短摘要与片段
- `standard`
  - 最多 8 个 `relevantFiles`
  - 最多 8 个 `artifacts`
  - 保留更多摘要与必要片段
- `full_task`
  - V1 如未成熟，可暂时按 `standard` 处理

### 10.5 明确禁止的内容

caller flow 在打包阶段必须明确禁止：

- 隐式上传整个 repo
- 隐式上传 `.env`
- 隐式上传 credentials
- 隐式上传 keys
- 隐式上传 wallet secrets
- 隐式上传与当前任务无关的私有本地文件

---

## 11. Dispatch 与等待流程

### 11.1 preview 阶段

当 caller 执行：

```bash
metabot master ask --request-file master-ask.json
```

应按顺序完成：

1. 检查总开关与本地身份
2. 读取并校验 draft
3. 解析目标 Master
4. 打包上下文
5. 生成 `requestId` / `traceId`
6. 组装最终 `master_request`
7. 生成 preview
8. 持久化 pending ask
9. 写入 trace，状态为 `awaiting_confirmation`

### 11.2 confirm 阶段

当 caller 执行：

```bash
metabot master ask --trace-id <trace_id> --confirm
```

应按顺序完成：

1. 加载 pending ask
2. 再次检查本地 Ask Master 是否仍可用
3. 确认目标 Master 仍然可解析且可发送
4. 使用已保存的最终 `master_request` 发送 `simplemsg`
5. trace 进入 `requesting_remote`

### 11.3 前台等待与超时

发送后，caller flow 应复用现有 caller 侧等待语义：

- 在前台等待一段时间
- 超时后返回 `timed_out`
- 必要时允许后台继续等远端消息

需要强调：

- `timed_out`
  - 仅表示 caller 本地停止等待
  - 不表示远端 definitively failed

### 11.4 收到合法响应后的处理

收到并校验通过的 `master_response` 后，应至少完成：

1. 匹配 `requestId`
2. 匹配 `traceId`
3. 校验 provider 身份
4. 更新 trace
5. 导出 transcript / markdown / json artifacts
6. 把结构化结果投影回 host-facing 输出

### 11.5 响应非法时的处理

若收到的是：

- 非法 JSON
- 错误 `type`
- 缺字段
- `requestId` / `traceId` 不匹配

则 caller flow 必须：

- 标记为 `failed`
- 保留错误细节到 trace
- 不悄悄当普通聊天文本显示

---

## 12. Trace 语义与状态映射

### 12.1 Trace 仍复用现有基础设施

Ask Master 不需要另造一套 trace 存储与路由。

应优先复用现有：

- trace record 持久化
- trace artifacts 导出
- `/api/trace/:id`
- `/api/trace/:id/watch`

### 12.2 Ask Master 的 trace 标识建议

为了避免和普通 private chat / services call 混淆，建议在 trace 中明确加入 Ask Master 元数据，例如：

```json
{
  "channel": "a2a",
  "transport": "simplemsg",
  "askMaster": {
    "flow": "master",
    "triggerMode": "manual",
    "contextMode": "standard",
    "confirmationMode": "always",
    "requestId": "master-req-01",
    "masterKind": "debug",
    "servicePinId": "abcd1234...i0"
  }
}
```

这里的关键是：

- 产品流是 Ask Master
- transport 是 `simplemsg`
- 不要把它显示成普通 private chat

### 12.3 建议状态

caller flow 应尽量映射出这些 Ask Master 状态：

- `discovered`
- `suggested`
- `awaiting_confirmation`
- `requesting_remote`
- `remote_received`
- `master_responded`
- `completed`
- `timed_out`
- `failed`

### 12.4 V1 的最小落地要求

V1 不必强求所有状态都在第一版就可观测，但至少应稳定支持：

- `awaiting_confirmation`
- `requesting_remote`
- `completed`
- `timed_out`
- `failed`

其中：

- `remote_received`
  - 如果当前 transport / waiter 骨架还拿不到可靠 provider 接收信号，可先保留为未来增强状态
- `master_responded`
  - 可在 caller 成功解密并校验结构化响应后打点

### 12.5 `metabot master trace`

`metabot master trace --id <trace_id>` 在 caller 侧至少应能读到：

- 目标 Master 标识
- preview 摘要
- 请求发送状态
- 响应摘要
- timeout / failure 信息

---

## 13. Host / Skill 封装约束

### 13.1 skill 的正确角色

host 上的自然语言 skill 应做的是：

- 帮用户生成本地 `master ask draft`
- 调用 `metabot master ask --request-file ...`
- 向用户展示 preview
- 用户确认后调用 `metabot master ask --trace-id ... --confirm`
- 最后把结构化结果回注当前会话

### 13.2 skill 不应做什么

skill 不应：

- 自己绕开 CLI 直接发 `simplemsg`
- 自己把 Ask Master 退化成 private chat
- 自己走 `/protocols/simplemsg` 原始聊天文案
- 自己把 Ask Master 退化成 `services call`

这点必须写死，因为它直接关系到用户是否真的体验到“Ask Master”，而不是又被绕回旧路径。

---

## 14. 测试与 TDD 要求

后续实现这份 spec 时，至少应覆盖：

- `master ask --request-file` 在合法输入下返回 `awaiting_confirmation`
- preview 返回稳定 `traceId` / `requestId`
- `master ask --trace-id ... --confirm` 使用 pending ask，而不是重新计算原始输入
- Ask Master 总开关关闭时返回 `ask_master_disabled`
- 目标不存在时返回 `master_not_found`
- 目标歧义时返回 `master_ambiguous`
- 目标离线时返回 `master_offline`
- `contextMode=compact` 与 `standard` 的裁剪行为
- 明确不会隐式把整个 repo、`.env`、credentials、keys 打进去
- 发送后 trace 状态从 `awaiting_confirmation` 推进到 `requesting_remote`
- 收到合法 `master_response` 后 trace 进入 `completed`
- 超时语义保持为“本地停止等待”
- 非法响应必须 loud failure
- `metabot master trace --id ...` 能读到 Ask Master 语义，而不是普通 private chat

推荐测试分层：

- 单元测试
  - target resolver
  - pending ask store
  - preview builder
  - context packager
- 集成测试
  - `master ask` 两阶段调用流
  - trace 状态推进
- e2e 测试
  - 官方 Debug Master 的 manual happy path
  - suggest 模式下的 preview + confirm happy path

---

## 15. V1 范围与非目标

### 15.1 V1 范围

V1 caller flow 应做到：

- 独立 `metabot master ask`
- 两阶段 preview / confirmation
- 独立 pending ask 记录
- caller 侧 context 打包与 preview 展示
- `simplemsg` 发送与合法响应集成
- Ask Master trace 语义
- `manual` 与 `suggest`

### 15.2 V1 非目标

V1 不做：

- 无确认自动发送
- 开放式多轮聊天
- 远端直接改本地代码
- 完整 auto trigger engine
- 复杂 UI 发布台或运营后台

---

## 16. 一句话总结

这一层的正确形态是：

> caller 侧 `master ask` 不是一次普通 CLI 发送，而是一个有 preview、确认、上下文打包、发送、等待、trace 投影的本地编排闭环；它把用户或 skill 的求助意图稳定转换成一次真正的 Ask Master 调用。
