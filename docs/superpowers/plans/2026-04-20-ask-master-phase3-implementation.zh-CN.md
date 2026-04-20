# Ask Master Phase 3 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Ask Master phase-2 已完成的 `manual + suggest + host natural language` 基线之上，完成真正可用的 `auto` 模式：系统能基于 host 可见信号识别“值得请教 Master”的时机，包括 stuck、review checkpoint、wrap-up risk 等场景，自动准备 Ask Master preview，并按 trusted / sensitivity / confirmation policy 决定是要求确认还是低摩擦发送。

**Architecture:** 继续沿用 `master-service + simplemsg + trace` 主线，不新增 transport family。Phase-3 重点补齐 `host telemetry ingress -> host observation -> ask-worthiness detector -> auto trigger policy -> auto preview/send orchestration -> trace/feedback loop` 这条链路，并新增 Official Review Master fixture，用来验证 selector 与 auto flow 不只适用于单一 debug 场景。

**Tech Stack:** TypeScript, Node.js, `node:test`, 现有 `metabot master` CLI/daemon/runtime、`simplemsg`、Ask Master trace/export 体系。

---

## Phase-2 完成状态

当前 `main` 分支已经具备：

- 独立 `master-service` 发布与发现
- `metabot master list / ask / trace / host-action`
- `master_request / master_response` over `simplemsg`
- Ask Master 独立 trace 语义
- host 中自然语言 manual ask
- host-facing suggest / accept / reject
- collector / packager / selector / policy gate
- Official Debug Master fixture
- 安装文档与 skillpack 合同闭环

Phase-2 仍然明确没有完成：

- 对用户真正可见的 `triggerMode=auto`
- 面向 host runtime 的稳定 telemetry ingress / observation bridge
- `confirmationMode=sensitive_only` / `never` 的真实 product flow
- trusted master 的低摩擦 auto ask
- Review 场景的官方 Master fixture / acceptance matrix

---

## Phase-3 定位

Phase-3 的目标不是再扩 CLI，而是把 Ask Master 推进到更接近 advisor-tool 的产品体验：

- 系统能够识别“当前值不值得请教 Master”，包括 stuck、review checkpoint、wrap-up risk
- 系统能够主动准备一份 Ask Master preview
- 用户默认仍可确认
- trusted + non-sensitive 场景可演进到更自动
- trace 能完整解释为什么自动触发、为什么要求确认、为什么被抑制

仍然坚持：

- 不读 CoT
- 不隐式上传整仓或敏感文件
- 不引入第二套传输协议
- 不把 provider 变成 remote executor

---

## Phase-3 文档输入

Phase-3 以以下文档为输入基线：

- [MetaWeb Ask Master 设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-17-metaweb-ask-master-design.zh-CN.md)
- [Ask Master Trigger Engine 设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-17-master-trigger-engine.zh-CN.md)
- [Ask Master Phase 2 实现计划](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/plans/2026-04-20-ask-master-phase2-implementation.zh-CN.md)
- [Phase-2 Host 适配与自然语言入口设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-20-master-host-adapter.zh-CN.md)
- [Phase-2 Suggest 流设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-20-master-suggest-flow.zh-CN.md)
- [Phase-2 Master Selector 与策略门控设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-20-master-selector-policy.zh-CN.md)

Phase-3 新增以下子 spec：

- [Phase-3 Host Observation 与 Ask-Worthiness Detector 设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-20-master-host-observation-stuck-detector.zh-CN.md)
- [Phase-3 Auto Trigger 与 Policy 设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-20-master-auto-trigger-policy.zh-CN.md)
- [Phase-3 Auto Ask Flow 与 Confirmation 设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-20-master-auto-flow-confirmation.zh-CN.md)
- [Phase-3 Auto Feedback 与 Trace Loop 设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-20-master-auto-feedback-trace.zh-CN.md)
- [Phase-3 Provider Matrix 与验收设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-20-master-phase3-provider-matrix.zh-CN.md)

---

## Scope

### In Scope

