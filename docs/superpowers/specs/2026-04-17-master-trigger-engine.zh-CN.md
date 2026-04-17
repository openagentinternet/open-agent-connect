# Ask Master Trigger Engine 设计说明

**日期：** 2026-04-17

## 1. 文档目标

本文档是基于总纲文档 [2026-04-17-metaweb-ask-master-design.zh-CN.md](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-17-metaweb-ask-master-design.zh-CN.md) 的第六份子模块细化 spec。

本文档只解决这些问题：

- Ask Master 的 trigger engine 应负责什么、不负责什么
- `manual` / `suggest` / `auto` 三种触发模式如何分层
- “卡住”或“值得请教 Master”应基于什么可观测信号，而不是 CoT
- 总开关、冷却、抑制、trusted master 等策略配置如何作用于触发决策

本文档**不处理**：

- `master-service` 发布与发现细节
- caller 侧 preview / confirmation 的具体实现
- provider runtime 与 Debug Master fixture 的实现细节
- `master_request / master_response` schema 细节
- trace UI 的具体视觉样式
- 具体模型或规则阈值的最终参数

这份 spec 的目标是：

- 给 Ask Master 的自动/半自动体验定一个可演进的架构边界
- 明确它如何尽量参考 advisor-tool 的机制，同时保持 MetaWeb 的隐私与策略边界
- 让后续实现能从 V1 的 `manual + suggest` 平滑演进到更自动的模式

---

## 2. 设计原则

### 2.1 Trigger Engine 是“决策层”，不是 transport 层

trigger engine 的职责是：

- 观察任务轨迹
- 判断是否值得 Ask Master
- 产出建议或自动发起候选

它不负责：

- 自己直接发 `simplemsg`
- 自己定义 `master_request` schema
- 自己替代 caller flow / preview / confirmation

也就是说：

- trigger engine 只负责“是否该问”
- caller flow 负责“怎么问”

### 2.2 不依赖 CoT

Ask Master 的触发不能建立在“读取模型内部思维链”之上。

它只能基于 host 可见、可记录、可解释的信号，例如：

- 用户消息
- assistant 公开输出
- 工具调用与结果
- 测试失败
- 命令失败
- 代码 diff
- todo / 计划推进情况

### 2.3 总开关必须是硬门控

`askMaster.enabled = false` 时：

- 不应继续运行 Ask Master 触发判断
- 不应继续收集 Ask Master 上下文
- 不应继续给出 suggest
- 不应继续自动发起

这必须是一个硬停止，而不是“只是不提示”。

### 2.4 V1 先做 `manual + suggest`

从产品推进顺序上，V1 的公开能力应以：

- `manual`
- `suggest`

为主。

`auto` 需要在架构上预留，但不应在 V1 中被实现成默认公开路径。

### 2.5 尽量参考 advisor-tool，但不盲抄

我们要尽量参考 advisor-tool 的产品体验：

- 不是每次都靠用户手工拼请求
- 在合适时机介入
- 自动打包上下文
- 让本地 Agent 像可以“请教另一个 Agent”

但 MetaWeb 版本需要额外保留：

- 策略总开关
- 可解释的触发依据
- 逐步演进到低摩擦模式

### 2.6 触发引擎与上下文收集器要解耦

trigger engine 只应消费“可用的上下文摘要与观测信号”，而不应与具体 collector 紧耦合。

它应依赖的输入是：

- 结构化观察值
- 聚合后的风险信号

而不是：

- 对 host 内部某个专用 transcript 格式的硬编码依赖

---

## 3. 与现有代码的关系

### 3.1 可直接借鉴的现有骨架

当前仓库中，以下实现可作为后续开发的技术参考：

- `src/core/a2a/delegationPolicy.ts`
  - 当前 confirmation / policy 决策骨架
- `src/core/a2a/sessionTypes.ts`
  - 已有 policyMode 与 session state 相关枚举骨架
- `src/core/delegation/remoteCall.ts`
  - 现有 confirmation policy 与 traceId 组织经验
- `src/core/a2a/publicStatus.ts`
  - 现有 public status 投影经验

### 3.2 不应直接照搬的部分

以下内容不应直接被视为 Ask Master trigger engine：

