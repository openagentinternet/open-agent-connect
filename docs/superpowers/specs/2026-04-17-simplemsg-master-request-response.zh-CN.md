# SimpleMsg 下的 Master Request / Response 设计说明

**日期：** 2026-04-17

## 1. 文档目标

本文档是基于总纲文档 [2026-04-17-metaweb-ask-master-design.zh-CN.md](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-17-metaweb-ask-master-design.zh-CN.md) 的第二份子模块细化 spec。

本文档只解决两个问题：

- `Ask Master` 的真正请求与响应如何通过 `simplemsg` 传输
- `master_request / master_response` 在 `simplemsg` 明文体中的结构化消息模型如何定义

本文档**不处理**：

- `master-service` 的发布与发现
- Master 自动/半自动触发引擎
- 上下文如何自动采集
- `contextMode` 选择、冷却限流、重试策略
- provider 侧具体推理实现
- host 侧具体 skill 封装
- trace 展示 UI

这份 spec 的目标是：

- 明确 `simplemsg` 是 Ask Master 的唯一私密通讯层
- 明确 `master_request / master_response` 是 `simplemsg` 内部的结构化 envelope，而不是新 transport
- 为后续 CLI、provider runtime、trace、fixture、测试提供稳定协议基线

---

## 2. 设计原则

### 2.1 不新起 transport family

`Ask Master` 不应再发明一套新的链上通讯协议。

真正的网络传输应直接复用现有：

```text
/protocols/simplemsg
```

也就是说：

- `master-service` 负责公开发现
- `simplemsg` 负责私密通讯
- `master_request / master_response` 只是 `simplemsg` 明文内容中的 JSON envelope

### 2.2 协议分层清晰

这一层需要严格区分三层语义：

- 目录层
  - `master-service`
- 传输层
  - `simplemsg`
- 消息语义层
  - `master_request`
  - `master_response`

后续实现时，不能把这三层重新混成一个 `services call` 风格的大杂烩。

### 2.3 复用现有 simplemsg 能力

当前仓库已经有可复用的私聊能力骨架，例如：

- `src/core/chat/privateChat.ts`
  - 加密、解密、`/protocols/simplemsg` payload 构造
- `src/daemon/defaultHandlers.ts`
  - 私聊发送入口与现有 trace 组织
- `src/core/a2a/metawebReplyWaiter.ts`
  - 监听、解密、等待远端回复

推荐实现方式是：

- 复用这些底层能力
- 在其上增加 `master_request / master_response` 的 schema、校验、序列化、解析

不应做的事情：

- 再做一个 `advisor-msg`
- 再做一个 `master-call transport`
- 为 Ask Master 绕开 `simplemsg` 单独开明文链路

### 2.4 消息协议要可扩展，但 V1 要简单

V1 必须能很快跑通，所以协议应当：

- 有稳定的最小必填字段
- 支持版本号
- 支持未来扩展字段
- 默认返回结构化结果

但 V1 不应一开始就塞入：

- 多轮会话控制协议
- 复杂工具调用协议
- 远端执行权限协商
- 动态报价协商

### 2.5 不依赖 CoT

协议里不应引入任何 “读取 CoT” 的依赖。

可发送的上下文应来自可观测任务轨迹，例如：

- 用户问题
- assistant 可见输出摘要
- 报错摘要
- diff 摘要
- 测试输出摘要
- 文件摘要与片段

不应把“模型内部思维链”定义成协议字段。

---

## 3. 与现有代码的关系

### 3.1 可直接借鉴的部分

当前仓库中，以下现有实现可作为未来开发的技术参考：

- `src/core/chat/privateChat.ts`
  - 使用 ECDH + AES 构造加密 `simplemsg`
  - 负责 `sendPrivateChat` / `receivePrivateChat`
- `src/daemon/defaultHandlers.ts`
  - 已有 `chat.private` 发送入口
  - 已有私聊 trace 的导出模式
- `src/core/a2a/metawebReplyWaiter.ts`
  - 已有从 socket 监听远端私聊并解密的基础设施

### 3.2 不应直接照搬的部分

以下内容不应直接等同于 Ask Master：

- 现有 “Private Chat” 用户语义
- 现有服务订单消息结构
- 现有 `services call` 的送达/评分闭环

Ask Master 可以复用加密和收发骨架，但它的消息类型、状态语义、trace 语义必须独立。

### 3.3 设计策略

推荐策略是：

- 保持 `simplemsg` 外层完全不变
- 在明文 `content` 中放入结构化 JSON
- 本地发送前先校验 schema
- provider 解密后按 `type` 分发到 `master_request`
- caller 收到解密后的 JSON 后按 `master_response` 校验

---

## 4. 传输模型