- `triggerMode=auto` 的真实 host-facing 能力
- host observation bridge 与 ask-worthiness detector
- auto candidate 到 preview / confirm / send 的完整流
- `confirmationMode=always / sensitive_only / never` 的 product semantics 落地
- trusted master 的低摩擦策略
- auto ask 的 trace、suppression、feedback loop
- 第二个官方 Master fixture 与 phase-3 acceptance matrix

### Out Of Scope

- 多轮开放式 master 对话
- provider 直接修改 caller 工作区
- marketplace / 支付 / rating
- 大规模多 master fan-out
- 读取 CoT 或上传隐式全量 transcript
- 真正的“默认无确认自动发送”大范围开放

---

## 计划产物

### 新增模块

- `src/core/master/masterHostSignalBridge.ts`
  - 把 host session/tool/runtime 信号接入 Ask Master observation 输入面
- `src/core/master/masterHostObservation.ts`
  - 从 host 可见运行时信号构造统一 observation frame
- `src/core/master/masterStuckDetector.ts`
  - 对 observation frame 进行 ask-worthiness / stuck / review-checkpoint assessment
- `src/core/master/masterAutoOrchestrator.ts`
  - 将 `auto_candidate` 接成 preview / confirm / send 主线
- `src/core/master/masterAutoPolicy.ts`
  - 补齐 phase-3 的 auto gate、trusted friction、sensitivity rules
- `src/core/master/masterAutoFeedbackState.ts`
  - 记录 auto ask 的 accept / reject / timeout / cooldown / rate limit

### 重点修改模块

- `src/core/master/masterTriggerEngine.ts`
  - 从最小 `auto_candidate` 分支升级成消费 ask-worthiness detector 输出
- `src/core/master/masterPolicyGate.ts`
  - 真正实现 `sensitive_only` / `never` 的 phase-3 语义
- `src/core/master/masterContextCollector.ts`
  - 接入更多 host observation 信号来源
- `src/core/master/masterContextPackager.ts`
  - 产出 sensitivity 标记与 auto-safe 摘要
- `src/core/master/masterPendingAskState.ts`
  - 允许 auto prepared preview / auto confirmation continuation
- `src/cli/runtime.ts`
  - 接入 host observation bridge / auto ask gate
- `src/daemon/defaultHandlers.ts`
  - 接入 auto orchestrator、feedback state、trace projection
- `src/core/chat/sessionTrace.ts`
  - 扩展 auto metadata
- `src/core/master/masterTrace.ts`
  - 渲染 auto 原因、auto decision、feedback 结果
- `src/core/config/configTypes.ts`
  - 扩展 phase-3 所需 auto policy 配置
- `src/core/config/configStore.ts`
  - phase-3 新配置的归一化与默认值

### Provider / Fixture

- `src/core/master/reviewMasterFixture.ts`
  - 新增官方 Review Master fixture
- `src/core/master/masterProviderRuntime.ts`
  - 把新 fixture 接入 provider runtime
- `tests/e2e/fixtureHarness.test.mjs`
  - 扩展 provider matrix 验收

### 测试

- `tests/master/masterHostObservation.test.mjs`
- `tests/master/masterStuckDetector.test.mjs`
- `tests/master/masterAutoPolicy.test.mjs`
- `tests/master/masterAutoFlow.test.mjs`
- `tests/master/masterAutoFeedbackTrace.test.mjs`
- `tests/e2e/masterAskAutoFlow.test.mjs`
- `tests/e2e/masterAskTrustedAutoFlow.test.mjs`
- `tests/e2e/masterAskAutoTimeoutFlow.test.mjs`
- `tests/e2e/masterAskAutoPrivacyGate.test.mjs`
- `tests/e2e/fixtureHarness.test.mjs`
- `tests/cli/masterCommand.test.mjs`
- `tests/daemon/masterRoutes.test.mjs`

---

## Task 1: 打通 Host Observation Bridge

**目标：** 把 Ask Master 从“调用方手工塞 observation blob”升级成“host 真实可见运行时事件 + Ask Master 自身 telemetry ingress”的稳定输入层。

**Files:**