- 旧 remote call 的 spend / payment 策略
- 旧 services call 的 manual action 逻辑
- skill 层的自然语言意图识别

这些可以提供局部经验，但不等于 Ask Master 的触发决策系统。

### 3.3 设计策略

推荐策略是：

- 借鉴已有 policy decision shape
- 为 Ask Master 定义自己的 observation / decision / suppression 层
- 让它输出给 caller flow，而不是自己越层执行

---

## 4. Trigger Engine 的位置

Ask Master 的运行分层建议如下：

1. `Context Collector`
   - 收集 host 可见任务轨迹
2. `Trigger Engine`
   - 判断是否值得 Ask Master
3. `Master Selector`
   - 选择合适的 Master
4. `Caller Flow`
   - preview / confirmation / send / trace

Trigger Engine 位于中间，只做“决策输出”，不直接负责上下文采集或发送。

---

## 5. 输入模型：Trigger Observation

### 5.1 设计目标

Trigger Engine 需要一套稳定的、与 host 内部实现相对解耦的观测输入。

V1 建议把可观测输入抽象成：

```ts
type TriggerObservation = {
  now: number;
  hostMode: string;
  workspaceId?: string | null;
  userIntent?: {
    explicitlyAskedForMaster: boolean;
    explicitlyRejectedSuggestion: boolean;
  };
  activity?: {
    recentUserMessages: number;
    recentAssistantMessages: number;
    recentToolCalls: number;
    recentFailures: number;
    repeatedFailureCount: number;
    noProgressWindowMs: number | null;
  };
  diagnostics?: {
    failingTests: number;
    failingCommands: number;
    repeatedErrorSignatures: string[];
    uncertaintySignals: string[];
  };
  workState?: {
    hasPlan: boolean;
    todoBlocked: boolean;
    diffChangedRecently: boolean;
    onlyReadingWithoutConverging: boolean;
  };
  directory?: {
    availableMasters: number;
    trustedMasters: number;
    onlineMasters: number;
  };
};
```

### 5.2 可观测信号来源

这些 observation 应只来自 host 可见层，例如：

- 用户消息
- assistant 可见输出
- tool 结果
- 测试日志
- 命令输出
- diff / todo / plan
- 本地 `master-service` 目录

### 5.3 明确不采集的内容

trigger engine 不应依赖：

- CoT
- caller 未公开给系统的私人输入
- provider 侧私有状态
- caller 本地隐藏文件全文

---

## 6. 输出模型：Trigger Decision

### 6.1 设计目标

Trigger Engine 的输出不应是“直接发请求”，而应是一个明确的决策结果。

V1 建议抽象为：

```ts
type TriggerDecision =
  | {
      action: 'no_action';
      reason: string;
    }
  | {
      action: 'suggest';
      reason: string;
      confidence: number;
      candidateMasterKind?: string | null;
    }
  | {
      action: 'auto_candidate';
      reason: string;
      confidence: number;
      candidateMasterKind?: string | null;
    }
  | {
      action: 'manual_requested';
      reason: string;
    };
```

### 6.2 `manual_requested`

当用户明确表达：

- “去问问 Debug Master”
- “请教一下某个 Master”

Trigger Engine 应直接输出：

- `manual_requested`

这类决策不需要再经过“卡住评分”。

### 6.3 `suggest`

当系统认为：

- 值得 Ask Master
- 但不应自动发起

则输出：

- `suggest`

caller flow 后续应把它投影成：

- 一条建议
- 一个 preview 候选
- 等待用户确认

### 6.4 `auto_candidate`

当系统满足更严格条件、且策略允许更自动模式时，可输出：

- `auto_candidate`

注意：

- `auto_candidate` 不是“已经发送”
- 它表示“满足自动发起候选条件”
- 是否真正自动发送，仍要经过 policy gate

### 6.5 `no_action`

如果没有足够理由，则返回：

- `no_action`

这同样是一个明确决策，而不是“没有输出”。

---

## 7. 三种触发模式

### 7.1 `manual`

定义：

- 仅当用户明确要求 Ask Master 时才进入 caller flow

特征：

- 最稳
- 最易验收
- 不依赖 stuck 判断

### 7.2 `suggest`

定义：

- Trigger Engine 在满足条件时，向用户提出“现在值得问 Master”的建议

