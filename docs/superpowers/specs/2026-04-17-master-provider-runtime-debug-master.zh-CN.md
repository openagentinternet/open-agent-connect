# Provider 侧 Master Runtime 与 Debug Master Fixture 设计说明

**日期：** 2026-04-17

## 1. 文档目标

本文档是基于总纲文档 [2026-04-17-metaweb-ask-master-design.zh-CN.md](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-17-metaweb-ask-master-design.zh-CN.md) 的第四份子模块细化 spec。

本文档只解决 provider 侧的这几个问题：

- provider runtime 如何接收并处理 `master_request`
- provider runtime 如何生成并发送 `master_response`
- provider 侧如何把 Ask Master 流投影为本地状态与 trace
- 官方免费 `Debug Master` fixture 在 V1 应做到什么程度

本文档**不处理**：

- `master-service` 的发布与发现细节
- caller 侧 preview / confirmation / pending ask
- `simplemsg` 与 `master_request / master_response` 的底层 schema 定义
- 自动/半自动 trigger engine
- 多轮开放式聊天协议
- 远端直接执行 caller 本地代码

这份 spec 的目标是：

- 给 provider 侧 Ask Master runtime 定一个最小但完整的执行闭环
- 让官方 `Debug Master` 能作为 V1 的可验收 fixture 跑通
- 明确 provider 侧只消费 caller 发送过来的结构化上下文，不假设可以直接读取 caller 本地环境
- 为后续 runtime handler、fixture、provider trace 与 e2e 测试提供边界清晰的基线

---

## 2. 设计原则

### 2.1 Provider 侧是“协作响应端”，不是 remote executor

provider 侧 Master runtime 的职责是：

- 接收一次结构化求助
- 基于 request 中给出的上下文做判断
- 生成结构化帮助结果
- 返回给 caller

它不是：

- caller 本地代码执行器
- caller 本地文件系统代理
- 长期开着的开放聊天窗口

这点在 V1 必须非常明确。

### 2.2 Provider 只消费显式收到的上下文

provider runtime 不应默认拥有这些能力：

- 读取 caller 全仓库
- 读取 caller `.env`
- 读取 caller credentials / keys
- 读取 caller 本地终端
- 读取 caller CoT

provider 只能基于 caller 通过 `master_request.context` 显式发来的内容判断。

### 2.3 V1 先做单轮结构化协作

V1 的 provider 侧重点是单轮闭环：

1. 收到 `master_request`
2. 运行一次 Master runner
3. 返回一次 `master_response`

即使 `master_response.status = need_more_context`，也只是一次结构化回复结果，不代表 V1 已经支持开放式多轮协作。

### 2.4 复用现有 provider / session / trace 骨架

当前仓库已经有 provider 侧的若干可复用骨架，例如：

- provider presence / heartbeat
- provider summary / console
- A2A provider session engine
- provider inbox polling / caller session polling

Ask Master provider runtime 应尽量借这些骨架，而不是自己再起一整套 provider 子系统。

但复用边界必须写死：

- heartbeat 只表示 provider 在线存在，不表示一定能成功处理当前 Ask Master 请求
- provider session / trace 只绑定单次 `master_request` 生命周期，不扩张成长期开放会话状态
- provider console 只做本地可观测性投影，不承担 Ask Master 协议本身

### 2.5 官方 Debug Master 先以 fixture 为目标

V1 provider 侧最重要的可验收产物，不是“很多 Master”，而是：

- 一个稳定在线
- 行为可预测
- 返回结构化结果
- 免费
- 适合本地/CI/e2e 验收

的官方 `Debug Master` fixture。

---

## 3. 与现有代码的关系

### 3.1 可直接借鉴的现有骨架

当前仓库中，以下实现可作为后续开发的技术参考：

- `src/daemon/routes/provider.ts`
  - provider summary / presence 等本地 provider route 入口
- `src/core/provider/providerHeartbeatLoop.ts`
  - provider 在线 heartbeat 骨架
- `src/core/a2a/sessionEngine.ts`
  - 已有 provider 侧 `provider_received` / `provider_completed` / `provider_failed` / `clarification_needed` 事件语义
- `src/core/a2a/transport/transportAdapter.ts`
  - 已有 provider inbox / caller session transport event 接口
- `src/core/a2a/transport/metawebPollingAdapter.ts`
  - 已有 provider inbox polling 与 caller 侧事件 polling 骨架
- `src/core/provider/providerConsole.ts`
  - 已有 provider 侧服务、订单、手工动作的快照视图骨架

### 3.2 不应直接照搬的部分

以下内容不应直接等同于 Ask Master provider runtime：

