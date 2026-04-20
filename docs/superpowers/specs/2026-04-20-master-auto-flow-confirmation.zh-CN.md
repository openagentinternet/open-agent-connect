# Ask Master Phase-3 Auto Ask Flow 与 Confirmation 设计说明

**日期：** 2026-04-20

## 1. 文档目标

本文档定义 Ask Master phase-3 中 auto trigger 进入实际 caller flow 的产品路径。

它只解决这些问题：

- `auto_candidate` 如何进入真正的 Ask Master runtime
- auto preview 如何 materialize
- 用户如何确认、拒绝、忽略
- direct send 如何仍然保持 trace 与 response integrate 一致

本文档**不处理**：

- ask-worthiness detector 的打分细节
- provider 响应 schema
- payment / marketplace

---

## 2. 设计原则

### 2.1 auto flow 必须复用现有 caller flow

不能新起一套：

- pending state
- trace 状态
- dispatch 通路
- timeout 语义

phase-3 只是把“进入 ask 流的方式”从 manual/suggest 扩展到 auto。

### 2.2 auto preview 不是 suggest

phase-2 的 suggest 是：

- “要不要问”

phase-3 的 auto preview 是：

- “系统已经帮你准备好了问法，等你确认或按策略继续”

两者不能混淆。

### 2.3 direct send 也必须留下 preview snapshot

即使某次符合低摩擦 direct send：

- 也必须先 materialize 一份 preview snapshot
- 只是这份 snapshot 不一定要求用户手动点确认

原因：

- trace / replay / debug 需要稳定基准

### 2.4 auto flow 必须允许用户明确拒绝

即使系统已经进入 auto prepared preview：

- 用户仍应能拒绝这次 ask
- rejection 必须进入 feedback / cooldown

---

## 3. 建议分层

phase-3 建议新增：

1. `masterAutoOrchestrator`
   - 接收 `auto_candidate`
   - 调 selector / collector / packager / policy
   - 决定进入 preview 还是 direct send
2. 现有 `masterHostAdapter`
   - 继续负责 machine-first host bridge
3. 现有 `master ask` runtime
   - 负责 pending / dispatch / response integrate

关键约束：

- auto orchestrator 不直接发 `simplemsg`
- auto orchestrator 只编排，不复制 runtime

---

## 4. Auto Flow 生命周期

### 4.1 prepare

当 `auto_candidate` 通过 selector + policy + safety 后：

- 系统收集上下文
- 生成 request draft
- 生成 preview snapshot
- 生成或更新 Ask Master trace

此时 canonical status 建议为：

- `awaiting_confirmation`
  - 对 `preview_confirm` 模式
- `requesting_remote`
  - 对 `direct_send` 模式

### 4.2 confirm

若 friction mode 是 `preview_confirm`：

- host 收到一条 machine-first 结果，表示：
  - 系统因 stuck 或高风险 checkpoint 自动准备了 Ask Master preview
  - 推荐 target 是谁
  - 为什么触发
  - 当前等待确认

用户可以：

- 确认
- 拒绝
- 稍后再说

### 4.3 direct send

若 friction mode 是 `direct_send`：

- runtime 直接复用 pending snapshot 发送
- 不再额外要求用户确认
- 但 trace 中必须记录：
  - 为什么无需确认
  - 当前 confirmationMode
  - safety summary
  - selected master 是否 trusted

### 4.4 response integrate

无论是 preview_confirm 还是 direct_send：

- response integrate 必须完全复用现有 ask runtime
- host-facing 结果仍回到当前会话

---

## 5. Host Bridge Surface

### 5.1 不新增 transport，但可新增 host-action 语义

phase-3 可在现有 `master host-action` 基础上补齐：

```ts
type HostAskMasterAction =
  | { kind: 'manual_ask'; ... }
  | { kind: 'accept_suggest'; ... }
  | { kind: 'reject_suggest'; ... }
  | { kind: 'confirm_auto_preview'; traceId: string }
  | { kind: 'reject_auto_preview'; traceId: string; reason?: string | null };
```

也可以复用已有 `metabot master ask --trace-id ... --confirm` 来确认 auto preview，但 host-facing contract 必须明确：

- 这次确认来源于 `triggerMode=auto`

### 5.2 host-facing 返回建议

建议 machine-first 返回最少包括：

```ts
type AutoPreparedAskResult = {
  traceId: string;
  requestId: string | null;
  triggerMode: 'auto';
  frictionMode: 'preview_confirm' | 'direct_send';
  preview: Record<string, unknown>;
  autoReason: string;
  confidence: number;
};
```

---

## 6. 与现有 pending ask 的关系

### 6.1 auto prepared preview 也需要 pending snapshot

phase-2 已经证明：

- preview 后继续 confirm/send，必须复用稳定 snapshot

phase-3 不能回退到：

- auto preview 展示一次
- confirm 时重新收集上下文、重新选 target、重新打包

### 6.2 direct send 前仍需持久化 snapshot

即使不要求确认：

- 也需要先写 pending snapshot
- 再调用 send path

这样才能保证：

- trace 重建一致
- 失败重放可解释

---

## 7. 用户交互语义

### 7.1 auto preview 文案核心

auto preview 应让用户知道：

- 系统判断当前值得请教 Master，原因可能是 stuck、review checkpoint 或 wrap-up risk
- 系统建议 / 准备向哪个 Master 求助
- 当前将发送哪些经过 safety/policy 过滤的上下文摘要与 artifacts
- 这次是否需要确认

### 7.2 用户拒绝的语义

用户拒绝 auto preview 后：

- 不应立刻再次 auto ask
- rejection 需要携带 traceId / optional reason
- 当前 trace 应写入 feedback state

### 7.3 用户忽略的语义

如果 host 中用户没有立即回应：

- 可保持 pending preview
- 但不能反复刷出同一 auto preview

---

## 8. Timeout / Late Reply 保持不变

phase-3 明确不能改变：

- `timed_out` 只是本地停止等待
- late reply 仍可能之后到达
- caller flow 的 timeout 语义与 phase-1 / phase-2 保持一致

auto flow 只改变：

- ask 是如何开始的

不改变：

- 远端返回晚了以后怎么处理

---

## 9. 测试要求

至少覆盖：

- auto candidate 能 materialize 成 preview
- auto preview confirm 后走入正常 send/completed
- direct send 仍保留 preview snapshot
- `sensitive_only` 下只有 `trusted + non-sensitive` 能 direct send
- reject auto preview 会写入 feedback/cooldown
- auto timeout / late reply 有 dedicated e2e regression
- final preview snapshot 与实际发送 payload 都能证明未包含 secrets / whole-repo implicit upload
- timeout semantics unchanged

---

## 10. 小结

phase-3 的 Auto Ask Flow，本质上是把“系统认为现在该问 Master 了”真正接成一条对用户可感知、对 runtime 可复用、对 trace 可解释的执行闭环。它不是新的 transport，也不是新的 CLI 产品，而是 Ask Master 主线能力的自动化升级。