特征：

- 具备 advisor-tool 的半自动体验雏形
- 仍由用户决定是否继续
- 是 V1 与 V2 之间最关键的过渡模式

### 7.3 `auto`

定义：

- 在满足条件、且本地策略允许时，系统可自动进入 Ask Master caller flow

注意：

- 这不等于一定跳过确认
- `auto` 是“自动进入流程”
- 是否真正无确认发送，仍取决于 `confirmationMode`

### 7.4 V1 公开行为

V1 建议：

- 公开支持 `manual`
- 公开支持 `suggest`
- `auto` 只做架构预留，不作为默认公开能力

---

## 8. “值得请教 Master” 的可观测信号

### 8.1 正向触发信号

以下信号可以提升 Ask Master 触发分数：

- 同一测试或命令连续失败
- 同类错误签名重复出现
- assistant 在公开输出中表达明显不确定或卡住
- 多轮尝试后没有实质推进
- 长时间只有搜索/阅读，没有形成收敛动作
- 当前任务复杂度高且风险上升
- 已存在在线、可信、合适的 Master

### 8.2 负向抑制信号

以下信号可以压低或阻止触发：

- 用户刚明确拒绝过建议
- 最近已经问过同类 Master
- 当前任务仍有明显推进
- 当前问题过于简单或尚未进行基本尝试
- 当前没有可用在线 Master
- Ask Master 总开关关闭

### 8.3 “卡住”不是唯一触发原因

需要强调：

- Ask Master 不应被狭义地等同于“卡住了才问”

其他典型时机还包括：

- 初步探索后需要更强判断
- 收尾前需要风险复核
- 高风险改动前需要第二视角

### 8.4 触发信号的可解释性

V1 trigger engine 应尽量输出“为什么建议询问”的可解释原因，例如：

- “同一测试已连续失败 3 次”
- “最近 15 分钟无实质代码推进”
- “当前错误与现有 Debug Master specialization 高度匹配”

这样后续 `suggest` 才像一个可理解的产品能力，而不是黑箱打断。

---

## 9. 抑制、冷却与限流

### 9.1 设计目标

如果没有抑制机制，Ask Master 会很容易变成：

- 频繁打扰
- 重复建议
- 用户一拒绝又继续来

因此 suppression 是 trigger engine 的核心组成部分，不是可选优化。

### 9.2 V1 建议最小抑制维度

至少可按以下维度做本地抑制：

- 当前任务 / 当前 trace
- `masterKind`
- 问题签名
- 用户最近一次明确拒绝

### 9.3 V1 建议最小策略

例如：

- 同一 trace 下，最多 suggest 1 次
- 用户明确拒绝后，一段时间内不再 suggest 同类问题
- 同一错误签名在短时间内不反复 suggest
- 手动发起后，不再立刻自动 suggest 同一个问题

### 9.4 `auto` 的额外抑制

当将来支持 `auto` 时，应在 `suggest` 基础上再加更严格条件，例如：

- trusted master 命中
- 历史上该类问题的建议质量稳定
- 当前上下文质量足够高
- 本地 confirmation policy 允许低摩擦继续

---

## 10. 配置与策略消费

### 10.1 `askMaster.enabled`

这是最高优先级硬门控。

当为 `false` 时：

- 不收集 Ask Master 触发所需 observation
- 不运行 trigger evaluation
- 不生成 suggest
- 不生成 auto candidate

### 10.2 `askMaster.triggerMode`

可支持：

- `manual`
- `suggest`
- `auto`

语义建议：

- `manual`
  - 只接受用户明确请求
- `suggest`
  - 允许生成建议，但不自动继续
- `auto`
  - 允许生成 auto candidate，并进入更自动流程

### 10.3 `askMaster.confirmationMode`

Trigger Engine 本身不做确认 UI，但它必须消费这个配置，原因是：

- `auto` 是否真正能无确认前进
- `suggest` 是否应更积极
- 某些 trusted master 是否能降低摩擦

V1 可先默认：

- `always`

但架构上要允许未来有：

- `sensitive_only`
- `never`

### 10.4 `askMaster.contextMode`

Trigger Engine 不直接打包 context，但它需要知道：

- 当前是否允许使用 `compact`
- 是否允许使用 `standard`
- 是否允许使用 `full_task`