- skill-service provider 的订单/支付闭环
- refund / rating / paid order 语义
- 现有 service runner 的付费交付逻辑
- 普通 private chat 的用户语义

Ask Master provider 侧可以借 infrastructure，但不能借旧产品心智。

### 3.3 设计策略

推荐策略是：

- 复用 provider presence 与 provider state 骨架
- 在 provider inbox 中识别 `master_request`
- 用独立的 Master runner 接口执行业务逻辑
- 把结果包装成 `master_response`
- 再通过 `simplemsg` 发回 caller

---

## 4. Provider 侧运行模型

provider 侧 Ask Master runtime 建议由以下模块组成：

### 4.1 Provider Inbox Adapter

负责：

- 接收来自 MetaWeb 的入站 `simplemsg`
- 解密明文
- 识别是否为 `master_request`
- 做最外层消息过滤

### 4.2 Request Validator

负责：

- JSON 解析
- `master_request` schema 校验
- 版本兼容性检查
- 本地身份与 target 一致性检查

### 4.3 Master Router

负责根据请求中的：

- `servicePinId`
- `masterKind`
- 本地已发布 `master-service`

把请求路由到正确的 Master runner。

### 4.4 Master Runner

负责真正生成结构化帮助结果。

它的输入是：

- 已校验的 `master_request`

它的输出是：

- provider 内部结构化 runner result

### 4.5 Response Builder

负责把 runner result 转成正式的 `master_response`。

### 4.6 Outbound Sender

负责：

- 将 `master_response` 序列化
- 通过 `simplemsg` 回发给 caller

### 4.7 Provider Trace Projector

负责把 provider 侧这次处理投影成本地：

- session state
- trace
- transcript / markdown / json artifacts
- provider console 可读记录

---

## 5. Provider Inbox 入口

### 5.1 入口来源

V1 推荐 provider 侧有两类入口能力：

- MetaWeb 入站 polling
- 本地 daemon/runtime handler

也就是说，provider runtime 的工作方式应该接近：

1. provider 在线且 heartbeat 正常
2. polling adapter 或其他 transport adapter 拉到新消息
3. 如果消息解密后是合法 `master_request`
4. 则进入 Master runtime

### 5.2 只处理发给自己的请求

provider 侧收到明文后，应至少验证：

- `target.providerGlobalMetaId` 与本地 identity 一致
- `target.servicePinId` 属于当前 provider 已知的 `master-service`

不满足时：

- 不应假装接单
- 不应胡乱返回结构化结果
- 应记录为拒绝或忽略事件

### 5.3 只处理 Ask Master 消息

provider inbox 虽然共用 `simplemsg` transport，但 Ask Master runtime 只应消费：

- `type = master_request`

这意味着：

- 普通 private chat 不进入这条处理链
- 旧 service order 消息不进入这条处理链

### 5.4 请求去重

V1 不需要复杂去重系统，但建议 provider runtime 至少按：

- `requestId`
- `replyPin`

做最小幂等保护，避免网络重试导致同一请求被多次执行。

---

## 6. Request Validator 规则

### 6.1 必做校验

provider 侧收到请求后，至少应做：

1. 明文是否为合法 JSON
2. `type` 是否为 `master_request`
3. 协议版本是否可接受
4. `requestId` 是否存在
5. `traceId` 是否存在
6. `target.providerGlobalMetaId` 是否等于本地 provider
7. `target.servicePinId` 是否命中本地已发布 master
8. `target.masterKind` 与本地 master 是否一致

### 6.2 错误处理原则

这些错误不应被静默吞掉：

- JSON 非法
- schema 非法
- 目标不匹配
- 版本不兼容

V1 建议：

- 本地记录 provider-side failed event
- 不把非法内容当普通文本继续处理

### 6.3 对隐私边界的态度

若请求中出现明显违反协议边界的上下文内容，例如：

- 疑似私钥
- 疑似 `.env` 全文
- 明显无关的大量本地内容

provider runtime 不需要替 caller 做完整 DLP，但应允许：

- 标记风险
- 在 `master_response.risks` 中提示
- 必要时返回 `declined`

---

## 7. Master Runner 接口

### 7.1 Provider 内部 runner 结果

provider 侧内部建议定义一个独立于 wire protocol 的 runner 结果接口，例如：

```ts
type MasterRunnerResult =
  | {
      state: 'completed';
      summary: string;
      findings: string[];
      recommendations: string[];
      risks: string[];
      confidence: number | null;
      followUpQuestion?: string | null;
    }
  | {
      state: 'need_more_context';
      summary: string;
      missing: string[];
      followUpQuestion: string;
    }
  | {
      state: 'declined';
      reason: string;
      risks?: string[];
    }
  | {
      state: 'failed';
      code: string;
      message: string;
    };
```

