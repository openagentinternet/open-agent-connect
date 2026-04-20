# Ask Master Phase-3 Host Observation 与 Ask-Worthiness Detector 设计说明

**日期：** 2026-04-20

## 1. 文档目标

本文档定义 Ask Master phase-3 的 `Host Observation Bridge + Ask-Worthiness Detector`。

它只解决这些问题：

- Ask Master 应从哪些 host 可见信号感知“当前值得请教 Master”
- 这些信号如何归一为统一 observation frame
- detector 如何给出结构化、可解释的判定
- 如何确保不读取 CoT、不越界采集隐私

本文档**不处理**：

- auto flow 的 preview / confirmation 编排
- `master_request / master_response` schema
- provider fixture 的响应设计
- marketplace / 支付 / rating

---

## 2. 设计原则

### 2.1 只基于 host 可见事实

detector 只能基于：

- 用户消息
- assistant 对外可见输出
- tool 调用结果
- 命令与测试失败
- diff / plan / todo 的外显状态
- trace / session / runtime 中已有的 machine-first 状态

不能基于：

- CoT
- 模型私有 scratchpad
- 未经过滤的私密文件全文

### 2.2 observation 与 detector 解耦

observation bridge 负责：

- 采样
- 归一
- 去敏

detector 负责：

- 打分
- 分类
- 给出 `reasons`

不能把 host 特定逻辑直接硬编码进 detector。

### 2.3 必须可解释

每一次 auto ask 候选都必须能回答：

- 系统看到了什么事实
- 为什么认为当前值得问 Master
- 推荐的是哪类 Master

不能只输出一个黑箱布尔值。

### 2.4 先 deterministic，再谈更复杂模型

phase-3 首版优先使用规则与阈值：

- repeated failures
- repeated error signatures
- no progress window
- blocked todo / plan
- 只读不收敛
- patch risk / wrap-up risk / review checkpoint

后续再考虑更复杂的 scoring 模型。

---

## 3. 现有实现基线

当前代码里已经有：

- `src/core/master/masterTriggerEngine.ts`
  - 接收最小 `TriggerObservation`
  - 支持 `manual_requested / suggest / auto_candidate`
- `src/core/master/masterContextCollector.ts`
  - 从 host 输入里收集最小 ask draft 所需上下文
- `src/cli/runtime.ts`
  - 已有 evolution observation 相关能力，但 Ask Master 还没有真正的 host telemetry ingress

当前缺口在于：

- observation 来源仍偏窄
- Ask Master 还没有真正从 host session/tool 事件进入自身 observation 输入面的桥接层
- 没有独立 detector 层
- `auto_candidate` 仍主要是内部占位

---

## 4. Host Observation Frame

### 4.1 建议新增中立 observation 模型

```ts
type MasterHostObservationFrame = {
  now: number;
  traceId: string | null;
  hostMode: string;
  workspaceId: string | null;
  userIntent: {
    explicitlyAskedForMaster: boolean;
    explicitlyRejectedSuggestion: boolean;
    explicitlyRejectedAutoAsk: boolean;
  };
  activity: {
    recentUserMessages: number;
    recentAssistantMessages: number;
    recentToolCalls: number;
    recentFailures: number;
    repeatedFailureCount: number;
    noProgressWindowMs: number | null;
    lastMeaningfulDiffAt: number | null;
  };
  diagnostics: {
    failingTests: number;
    failingCommands: number;
    repeatedErrorSignatures: string[];
    uncertaintySignals: string[];
    lastFailureSummary: string | null;
  };
  workState: {
    hasPlan: boolean;
    todoBlocked: boolean;
    diffChangedRecently: boolean;
    onlyReadingWithoutConverging: boolean;
    activeFileCount: number;
  };
  directory: {
    availableMasters: number;
    trustedMasters: number;
    onlineMasters: number;
  };
  hints: {
    candidateMasterKindHint: string | null;
    preferredMasterName: string | null;
    reviewCheckpointRisk: boolean;
  };
};
```

### 4.2 来源示例

- `recentFailures`
  - 最近 N 个 tool / shell / test 调用的失败数