- Create: `src/core/master/masterHostSignalBridge.ts`
- Create: `src/core/master/masterHostObservation.ts`
- Create: `src/core/master/masterStuckDetector.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/core/master/masterContextTypes.ts`
- Test: `tests/master/masterHostObservation.test.mjs`
- Test: `tests/master/masterStuckDetector.test.mjs`

- [ ] **Step 1: 写 failing tests**

至少覆盖：

- tool failure、test failure、重复错误签名、无进展窗口、review checkpoint 风险都会进入同一 observation model
- 不读取 CoT
- `.env`、keys、private reasoning 不会进入 observation
- detector 输出稳定 `score / reasons / candidateMasterKind`

- [ ] **Step 2: 实现最小 observation frame**

要求：

- 先补 host telemetry ingress，再消费 host 可见事件
- observation 与特定 host transcript 格式解耦
- 为后续 `claude/codex/gemini` 适配保留中立字段

- [ ] **Step 3: 实现 ask-worthiness detector**

要求：

- 输出结构化 `worthAsking / confidence / reasons`
- 明确区分“普通失败”和“值得 Ask Master 的失败或高风险 checkpoint”
- 保持 deterministic，避免 phase-3 一开始就引入黑盒模型判断

- [ ] **Step 4: 跑 targeted tests**

Run:

```bash
npm run build
node --test tests/master/masterHostObservation.test.mjs tests/master/masterStuckDetector.test.mjs
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/master/masterHostSignalBridge.ts src/core/master/masterHostObservation.ts src/core/master/masterStuckDetector.ts src/cli/runtime.ts src/daemon/defaultHandlers.ts src/core/master/masterContextTypes.ts tests/master/masterHostObservation.test.mjs tests/master/masterStuckDetector.test.mjs
git commit -m "feat: add ask master host observation bridge"
```

---

## Task 2: 落地 Auto Trigger 与 Policy

**目标：** 把代码里已有的 `auto_candidate` 占位分支升级成真正可用的 phase-3 policy layer。

**Files:**

- Create: `src/core/master/masterAutoPolicy.ts`
- Modify: `src/core/master/masterTriggerEngine.ts`
- Modify: `src/core/master/masterPolicyGate.ts`
- Modify: `src/core/config/configTypes.ts`
- Modify: `src/core/config/configStore.ts`
- Test: `tests/master/masterAutoPolicy.test.mjs`
- Test: `tests/config/askMasterConfig.test.mjs`

- [ ] **Step 1: 写 failing tests**

至少覆盖：

- `triggerMode=auto` 时允许进入 auto prepared preview
- `confirmationMode=always` 仍强制确认
- `confirmationMode=sensitive_only` 只有在 `trusted + non-sensitive` 时允许 direct send，否则回退 preview
- `confirmationMode=never` 只在 trusted + safe + explicit auto policy 打开时允许
- `minNoProgressWindowMs` 的变化会真实改变 detector/gate 判定
- global cooldown / per-trace limit 生效

- [ ] **Step 2: 扩展配置模型**

要求：

- 仅引入 phase-3 必需字段
- 默认值保持保守
- 不破坏 phase-1 / phase-2 已存在配置

- [ ] **Step 3: 升级 trigger engine + policy gate**

要求：

- `auto_candidate` 不再只是“理论可达分支”
- 产出的 decision 必须带 `confidence / reasons / selected friction mode`
- policy 层必须解释“为什么仍然需要确认”
- 最终 preview snapshot 与实际发送 payload 的 privacy gate 必须可测试

- [ ] **Step 4: 跑 targeted tests**

Run:

```bash
npm run build
node --test tests/master/masterAutoPolicy.test.mjs tests/config/askMasterConfig.test.mjs
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/master/masterAutoPolicy.ts src/core/master/masterTriggerEngine.ts src/core/master/masterPolicyGate.ts src/core/config/configTypes.ts src/core/config/configStore.ts tests/master/masterAutoPolicy.test.mjs tests/config/askMasterConfig.test.mjs
git commit -m "feat: add ask master auto trigger policy"
```

---

## Task 3: 实现 Auto Ask Flow