这样设计的目的，是把：

- provider 内部执行逻辑
- 对外 `master_response` 协议

分成两层。

### 7.2 runner 输入边界

runner 的输入应只包括：

- 已校验后的 `master_request`
- provider 本地与该 Master 有关的固定配置

不应允许 runner 默认拿到：

- caller 本地未发送文件
- caller 机器环境
- caller 密钥材料

### 7.3 runner 输出边界

V1 的 runner 输出重点是：

- 帮助 caller 继续推进任务
- 返回结构化文本建议

V1 不输出：

- “我已经帮你改了 caller 代码”
- “我已经直接执行了 caller 本地命令”
- “我已经读取了 caller 的整个项目”

---

## 8. `master_response` 生成规则

### 8.1 必填关联字段

provider 生成响应时，必须原样带回这些关联字段：

- `requestId`
- `traceId`
- `providerGlobalMetaId`
- `servicePinId`
- `masterKind`

### 8.2 `status` 映射建议

provider 内部 runner 结果到 wire `master_response.status` 的映射建议如下：

- runner `completed`
  - `master_response.status = completed`
- runner `need_more_context`
  - `master_response.status = need_more_context`
- runner `declined`
  - `master_response.status = declined`
- runner `failed`
  - `master_response.status = failed`

### 8.3 输出结构化优先

即使 provider 内部用了自由文本推理，最终给 caller 的结果也应优先转成结构化输出，例如：

- `summary`
- `findings`
- `recommendations`
- `risks`
- `confidence`
- `followUpQuestion`

不要把最终返回退化成一大段普通聊天文本。

### 8.4 `need_more_context` 的语义

`need_more_context` 在 V1 的正确语义是：

- 本次单轮请求没有足够信息
- provider 返回一个结构化“缺什么”的结果
- 由 caller 决定是否之后再发起新的一次 Ask Master

它不自动打开一个长期 clarification session。

---

## 9. Provider Trace 与状态语义

### 9.1 仍复用现有 session / trace 骨架

Ask Master provider runtime 应尽量复用现有：

- `sessionEngine.receiveProviderTask`
- `sessionEngine.applyProviderRunnerResult`
- trace persistence
- transcript export

这里需要特别强调：

- `providerHeartbeatLoop` 的职责仅是维持 provider 在线可发现状态
- 它不负责保证某个具体 `master_request` 一定会被接收或成功执行
- provider session / trace 的职责仅是记录一次 request 的处理生命周期
- 它们不应被误用为“长期 Master 聊天会话”的状态容器

### 9.2 建议事件映射

provider 侧可优先借这些现有事件名：

- `provider_received`
- `provider_completed`
- `provider_failed`
- `clarification_needed`

但在 Ask Master V1 下建议解释为：

- `provider_received`
  - 合法 `master_request` 已进入 runtime
- `provider_completed`
  - 已成功形成结构化 `master_response`
- `provider_failed`
  - provider 内部处理失败
- `clarification_needed`
  - 对应 `need_more_context`

### 9.3 Provider 侧 trace 元数据

为避免 provider trace 与普通 service order 混淆，建议额外记录：

```json
{
  "askMaster": {
    "flow": "master",
    "servicePinId": "abcd1234...i0",
    "masterKind": "debug",
    "requestId": "master-req-01",
    "requestStatus": "completed"
  }
}
```

### 9.4 Provider Console 的 V1 目标

V1 不需要专门做一个全新的 Master 控制台，但 provider 侧至少应能通过现有 provider summary / trace 体系看到：

- 当前 provider 身份在线
- 当前已发布的 `master-service`
- 最近收到过哪些 Ask Master 请求
- 最近哪些请求成功、失败、需要更多上下文

---

## 10. Official Debug Master Fixture

### 10.1 V1 角色定位

官方 `Debug Master` fixture 的作用不是“最强调试模型”，而是：

- 官方提供
- 免费
- 可发现
- 可在线
- 输出稳定
- 适合本地 smoke test、CI、e2e

### 10.2 V1 功能范围

V1 的 `Debug Master` fixture 只需聚焦：

- 调试
- 排障
- 测试失败诊断
- 环境/配置问题初步判断

它不需要覆盖：

- 架构设计
- 大规模代码评审
- 自动生成 patch
- 复杂多轮对话

### 10.3 V1 输入依赖

`Debug Master` fixture 应主要消费这些字段：