原因是：

- 没有足够上下文质量时，不应给出过强的 auto candidate

### 10.5 `askMaster.trustedMasters`

trusted 列表在 trigger engine 里的作用应是：

- 提升匹配优先级
- 影响 `auto_candidate` 可达性
- 影响 suppression 与风险权衡

但不应被硬编码成：

- 只要 trusted 就永远自动发

---

## 11. Trigger Engine 与 Master Selector 的关系

### 11.1 先后关系

建议顺序为：

1. Trigger Engine 先判断“是否值得问”
2. Master Selector 再判断“问谁”

### 11.2 可选候选 hint

Trigger Engine 可以输出：

- `candidateMasterKind`
- `candidate traits`

但不应直接承担完整目录选择逻辑。

### 11.3 没有可用 Master 时的决策

如果 observation 显示：

- 当前没有在线、可信、匹配的 Master

则 trigger engine 应倾向于：

- `no_action`

而不是继续给出一个无法执行的 suggest。

---

## 12. Trigger Engine 与 Caller Flow 的关系

### 12.1 调用边界

Trigger Engine 产出决策后，由 caller flow 接手。

Caller flow 负责：

- 生成 preview
- 处理 confirmation
- 发送 `master_request`
- 写 trace

### 12.2 `suggest` 的落地

当 Trigger Engine 输出 `suggest` 时，caller flow 应：

- 在 host 中向用户展示“建议询问”
- 若用户接受，再进入正常 preview / confirmation

### 12.3 `auto_candidate` 的落地

当 Trigger Engine 输出 `auto_candidate` 时，caller flow 仍需经过：

- policy gate
- preview / confirmation 策略

V1 不要求真的放开无确认自动发送。

---

## 13. V1 与后续阶段的切分

### 13.1 V1 必做

V1 的 Trigger Engine 只需做到：

- 明确 `manual`
- 具备最小 `suggest`
- 可解释的触发理由
- 基本 suppression
- 严格遵守总开关
- 不依赖 CoT

### 13.2 V1 不强求

V1 不强求：

- 完整 `auto`
- 复杂统计评分模型
- 跨任务长期学习
- 多 Master 自动排序联动

### 13.3 后续阶段可扩展

后续可增加：

- 更稳定的 stuck scoring
- 更强的 trusted auto flow
- 不同 Master 的触发策略差异化
- 更细粒度的 suppression key
- 更丰富的上下文质量评估

---

## 14. 测试与 TDD 要求

后续实现这份 spec 时，至少应覆盖：

- `askMaster.enabled = false` 时完全不触发
- `manual` 模式下，只有显式请求才进入 Ask Master
- `suggest` 模式下，满足条件会给出 `suggest`
- 用户明确拒绝后能触发 suppression
- 同一 trace 不重复 suggest
- 没有在线/匹配 Master 时返回 `no_action`
- `auto` 未公开启用时不会越过策略直接发送
- “卡住”判断不依赖 CoT 输入
- 触发理由可解释
- trusted master 只影响候选与策略，不直接绕过所有门控

推荐测试分层：

- 单元测试
  - observation normalizer
  - trigger evaluator
  - suppression decision
  - policy gate
- 集成测试
  - suggest -> caller flow handoff
  - manual request -> trigger decision -> caller flow handoff
- e2e 测试
  - 本地任务出现重复失败后触发 suggest
  - 用户接受 suggest 后进入 Ask Master preview

---

## 15. V1 范围与非目标

### 15.1 V1 范围

V1 Trigger Engine 应做到：

- 总开关硬门控
- `manual` 触发
- 最小 `suggest`
- 基本 suppression / cooldown
- 可解释理由
- 与 caller flow、selector、context collector 解耦

### 15.2 V1 非目标

V1 不做：

- 无确认自动发送
- 依赖 CoT 的触发机制
- 黑箱不可解释评分系统
- provider 侧主动反向调度 caller

---

## 16. 一句话总结

这一层的正确形态是：

> Trigger Engine 是 Ask Master 的“是否值得问”决策层：它基于 host 可见信号做可解释的 manual/suggest/auto-candidate 判断，受总开关与 suppression 约束，但把真正的 preview、发送与 trace 回写留给 caller flow。