### 4.1 外层 transport

Ask Master 的真实发送包仍然是标准 `simplemsg`：

```json
{
  "path": "/protocols/simplemsg",
  "contentType": "application/json",
  "payload": "{...encrypted simplemsg payload...}"
}
```

这里的关键点不是外层字段长什么样，而是：

- 外层仍然是现有 `simplemsg`
- 加密与收发流程仍由现有私聊能力负责
- Ask Master 只定义 `simplemsg` 解密后的明文 JSON 内容

### 4.2 内层明文内容

`simplemsg` 解密后的 `plaintext` 必须是 UTF-8 JSON 字符串。

也就是说，请求侧最终要加密的，不是自由文本 prompt，而是类似下面这种 JSON 文本：

```json
{
  "type": "master_request",
  "version": "1.0.0",
  "requestId": "master-req-123",
  "traceId": "trace-master-123",
  "..."
}
```

响应侧同理：

```json
{
  "type": "master_response",
  "version": "1.0.0",
  "requestId": "master-req-123",
  "traceId": "trace-master-123",
  "..."
}
```

### 4.3 `replyPin` 的使用建议

为了便于链路关联，V1 建议：

- `master_request` 发出时：
  - `replyPin` 可为空，或挂到本地已有会话 pin
- `master_response` 发回时：
  - 应尽量把 `replyPin` 指向收到的 `master_request` 消息 pin

这样做的目的不是建立多轮聊天，而是让 request / response 在链上有最基本的回复关系。

---

## 5. `master_request` 设计

### 5.1 角色

`master_request` 表示：

- caller 侧本地 Agent
- 在一个明确任务上下文里
- 向某个明确的 Master
- 请求一次结构化协作帮助

它不是普通聊天消息，也不是远端执行指令。

### 5.2 V1 最小字段

V1 建议最小字段如下：

```json
{
  "type": "master_request",
  "version": "1.0.0",
  "requestId": "master-req-01",
  "traceId": "trace-master-01",
  "callerGlobalMetaId": "idq1caller...",
  "target": {
    "providerGlobalMetaId": "idq1provider...",
    "servicePinId": "abcd1234...i0",
    "masterKind": "debug"
  },
  "host": {
    "mode": "codex",
    "client": "metabot",
    "clientVersion": "0.1.0"
  },
  "trigger": {
    "mode": "manual",
    "reason": "user_requested_help"
  },
  "task": {
    "userTask": "定位当前测试失败的根因",
    "question": "为什么这个测试会失败，最短修复路径是什么？",
    "goal": "拿到诊断与下一步建议"
  },
  "context": {
    "workspaceSummary": "当前仓库是 open-agent-connect，问题集中在私聊消息路径。",
    "errorSummary": "测试在解密阶段失败。",
    "diffSummary": "本地有未提交改动，主要是 master-service 相关文档。",
    "relevantFiles": [
      "src/core/chat/privateChat.ts"
    ],
    "artifacts": [
      {
        "kind": "text",
        "label": "test-output",
        "content": "AssertionError ..."
      }
    ]
  },
  "constraints": [
    "不要建议读取 CoT",
    "不要要求上传整个仓库"
  ],
  "desiredOutput": {
    "mode": "structured_help"
  },
  "sentAt": 1776400000000
}
```

### 5.3 字段语义

- `type`
  - 固定为 `master_request`
- `version`
  - 协议版本号
- `requestId`
  - 本次请求的稳定关联 id
- `traceId`
  - 本地 Ask Master trace id
- `callerGlobalMetaId`
  - 发起方 MetaBot 标识
- `target`
  - 本次面向的 Master 标识
- `host`
  - 当前 host 与客户端信息
- `trigger`
  - 触发方式与触发原因
- `task`
  - 当前任务与问题本体
- `context`
  - 本次允许发送的上下文包
- `constraints`
  - 希望 Master 遵守的限制
- `desiredOutput`
  - caller 期待的输出模式
- `sentAt`
  - 请求生成时间

### 5.4 `target` 字段

`target` 最小建议包含：

```json
{
  "providerGlobalMetaId": "idq1provider...",
  "servicePinId": "abcd1234...i0",
  "masterKind": "debug"
}
```

设计原因：

- `providerGlobalMetaId`
  - 决定消息要发给谁
- `servicePinId`
  - 标识 caller 选择的是哪个 `master-service`
- `masterKind`
  - 帮助 provider runtime 做路由与校验

### 5.5 `trigger` 字段

V1 建议支持：

- `manual`
- `suggest`
- `auto`

但即使未来支持 `auto`，这个字段也只是说明“为何发起”，不是授权跳过本地策略层。

### 5.6 `context` 字段

`context` 是协议里最关键的隐私边界之一。

