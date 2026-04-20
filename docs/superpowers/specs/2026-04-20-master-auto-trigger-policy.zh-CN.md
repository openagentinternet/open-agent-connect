# Ask Master Phase-3 Auto Trigger 与 Policy 设计说明

**日期：** 2026-04-20

## 1. 文档目标

本文档定义 Ask Master phase-3 中 `triggerMode=auto` 的真实产品语义，以及 `confirmationMode=always / sensitive_only / never` 在 auto flow 下的行为边界。

它只解决这些问题：

- 什么情况下 `auto_candidate` 可以真正继续
- trusted、official、online、sensitivity 如何共同作用
- 哪些场景仍必须确认
- 哪些场景允许低摩擦甚至自动发送

本文档**不处理**：

- ask-worthiness detector 的信号采样细节
- preview UI 具体文案
- provider fixture 的响应内容设计

---

## 2. 设计原则

### 2.1 `auto` 不是跳过所有门控

`triggerMode=auto` 的含义是：

- 系统可主动发起 Ask Master 编排

不等于：

- 系统默认可以偷偷发送任何上下文

### 2.2 confirmation policy 必须真实生效

phase-2 中：

- `always` 是唯一公开稳定模式
- `sensitive_only` / `never` 主要还停留在配置与局部测试层

phase-3 需要把它们变成真正的 product semantics。

### 2.3 trusted 降低摩擦，但不是越权

`trustedMasters` 可影响：

- selector 排序
- auto ask 门槛
- confirmation friction

但不能绕过：

- 总开关
- context safety
- rate limit
- trace 记录

### 2.4 “无确认”必须是显式高级能力

即便用户长期目标是接近 advisor-tool 的低摩擦调用，phase-3 也不应把无确认自动发送做成默认行为。

建议规则：

- 默认仍是 `always`
- `sensitive_only` 作为首个低摩擦公开路径
- `never` 只有在 trusted + safe payload + 显式 auto policy 打开时才允许

---

## 3. 现有代码基线

当前已有：

- `AskMasterTriggerMode = 'manual' | 'suggest' | 'auto'`
- `AskMasterConfirmationMode = 'always' | 'sensitive_only' | 'never'`
- `masterTriggerEngine` 中已有 `auto_candidate`
- `masterPolicyGate` 中 `auto_candidate` 仍被显式拦截：
  - `Auto Ask Master is not exposed in the phase-2 host flow.`

因此 phase-3 的任务不是重命名，而是把现有占位语义真正落地。

---

## 4. 建议配置模型

### 4.1 在现有 askMaster config 上最小扩展

建议 phase-3 增加：

```ts
type AskMasterAutoPolicyConfig = {
  minConfidence: number;
  minNoProgressWindowMs: number;
  perTraceLimit: number;
  globalCooldownMs: number;
  allowTrustedAutoSend: boolean;
};
```

并扩展：

```ts
type AskMasterConfig = {
  enabled: boolean;
  triggerMode: 'manual' | 'suggest' | 'auto';
  confirmationMode: 'always' | 'sensitive_only' | 'never';
  contextMode: 'compact' | 'standard' | 'full_task';
  trustedMasters: string[];
  autoPolicy: AskMasterAutoPolicyConfig;
};
```

### 4.2 默认值建议

```ts
autoPolicy: {
  minConfidence: 0.9,
  minNoProgressWindowMs: 300_000,
  perTraceLimit: 1,
  globalCooldownMs: 1_800_000,
  allowTrustedAutoSend: false,
}
```

这些默认值的目标是：

- phase-3 刚发布时尽量保守
- 避免用户一打开 `auto` 就频繁被打扰

其中：

- `minNoProgressWindowMs` 必须被 detector 真正消费
- 它定义“仅靠 no-progress 就足以进入 strong auto signal”的最小窗口

---

## 5. Auto Trigger 决策模型

### 5.1 `auto_candidate` 的前置条件

建议至少同时满足：

- `config.enabled = true`
- `config.triggerMode = auto`
- ask-worthiness assessment `autoEligible = true`
- `confidence >= autoPolicy.minConfidence`
- 若主要依据是 no-progress，则 `noProgressWindowMs >= autoPolicy.minNoProgressWindowMs`
- 存在匹配、在线、支持当前 host 的 selected master
- 未命中 per-trace limit / cooldown / rejection feedback

