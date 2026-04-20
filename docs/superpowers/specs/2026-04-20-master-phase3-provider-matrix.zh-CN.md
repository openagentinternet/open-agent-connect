# Ask Master Phase-3 Provider Matrix 与验收设计说明

**日期：** 2026-04-20

## 1. 文档目标

本文档定义 Ask Master phase-3 需要具备的 provider fixture matrix 与验收矩阵。

它只解决这些问题：

- phase-3 至少要有哪些官方 Master fixture
- 为什么不能继续只靠 Debug Master 验收
- auto flow、selector、trusted policy 应如何通过 e2e 验证

本文档**不处理**：

- provider 上链发布的 UI
- marketplace / pricing 扩展
- 真实远端大模型接入方案

---

## 2. 设计原则

### 2.1 不再只靠 Debug Master

如果 phase-3 仍只使用 Official Debug Master：

- selector 对 `masterKind` 的价值无法真正验证
- auto ask 的不同问题类型无法覆盖
- trusted / official / ranking 的通用性也无法证明

因此 phase-3 至少应再加入一个官方 fixture。

### 2.2 fixture 必须结构化、可复现、可离线跑

phase-3 验收不能依赖：

- 外部网络上某个真实 provider 恰好在线
- 人工临场发消息配合

官方 fixture 必须：

- 本地可跑
- 输入输出稳定
- 能覆盖 trace / timeout / direct send / confirmation policy

---

## 3. 建议的官方 Provider Matrix

### 3.1 必选：Official Debug Master

继续保留：

- `serviceName = official-debug-master`
- `displayName = Official Debug Master`
- `masterKind = debug`

职责：

- 处理 bug / test failure / command failure / stuck in debugging

### 3.2 Phase-3 新增：Official Review Master

建议新增：

- `serviceName = official-review-master`
- `displayName = Official Review Master`
- `masterKind = review`

职责：

- 对 patch / diff / regression risk 给结构化 review 建议
- 验证 selector 在非 debug 场景不会总是回退到 Debug Master

### 3.3 可选后续：Official Architecture Master

可作为 phase-4 或后续增强：

- `serviceName = official-architecture-master`
- `displayName = Official Architecture Master`
- `masterKind = architecture`

phase-3 不强求。

---

## 4. Response Mode 建议

### 4.1 Debug Master

继续使用结构化诊断响应，例如：

- `summary`
- `diagnosis[]`
- `nextSteps[]`
- `risks[]`

### 4.2 Review Master

建议结构化字段继续使用当前 Ask Master canonical envelope：

- `summary`
- `findings[]`
- `risks[]`
- `recommendations[]`
- `confidence`

仍应兼容 Ask Master 的通用 response envelope。

---

## 5. Selector / Policy 验证矩阵

phase-3 至少需要覆盖以下场景：

### 5.1 Manual Ask

- 用户显式说“去问 Review Master 看看这个 patch 风险”
- selector 必须选中 `review`

### 5.2 Suggest

- 系统看到 repeated failure
- suggest 指向 Debug Master

### 5.3 Auto

- 系统看到 blocked review / patch risk 场景
- auto ask 指向 Review Master

### 5.4 Trusted Friction

- `trustedMasters` 包含选中目标
- payload 非敏感
- `confirmationMode=sensitive_only`
- auto flow 可 direct send

### 5.5 Fallback

- 目标 kind 无匹配 provider
- selector 明确失败或回退策略明确可解释
- 不能偷偷改走 private chat / services call

---

## 6. E2E 验收矩阵

建议至少新增以下 e2e：

1. `masterAskAutoFlow.test.mjs`
   - auto preview -> confirm -> completed
2. `masterAskTrustedAutoFlow.test.mjs`
   - trusted + non-sensitive -> direct send -> completed
3. `fixtureHarness.test.mjs`
   - official debug + official review 同时可被发现与调用
4. 现有 `masterAskHostFlow.test.mjs`
   - 回归 manual + suggest 不被 phase-3 破坏
5. `masterAskAutoTimeoutFlow.test.mjs`
   - auto flow 的 timeout / late reply 语义保持不变
6. `masterAskAutoPrivacyGate.test.mjs`
   - final preview snapshot / actual wire payload 都不会带入 secrets、整仓隐式引用或未脱敏敏感输出

---

## 7. Host Smoke 建议

phase-3 的手工 smoke 至少应覆盖：

- `manual`
  - 用户明确 ask
- `suggest`
  - 系统建议，用户接受
- `auto`
  - 系统自动准备 preview 或 direct send

并能通过：

- `metabot master trace --id <real-trace-id>`

看出：

- `triggerMode`
- `masterKind`
- `frictionMode`
- `confirmationMode`

---

## 8. 发布门槛建议

phase-3 若想对外发布，至少应满足：

- 两个官方 fixture 均能本地 e2e 跑通
- auto flow 不会绕开 trace
- trusted low-friction path 有明确 gate
- auto timeout / late reply 回归通过
- auto privacy gate 回归通过
- install runbook 与 skillpack 文案同步更新

如果这些条件未满足，则更适合作为内部实验功能，而不是公开发布能力。

---

## 9. 小结

phase-3 的 provider matrix 与验收矩阵，解决的是“我们怎么证明 Ask Master 的自动能力不是只在 Debug Master 样机里看起来能跑”。只有把 provider 种类与 e2e 场景扩展出来，selector、policy、auto flow 的价值才算真正被验证。