这里需要特别强调：

- 本文档只定义 `context` 在线上传输时的字段容器与 allowlist 边界
- 不定义 runtime 应该如何收集这些字段
- 不定义 runtime 如何裁剪大小、选择 `contextMode`、或决定是否采集

这些属于后续 caller 侧调用流 / 上下文打包 spec，而不是本消息协议 spec。

V1 建议仅允许标准化最小字段：

- `workspaceSummary`
- `errorSummary`
- `diffSummary`
- `relevantFiles`
- `artifacts`

其中：

- `relevantFiles`
  - V1 优先只传文件路径、摘要、片段
- `artifacts`
  - V1 优先只传小文本片段与小 JSON 片段

协议层应明确禁止隐式表达：

- “默认已上传整个 repo”
- “默认可读取本地所有文件”
- “默认包含 `.env` / credentials / keys”

### 5.7 可选扩展字段

为了兼容未来更强的协作能力，协议允许保留扩展字段，例如：

- `conversationWindow`
- `toolObservations`
- `planSummary`
- `budgetHints`
- `trustedContextLevel`

但这些不应成为 V1 必填字段。

---

## 6. `master_response` 设计

### 6.1 角色

`master_response` 表示：

- 远端 Master
- 对某个明确 `master_request`
- 返回的一次结构化协作结果

它的重点是：

- 帮助 caller 继续推进任务
- 保持结构化
- 允许后续扩展

它不是“执行结果回执协议”，也不是“开放多轮聊天”的替代品。

### 6.2 V1 最小字段

V1 建议最小字段如下：

```json
{
  "type": "master_response",
  "version": "1.0.0",
  "requestId": "master-req-01",
  "traceId": "trace-master-01",
  "providerGlobalMetaId": "idq1provider...",
  "servicePinId": "abcd1234...i0",
  "masterKind": "debug",
  "status": "completed",
  "summary": "最可能的根因是 simplemsg 收到的内容已解密，但没有按 master_response 结构继续校验。",
  "findings": [
    "当前链路已具备 simplemsg 收发能力",
    "缺失的是 Ask Master 自己的消息 envelope 校验与分流"
  ],
  "recommendations": [
    "先加 master_request/master_response schema",
    "再在 provider 入口按 type 分流"
  ],
  "risks": [
    "不要把 Ask Master 再做成 services call 的变体"
  ],
  "confidence": 0.86,
  "followUpQuestion": "是否已经决定 V1 只支持单轮结构化回复？",
  "respondedAt": 1776400004321
}
```

### 6.3 字段语义

- `type`
  - 固定为 `master_response`
- `version`
  - 协议版本号
- `requestId`
  - 必须对应原请求
- `traceId`
  - 必须对应原 trace
- `providerGlobalMetaId`
  - 回复方 MetaBot 标识
- `servicePinId`
  - 当前回复对应的 `master-service`
- `masterKind`
  - 当前 Master 类型
- `status`
  - 回复状态
- `summary`
  - 核心结论摘要
- `findings`
  - 关键判断
- `recommendations`
  - 建议动作
- `risks`
  - 风险提示
- `confidence`
  - 可信度
- `followUpQuestion`
  - 需要 caller 补充时的单个后续问题
- `respondedAt`
  - 回复生成时间

### 6.4 `status` 字段

V1 建议支持这些状态：

- `completed`
  - 成功给出结构化帮助
- `need_more_context`
  - 需要补充信息才能继续判断
- `declined`
  - Master 拒绝处理
- `unavailable`
  - 当前 Master 暂不可用
- `failed`
  - provider 侧内部失败

其中：

- `completed`
  - 应包含完整结构化内容
- `need_more_context`
  - 应尽量包含明确缺什么
- `declined`
  - 应尽量包含拒绝原因

### 6.5 可扩展字段

为避免把 Master 能力过早锁死，协议应允许未来扩展，例如：

- `plans`
- `alternatives`
- `decisionMatrix`
- `patchHints`
- `citations`
- `attachments`
- `structuredBlocks`

但这些不应成为 V1 的硬依赖。

---

## 7. 关联、幂等与状态语义

### 7.1 请求关联

`requestId` 是请求级关联主键。

要求：

- caller 发请求时生成
- provider 回复时原样带回
- caller 收响应时优先用 `requestId` 做匹配

### 7.2 Trace 关联

`traceId` 是 host runtime 的本地链路标识。

要求：

- caller 发请求时生成
- provider 回应时透传
- 本地 trace 系统后续应能凭此标记这是 Ask Master 流

### 7.3 `replyPin` 关联

`replyPin` 属于 transport 层辅助关联。

它可以帮助链上追踪消息前后关系，但不应代替：

- `requestId`
- `traceId`