- `repeatedErrorSignatures`
  - 归一化后的最近错误签名
- `noProgressWindowMs`
  - 一段时间内没有 meaningful diff / no resolved failure
- `onlyReadingWithoutConverging`
  - 连续多轮主要在读文件 / 搜索 / trace inspection，但没有新方案落地
- `reviewCheckpointRisk`
  - 准备提交 patch、收尾或做大改动，但当前回归风险/不确定性高

### 4.3 不进入 frame 的内容

- 用户未显式同意传输的整仓内容
- `.env`、wallet、credentials、keys
- tool 私有 debug buffer
- host agent 的 private reasoning

---

## 5. Ask-Worthiness Detector 输出模型

### 5.1 输出目标

建议新增：

```ts
type MasterAskWorthinessAssessment = {
  opportunityType: 'none' | 'stuck' | 'review_checkpoint' | 'wrapup_risk';
  stuckLevel: 'none' | 'weak' | 'strong' | 'critical';
  confidence: number;
  reasons: string[];
  candidateMasterKind: string | null;
  autoEligible: boolean;
};
```

### 5.2 最小规则集

建议 phase-3 首版的强信号：

- `repeatedFailureCount >= 2`
- `failingTests > 0` 且同类错误重复
- `noProgressWindowMs >= configured minNoProgressWindowMs`
- `todoBlocked = true`
- `onlyReadingWithoutConverging = true` 且无 diff
- `uncertaintySignals` 命中明确“卡住/不确定/不收敛”语义
- `reviewCheckpointRisk = true`

### 5.3 弱信号

- 单次命令失败
- 最近只有一轮阅读，没有足够时间窗口
- 没有任何在线 Master 可用

这些最多导致：

- `stuckLevel = weak`
- `autoEligible = false`
- 可继续观察，但不应立即 auto ask

### 5.4 `candidateMasterKind`

phase-3 首版建议保持可解释规则：

- 明显是 bug / test / failure signature -> `debug`
- 明显是 review / patch risk / regression concern -> `review`
- 其它情况允许返回 `null`，交由 selector fallback

---

## 6. Observation Bridge 集成点

### 6.1 CLI / host runtime

`src/cli/runtime.ts` 与新的 host signal bridge 需要共同承担：

- 聚合最近可见运行时事件
- 为 Ask Master 构造 `MasterHostObservationFrame`
- 把 frame 传给 trigger engine / auto orchestrator

### 6.2 Context Collector

collector 不应直接承担 stuck 判断，但可以产出：

- 最近失败摘要
- diff 摘要
- relevant file shortlist

供 bridge 复用。

### 6.3 Trace / state store

observation frame 本身不需要完整落盘，但需要：

- 重要摘要可投影进 auto trace metadata
- 保证后续可以解释为什么系统自动 ask

---

## 7. 隐私与安全边界

### 7.1 observation 不是 payload

Host Observation Frame 的目的，是让系统决定“值不值得问”。

它不等于真正发给 provider 的 payload。

因此可以包含：

- 计数
- 分类
- 错误签名摘要

但不应直接包含：

- 大段原始终端输出
- 原始代码全文
- 私密文件内容

### 7.2 敏感路径默认遮蔽

建议 bridge 默认识别并遮蔽：

- `.env`
- `*.pem`
- `*.key`
- `wallet*`
- `credentials*`
- 包含 token / secret / private key 关键词的路径

---

## 8. 测试要求

至少覆盖：

- detector 不依赖 CoT
- repeated failures 与 no-progress window 能稳定产生 `strong` 以上 assessment
- review checkpoint / wrap-up risk 能稳定产生 `candidateMasterKind = review`
- 单次失败不会误触发 `autoEligible=true`
- 无在线 Master 时不应把 assessment 直接投影成 auto ask
- path / content 中的 secrets 不进入 observation frame

---

## 9. 小结

phase-3 的 Host Observation 与 Ask-Worthiness Detector，本质上是 Ask Master 自动能力的输入地基。只有把“系统到底看到了什么”和“系统为什么认为当前值得问 Master”做成中立、可解释、可测试的层，后续的 auto ask 才不会沦为黑箱行为。