### 5.2 候选与正式继续的区别

建议区分两步：

1. `auto_candidate`
   - trigger engine 给出的内部决策
2. `auto_continue`
   - policy + selector + safety 全部通过后，可进入 preview 或 send

这样 trace 能明确区分：

- “系统觉得值得问”
- “系统真的开始准备 Ask Master”

### 5.3 auto 与 suggest 的差异

`suggest`：

- 系统给出建议
- 用户决定是否接受

`auto`：

- 系统直接准备 Ask Master preview
- 用户只需确认发送，或在低摩擦策略下无需确认

两者都要留下 trace，但产品感受不同。

---

## 6. Confirmation Policy 语义

### 6.1 `always`

行为：

- auto flow 永远停在 preview
- 用户必须明确确认

适用：

- 默认配置
- 高敏场景
- 新用户初次体验

### 6.2 `sensitive_only`

行为：

- 若 packager 标记 payload `isSensitive = true`，仍要求确认
- 只有当 `payload 非敏感 + selected master trusted` 时，才允许 direct send
- 非敏感但 untrusted 的目标，也必须回退 preview

适用：

- 用户已经接受 auto ask，但仍希望敏感上下文必须人工看一眼

### 6.3 `never`

行为：

- 只有当以下条件同时满足，才允许直接发送：
  - `allowTrustedAutoSend = true`
  - selected master 是 trusted
  - payload 非敏感
  - 未命中 rate limit / cooldown

否则即使 `confirmationMode=never`，也应退回 preview。

这样做的原因是：

- `never` 不应把安全和可解释性完全绕掉

---

## 7. Sensitivity Gate

### 7.1 packager 需要输出 sensitivity

phase-3 中，packager 不只需要输出 request draft，还需要输出：

```ts
type MasterPayloadSafetySummary = {
  isSensitive: boolean;
  reasons: string[];
};
```

### 7.2 最小敏感规则

以下任一命中，都建议判定为敏感：

- artifact 含 secret/token/key 关键词
- 涉及 `.env`、wallet、credential、pem/key 文件
- context mode 升级到 `full_task`
- 大段未脱敏终端输出

### 7.3 敏感时的强制策略

即使 `confirmationMode=never`：

- 只要 `isSensitive = true`
- 就必须退回 preview / confirm

---

## 8. Rate Limit / Cooldown

### 8.1 需要限制的原因

auto ask 的最大风险不是“做不到”，而是“做得太多”。

因此 phase-3 policy 必须至少支持：

- per-trace limit
- global cooldown
- 最近 reject 的问题窗口

### 8.2 最小策略

- 同一 trace 最多自动准备一次 preview
- 刚被用户 reject 的同类问题，在 cooldown 内不得再次 auto ask
- 刚发生 timeout 的目标 master，不应立刻再次 auto send

---

## 9. Policy 输出模型

建议在现有 `MasterPolicyDecision` 之上扩展：

```ts
type MasterAutoPolicyDecision = {
  allowed: boolean;
  blockedReason: string | null;
  selectedFrictionMode: 'preview_confirm' | 'direct_send';
  requiresConfirmation: boolean;
  contextMode: 'compact' | 'standard' | 'full_task';
  sensitivity: {
    isSensitive: boolean;
    reasons: string[];
  };
};
```

这样 host flow 不需要自己猜：

- 为什么还得确认
- 为什么这次可以直接发

---

## 10. 测试要求

至少覆盖：

- `triggerMode=auto` 时能真正继续到 auto flow
- trusted + non-sensitive + `sensitive_only` 可 direct send
- non-sensitive 但 untrusted 的目标在 `sensitive_only` 下仍必须 preview
- `never` 在不满足 trusted/safe 条件时会自动回退 preview
- 覆盖 `minNoProgressWindowMs` 的阈值变化，证明 detector/gate 不会忽略该配置
- reject / cooldown / rate limit 会阻止 auto ask
- `enabled=false` 仍是硬门控
- preview snapshot 与实际发送 payload 的 safety summary 一致且可断言

---

## 11. 小结

phase-3 的 Auto Trigger 与 Policy，本质上是在现有 `manual + suggest` Ask Master 之上补齐真正的“半自动/自动摩擦控制层”。它决定的不是“是否支持 auto 这个词”，而是用户是否会信任系统在合适的时候替自己准备一次真正可发送的 Ask Master 请求。