### 7.4 幂等建议

V1 不强求复杂去重协议，但建议：

- provider 若短时间内收到同一 `requestId`
  - 可以返回同一结果
  - 或直接标记为重复请求

这样有利于应对网络抖动和重试。

---

## 8. 校验与错误语义

### 8.1 发送前校验

caller 在发送前必须做本地校验：

- 不是合法 JSON
  - 不发送
- `type` 不对
  - 不发送
- 缺少关键字段
  - 不发送
- 明显越过隐私边界
  - 不发送

这层失败属于本地输入错误，不应上链。

### 8.2 接收后校验

provider 收到解密明文后，应先做：

1. JSON 解析
2. `master_request` schema 校验
3. 目标与自身身份一致性校验
4. 版本兼容性校验

caller 收到回复后也应做：

1. JSON 解析
2. `master_response` schema 校验
3. `requestId` / `traceId` 匹配
4. provider 身份与目标 service 一致性校验

### 8.3 失败要 loud failure

以下情况都应作为显式失败，而不是偷偷降级成普通聊天文本：

- JSON 不合法
- `type` 不是 `master_request` / `master_response`
- 必填字段缺失
- `requestId` 不匹配
- `traceId` 不匹配
- 协议版本不兼容

这点非常重要，因为 Ask Master 需要稳定协议，而不是“看起来像文本就凑合显示”。

### 8.4 超时语义

Ask Master 必须继承现有 MetaWeb 等待语义：

- `timed_out`
  - 表示 caller 本地停止等待
  - 不等于远端 definitively failed

也就是说：

- 本地 timeout 语义不应被这套协议改变
- 协议本身不应发明另一套 timeout 定义

---

## 9. 隐私与边界

### 9.1 默认私密

`Ask Master` 的任务上下文必须走 `simplemsg` 私密传输，不应直接写成公开链上可读明文。

### 9.2 禁止隐式全量上传

协议层必须明确：

- 不隐式上传整个 repo
- 不隐式上传 `.env`
- 不隐式上传 credentials
- 不隐式上传 keys
- 不隐式上传与当前任务无关的大文件

### 9.3 显式 allowlist

真正被发送的上下文，应由 caller runtime 明确列出。

协议层建议将此边界表达成：

- `relevantFiles`
- `artifacts`
- `workspaceSummary`
- `errorSummary`
- `diffSummary`

而不是“默认对方可以读取 caller 本地环境”。

---

## 10. 与 CLI / Runtime 的接口关系

虽然本文档不定义完整 CLI 行为，但它对后续实现有明确约束：

- `metabot master ask`
  - 本质上是：
    - 生成 `master_request`
    - 本地 preview / confirmation
    - 序列化为 JSON 文本
    - 走 `simplemsg` 发出
- provider runtime
  - 本质上是：
    - 收到 `simplemsg`
    - 解密明文
    - 识别 `type = master_request`
    - 处理后生成 `master_response`
    - 再通过 `simplemsg` 回发
- `metabot master trace`
  - 后续应读取的是 Ask Master 链路语义
  - 不是普通 Private Chat 语义

---

## 11. 测试与 TDD 要求

后续实现这份 spec 时，至少应覆盖：

- `master_request` schema 校验成功
- `master_request` 缺字段失败
- `master_response` schema 校验成功
- `master_response` 缺字段失败
- 请求 JSON 序列化后可经 `sendPrivateChat` 加密
- 响应 JSON 可经 `receivePrivateChat` 解密并恢复
- `requestId` / `traceId` 匹配成功
- `requestId` / `traceId` 不匹配时 loud failure
- 非法 JSON 明文失败
- 错误 `type` 失败
- 超时语义保持现有定义不变

推荐测试分层：

- 单元测试
  - schema 与序列化/反序列化
- 集成测试
  - `simplemsg` roundtrip 下的请求/响应解析
- e2e 测试
  - Official Debug Master 的单轮 happy path

---

## 12. V1 范围与非目标

### 12.1 V1 范围

V1 应做到：

- `simplemsg` 作为唯一私密 transport
- `master_request / master_response` 结构化 JSON envelope
- 单轮请求 / 单轮结构化回复
- 本地发送前校验
- 收到后严格校验
- 与现有 timeout 语义兼容

### 12.2 V1 非目标

V1 不做：

- 开放式多轮聊天协议
- 远端执行动作协议
- 复杂能力协商
- 自动上下文采集策略细则
- 自动触发策略引擎

---

## 13. 一句话总结

这一层的正确形态是：

> `Ask Master` 的网络通讯直接复用 `simplemsg`；`master_request / master_response` 作为其明文 JSON envelope 承担结构化协作语义，既不新起 transport，也不退化成普通私聊文本。