- `task.userTask`
- `task.question`
- `task.goal`
- `context.workspaceSummary`
- `context.errorSummary`
- `context.diffSummary`
- `context.relevantFiles`
- `context.artifacts`
- `constraints`

它不依赖：

- caller repo 直读
- caller 终端直连
- caller hidden transcript

### 10.4 V1 输出约束

`Debug Master` fixture 至少应稳定返回：

- `summary`
- `findings`
- `recommendations`
- `risks`
- `confidence`

输出风格建议：

- 直接
- 结构化
- 可执行
- 少废话

### 10.5 V1 实现建议

为了保证 fixture 可控，V1 推荐优先采用以下顺序：

1. 规则化 / 模板化 debug fixture
2. 必要时再接入模型能力

也就是说，第一版不应把 e2e 能否跑通完全寄托在外部模型不稳定性上。

### 10.6 V1 规则优先级

官方 `Debug Master` fixture 可先基于这些输入特征给出稳定建议：

- `advisor list` / `master list` 为空
  - 优先检查 source、provider online、host mode
- `trace` / timeout 相关关键词
  - 优先说明 timeout 仅代表 caller 本地停止等待
- `service not found` / `master not found`
  - 优先检查 service pin、provider id、discovery 与 online 状态
- `json` / `schema` / `validation`
  - 优先检查 request/response 结构化字段
- `simplemsg` / decrypt / chat public key
  - 优先检查密钥与消息解密路径

这些规则不是要把 Master 永久写死成关键词分类器，而是为了让官方 fixture 在 V1 能稳定给出像样的帮助。

### 10.7 fixture 结果的真实性要求

即使是官方 fixture，也不应伪装成：

- 已经访问 caller 本地环境
- 已经执行 caller 本地命令
- 已经读取 caller 未发送的文件

它只能基于收到的信息推断，并在必要时明确说“这是基于当前 request 的判断”。

---

## 11. Provider 侧失败与降级策略

### 11.1 本地可恢复失败

例如：

- runner 内部异常
- provider 当前配置缺失
- 本地 response 序列化失败

这类问题应：

- 记录 provider-side failed trace
- 尽量返回 `master_response.status = failed`

### 11.2 不可安全处理的请求

例如：

- 目标 service 与本地身份不匹配
- 请求结构严重非法
- 明显越过隐私边界

这类问题不应继续正常处理。

V1 可采用：

- 本地记录失败
- 尽量不生成误导性成功响应

### 11.3 发送响应失败

如果 provider 已生成合法 `master_response`，但通过 `simplemsg` 回发失败，则应：

- 保留本地 provider trace
- 标记 outbound send failed
- 让本地 summary / trace 可见这次失败

---

## 12. 测试与 TDD 要求

后续实现这份 spec 时，至少应覆盖：

- provider 只处理 `type = master_request`
- 非法 JSON 不进入 runner
- target providerGlobalMetaId 不匹配时失败
- servicePinId 不匹配时失败
- masterKind 不匹配时失败
- 合法请求能进入 provider runtime 并产生 `provider_received`
- runner `completed` 映射为 `master_response.status = completed`
- runner `need_more_context` 映射为 `master_response.status = need_more_context`
- runner `failed` 映射为 `master_response.status = failed`
- provider 侧 trace 能保留 requestId / servicePinId / masterKind
- 官方 Debug Master fixture happy path
- 官方 Debug Master fixture 对典型 discovery / timeout / simplemsg 问题能给出稳定结构化结果
- provider 不会假装读取 caller 未发送的本地环境

推荐测试分层：

- 单元测试
  - request validator
  - master router
  - response builder
  - debug master fixture rules
- 集成测试
  - provider inbox -> runtime -> response send
  - provider trace 状态推进
- e2e 测试
  - caller ask -> official debug master response happy path

---

## 13. V1 范围与非目标

### 13.1 V1 范围

V1 provider 侧应做到：

- 能识别并处理 `master_request`
- 能生成并发送结构化 `master_response`
- 有最小 provider-side trace / state 投影
- 有一个官方免费 `Debug Master` fixture
- 不破坏现有 provider presence / heartbeat 骨架

### 13.2 V1 非目标

V1 不做：

- 多轮开放式聊天
- 远端直接执行 caller 本地代码
- 复杂多模型调度
- 自动 patch / 自动改仓库
- marketplace / 付费结算逻辑

---

## 14. 一句话总结

这一层的正确形态是：

> provider 侧 Ask Master runtime 是一个只消费显式 `master_request` 上下文、返回结构化 `master_response` 的协作响应端；V1 先用一个稳定、免费、可验收的 Official Debug Master fixture 跑通整条 provider 闭环。