**目标：** 系统在检测到“值得请教 Master”的时机且策略允许时，能够自动准备 preview，并进入用户确认或低摩擦发送的统一 caller flow。

**Files:**

- Create: `src/core/master/masterAutoOrchestrator.ts`
- Modify: `src/core/master/masterHostAdapter.ts`
- Modify: `src/core/master/masterPendingAskState.ts`
- Modify: `src/core/master/masterPreview.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/cli/runtime.ts`
- Test: `tests/master/masterAutoFlow.test.mjs`
- Test: `tests/master/masterContextPackager.test.mjs`
- Test: `tests/e2e/masterAskAutoFlow.test.mjs`
- Test: `tests/e2e/masterAskAutoPrivacyGate.test.mjs`
- Test: `tests/cli/masterCommand.test.mjs`
- Test: `tests/daemon/masterRoutes.test.mjs`

- [ ] **Step 1: 写 failing tests**

至少覆盖：

- auto candidate 会 materialize 成 preview，而不是只停在内部 decision
- `always` 模式下需要一次确认
- `sensitive_only` 下只有 `trusted + non-sensitive` payload 可直接发，其余都必须停在 preview
- `never` 模式下只有 trusted + safe payload 才允许直接发送
- auto flow 与 manual/suggest 共用同一 pending snapshot 与 trace 主线
- auto prepared preview 的最终 snapshot 与实际发送 payload 都要证明未包含 secret-bearing files、未脱敏敏感输出、整仓隐式引用

- [ ] **Step 2: 实现 auto orchestrator**

要求：

- 复用现有 `master ask` runtime
- 不新增 transport
- 不复制 selector / packager / response integrator

- [ ] **Step 3: 接上 host runtime**

要求：

- host 侧能收到“系统已准备好 Ask Master preview”的 machine-first 返回
- 用户可确认、拒绝、忽略
- 自动发送场景也必须留下完整 trace

- [ ] **Step 4: 跑 targeted tests**

Run:

```bash
npm run build
node --test tests/master/masterAutoFlow.test.mjs tests/master/masterContextPackager.test.mjs tests/e2e/masterAskAutoFlow.test.mjs tests/e2e/masterAskAutoPrivacyGate.test.mjs tests/cli/masterCommand.test.mjs tests/daemon/masterRoutes.test.mjs
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/master/masterAutoOrchestrator.ts src/core/master/masterHostAdapter.ts src/core/master/masterPendingAskState.ts src/core/master/masterPreview.ts src/daemon/defaultHandlers.ts src/cli/runtime.ts tests/master/masterAutoFlow.test.mjs tests/master/masterContextPackager.test.mjs tests/e2e/masterAskAutoFlow.test.mjs tests/e2e/masterAskAutoPrivacyGate.test.mjs tests/cli/masterCommand.test.mjs tests/daemon/masterRoutes.test.mjs
git commit -m "feat: add ask master auto flow orchestration"
```

---

## Task 4: 建立 Auto Feedback / Trace Loop

**目标：** 让 auto ask 的 every decision 都可被解释、可被追踪、可被抑制，并能从 accept / reject / timeout 中得到稳定反馈。

**Files:**

- Create: `src/core/master/masterAutoFeedbackState.ts`
- Modify: `src/core/chat/sessionTrace.ts`
- Modify: `src/core/master/masterTrace.ts`
- Modify: `src/core/chat/transcriptExport.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Test: `tests/master/masterAutoFeedbackTrace.test.mjs`
- Test: `tests/master/masterTraceCommand.test.mjs`
- Test: `tests/master/masterTraceMetadata.test.mjs`

- [ ] **Step 1: 写 failing tests**

至少覆盖：

- auto prepared preview 会记录 `triggerMode=auto`
- trace 中可见 `auto reason / confidence / gate decision`
- auto reject / timeout / direct send 都会更新 artifacts
- feedback state 能阻止同类问题短时间内反复 auto ask
- reject auto preview 后 canonical status / latestEvent / display status 唯一确定且可断言
- trusted direct-send trace 必须能解释当前 `confirmationMode` 与 trusted 判定

- [ ] **Step 2: 实现 feedback state 与 trace 扩展**

要求：

- feedback 不应只存在内存态
- trace export / markdown / JSON 需要一致
- late reply 与 timed_out 语义保持不变

- [ ] **Step 3: 跑 targeted tests**

Run:

```bash
npm run build
node --test tests/master/masterAutoFeedbackTrace.test.mjs tests/master/masterTraceCommand.test.mjs tests/master/masterTraceMetadata.test.mjs
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/master/masterAutoFeedbackState.ts src/core/chat/sessionTrace.ts src/core/master/masterTrace.ts src/core/chat/transcriptExport.ts src/daemon/defaultHandlers.ts tests/master/masterAutoFeedbackTrace.test.mjs tests/master/masterTraceCommand.test.mjs tests/master/masterTraceMetadata.test.mjs
git commit -m "feat: add ask master auto feedback trace loop"
```

---

## Task 5: 扩展 Official Master Provider Matrix

**目标：** 不再只用 Debug Master 验证 Ask Master；新增 Official Review Master fixture，验证 selector、policy 与 auto flow 的通用性。

**Files:**

- Create: `src/core/master/reviewMasterFixture.ts`
- Modify: `src/core/master/masterProviderRuntime.ts`
- Modify: `src/core/master/masterTypes.ts`
- Modify: `src/core/master/masterMessageSchema.ts`
- Test: `tests/e2e/fixtureHarness.test.mjs`
- Test: `tests/e2e/masterAskTrustedAutoFlow.test.mjs`
- Test: `tests/master/masterSelectorPolicy.test.mjs`

- [ ] **Step 1: 写 failing tests**

至少覆盖：

- 官方 `Review Master` 能被 discovery
- selector 能区分 `debug` 与新增 `masterKind`
- trusted / official / online / kind 在 auto flow 中仍能稳定选中正确目标

- [ ] **Step 2: 实现 fixture 扩展**

要求：

- 新增 Official Review Master fixture
- 返回结构化响应
- 不破坏现有 Debug Master 验收

- [ ] **Step 3: 跑 targeted tests**

Run:

```bash
npm run build
node --test tests/e2e/fixtureHarness.test.mjs tests/e2e/masterAskTrustedAutoFlow.test.mjs tests/master/masterSelectorPolicy.test.mjs
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/master/reviewMasterFixture.ts src/core/master/masterProviderRuntime.ts src/core/master/masterTypes.ts src/core/master/masterMessageSchema.ts tests/e2e/fixtureHarness.test.mjs tests/e2e/masterAskTrustedAutoFlow.test.mjs tests/master/masterSelectorPolicy.test.mjs
git commit -m "feat: expand ask master provider matrix"
```

---

## Task 6: 端到端验收与 Host 合同收尾

**目标：** 把 auto flow 的安装、skillpack、host-facing smoke 与 regression contract 固化下来，确保 Phase-3 可手工验收、可自动验收、可对外说明。

**Files:**

- Modify: `SKILLs/metabot-ask-master/SKILL.md`
- Modify: `scripts/build-metabot-skillpacks.mjs`
- Modify: `tests/skillpacks/buildSkillpacks.test.mjs`
- Modify: `docs/hosts/codex-agent-install.md`
- Modify: `tests/e2e/masterAskHappyPath.test.mjs`
- Modify: `tests/e2e/masterAskHostFlow.test.mjs`
- Create: `tests/e2e/masterAskAutoTimeoutFlow.test.mjs`
- Create: `tests/e2e/masterAskAutoPrivacyGate.test.mjs`

- [ ] **Step 1: 写 failing tests**

至少覆盖：

- 安装后 skill 文案反映 phase-3 auto / preview / confirmation 语义
- smoke runbook 能区分 manual / suggest / auto 三条路径
- fresh install 与新 session 下能稳定复现 auto preview/confirm 行为
- auto timeout / late reply 语义有独立 e2e 回归
- auto preview snapshot 与实际发送 payload 的隐私 gate 有独立 e2e 回归

- [ ] **Step 2: 更新 skillpack 与安装文档**

要求：

- 文案不得回退到旧 `advisor`
- 明确 `auto` 仍受本地 config 与确认策略控制
- 明确如何做单机双终端验收

- [ ] **Step 3: 跑 phase-3 final verification**

Run:

```bash
npm run build
npm run build:skillpacks
node --test tests/master/*.test.mjs
node --test tests/e2e/masterAskHappyPath.test.mjs tests/e2e/masterAskHostFlow.test.mjs tests/e2e/masterAskAutoFlow.test.mjs tests/e2e/masterAskTrustedAutoFlow.test.mjs tests/e2e/masterAskAutoTimeoutFlow.test.mjs tests/e2e/masterAskAutoPrivacyGate.test.mjs tests/e2e/fixtureHarness.test.mjs
node --test tests/skillpacks/buildSkillpacks.test.mjs tests/cli/skills.test.mjs tests/cli/masterCommand.test.mjs tests/daemon/masterRoutes.test.mjs
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add SKILLs/metabot-ask-master/SKILL.md scripts/build-metabot-skillpacks.mjs tests/skillpacks/buildSkillpacks.test.mjs docs/hosts/codex-agent-install.md tests/e2e/masterAskHappyPath.test.mjs tests/e2e/masterAskHostFlow.test.mjs tests/e2e/masterAskAutoFlow.test.mjs tests/e2e/masterAskTrustedAutoFlow.test.mjs tests/e2e/masterAskAutoTimeoutFlow.test.mjs tests/e2e/masterAskAutoPrivacyGate.test.mjs tests/e2e/fixtureHarness.test.mjs tests/cli/skills.test.mjs tests/cli/masterCommand.test.mjs tests/daemon/masterRoutes.test.mjs
git commit -m "feat: complete ask master phase-3 acceptance"
```

---

## 风险与应对

### 风险 1：auto ask 过于频繁，用户感觉被打扰

应对：

- per-trace limit
- global cooldown
- explicit reject feedback
- trusted / official 只影响摩擦，不直接让 noise 合法化

### 风险 2：`never` 模式把 auto ask 做成不透明黑箱

应对：

- `never` 仅在 trusted + safe payload + explicit policy 打开时生效
- trace 中必须记录“为什么无需确认”
- phase-3 初始验收仍以 `always` / `sensitive_only` 为主

### 风险 3：host observation 越界收集隐私

应对：

- 只采集 host 可见事件
- packager 继续做 safety filter
- final preview snapshot 与实际发送 payload 都必须有 regression tests 证明不会包含敏感文件、整仓隐式引用、未脱敏 secrets
- 敏感路径与 secrets 默认不入 auto payload

### 风险 4：auto flow 破坏现有 timeout / late reply 语义

应对：

- 沿用现有 Ask Master caller flow
- 不修改 `timed_out` 语义
- 用 dedicated auto-flow e2e regression tests 锁定 timeout / late reply 行为

---

## Phase-3 完成定义

当以下条件全部满足时，Phase-3 才算完成：

- `triggerMode=auto` 在 host-facing flow 中真实可用
- 系统能够基于 host 可见信号自动准备 Ask Master preview
- `always / sensitive_only / never` 的行为有清晰、可测试的差异
- trusted + safe payload 场景可进入低摩擦 auto flow
- auto ask 的 trace / export / feedback / suppression 可解释、可复现
- 至少存在 Debug + Review 两个官方 Master fixture，并被 e2e 验证
- auto timeout / late reply / privacy gate 都有独立回归
- 安装文档与 host skill 合同更新完成，单机双终端 smoke 可跑通

---

## 建议执行顺序

推荐顺序：

1. 先打通 observation bridge
2. 再做 auto trigger / policy
3. 再接 auto flow orchestration
4. 再补 feedback / trace
5. 再扩 provider matrix
6. 最后做 skillpack / install / e2e 收尾

这个顺序的原因是：

- Phase-3 最大新增风险在于“自动触发”，所以必须先把输入与门控做稳
- auto flow 需要建立在 policy 可解释的前提下，否则后续 trace 与验收会反复返工
- provider matrix 放后做，避免一开始在 fixture 上分散注意力
