# Ask Master Phase 2 实现计划

> **给执行型 agent 的要求：** 先按测试驱动方式推进每个任务；每个任务完成后都要经过一次 `gpt-5.4` review/test subagent 复核，再进入下一任务。

**目标：** 在已经并入 `main` 的 Ask Master phase-1 基线之上，完成面向 host 的 phase-2 能力：自然语言手动 Ask Master、真正可用的 suggest 流、自动上下文收集与打包、Master 选择与策略门控，以及 host skill / skillpack / 安装文档的一致性闭环。

**Phase-1 基线：**

- 已有独立 `master-service` 发布与发现
- 已有 `metabot master publish/list/ask/trace`
- 已有 `master_request / master_response` over `simplemsg`
- 已有 Official Debug Master fixture
- 已有 Ask Master trace 语义
- 已有最小 `manual + suggest` trigger core

**Phase-2 定位：**

- 让 Ask Master 从“CLI 已可用”升级为“host 中能自然发起、自然建议、自然确认”的产品能力
- 不新增 transport family
- 不回退到旧 `advisor` 语义
- 不实现无确认自动发送

---

## Scope

### In Scope

- host-facing 自然语言 Ask Master 手动发起
- 基于 host 可见信号的上下文收集与打包
- suggest 流与 suppression / cooldown
- Master selector 与 policy gate
- `metabot-ask-master` skill 源、skillpack 构建、安装文档、生成合同的一致性修复
- phase-2 端到端验收与安装后 smoke test

### Out Of Scope

- 无确认自动发送
- 多 Master fan-out / 联动排序
- 新的 Architecture Master / Review Master provider 供给
- marketplace / 支付 / 评分扩展
- 开放式多轮 master 聊天
- provider 远端直接改 caller 代码

---

## Phase-2 文档输入

本计划以下列设计文档为输入基线：

- [MetaWeb Ask Master 设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-17-metaweb-ask-master-design.zh-CN.md)
- [Master Service 发布与发现设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-17-master-service-publish-discovery.zh-CN.md)
- [Caller 侧 Master Ask 调用流设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-17-master-ask-caller-flow.zh-CN.md)
- [Provider 侧 Master Runtime 与 Debug Master Fixture 设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-17-master-provider-runtime-debug-master.zh-CN.md)
- [Ask Master Trace 与可观测性设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-17-master-trace-observability.zh-CN.md)
- [Ask Master Trigger Engine 设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-17-master-trigger-engine.zh-CN.md)

Phase-2 还新增以下子 spec：

- [Phase-2 Host 适配与自然语言入口设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-20-master-host-adapter.zh-CN.md)
- [Phase-2 上下文收集与打包设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-20-master-context-collector-packager.zh-CN.md)
- [Phase-2 Suggest 流设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-20-master-suggest-flow.zh-CN.md)
- [Phase-2 Master Selector 与策略门控设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-20-master-selector-policy.zh-CN.md)
- [Phase-2 Skillpack / 安装 / Prompt 合同一致性设计说明](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-20-master-skillpack-install-contract.zh-CN.md)

---

## 计划产物

### 新增模块

- `src/core/master/masterContextCollector.ts`
  - 负责从 host 可见信号收集 Ask Master 上下文
- `src/core/master/masterContextPackager.ts`
  - 负责预算裁剪、脱敏、artifact 归一化、draft 生成
- `src/core/master/masterSelector.ts`
  - 负责显式点名、kind 匹配、trusted/official/online 排序
- `src/core/master/masterPolicyGate.ts`
  - 负责 `enabled / triggerMode / confirmationMode / contextMode / trustedMasters`
- `src/core/master/masterHostAdapter.ts`
  - 负责把 host-facing “手动 ask / 接受 suggest / 拒绝 suggest”接成统一编排入口
- `src/core/master/masterSuggestState.ts`
  - 负责 suggestion suppression / cooldown / accept / reject 持久化

### 重点修改模块

- `src/core/master/masterTriggerEngine.ts`
  - 从最小规则集接入更完整 observation 与 suppression
- `src/core/master/masterPreview.ts`
  - 接受 collector/packager 输出，不再只假设人工准备好的 draft
- `src/cli/types.ts`
  - 为 `master host-action` 暴露 CLI 入参与 machine-first 返回载荷
- `src/cli/runtime.ts`
  - 接上新的 `master host-action` client/runtime 调用
- `src/daemon/defaultHandlers.ts`
  - 增加 host adapter、suggest handoff、selector/policy 集成
- `src/core/config/configTypes.ts`
  - 如有必要增加 phase-2 所需最小配置项
- `src/core/config/configStore.ts`
  - 配置归一化与默认值

### Host / Skill / 安装链路

- `SKILLs/metabot-ask-master/SKILL.md`
  - phase-2 新增的 Ask Master 技能源文件
- `scripts/build-metabot-skillpacks.mjs`
  - 将 `metabot-ask-master` 纳入构建输出
- `src/core/skills/baseSkillRegistry.ts`
  - 为 `metabot skills resolve --skill metabot-ask-master` 新增 machine-first base contract
- `tests/skillpacks/buildSkillpacks.test.mjs`
  - 验证 skillpack 中包含 Ask Master 技能且内容使用 `master` 语义
- `tests/cli/skills.test.mjs`
  - 验证 Task 1 新增后的 `metabot skills resolve --skill metabot-ask-master`
- `docs/hosts/codex-agent-install.md`
  - 安装文档与 skillpack 更新说明

### 测试

- `tests/master/masterContextCollector.test.mjs`
- `tests/master/masterContextPackager.test.mjs`
- `tests/master/masterSelectorPolicy.test.mjs`
- `tests/master/masterHostAdapter.test.mjs`
- `tests/master/masterSuggestFlowPhase2.test.mjs`
- `tests/e2e/masterAskHostFlow.test.mjs`
- `tests/skillpacks/buildSkillpacks.test.mjs`
- `tests/cli/skills.test.mjs`
- `tests/cli/masterCommand.test.mjs`
- `tests/daemon/masterRoutes.test.mjs`
- `tests/master/masterTraceMetadata.test.mjs`
- `tests/master/masterTraceCommand.test.mjs`

---

## Task 1: 对齐 Host Skill 与生成合同

**目标：** 把 Ask Master 的 repo 源、skillpack 输出、安装文档、技能解析合同统一到 `master` 语义，消除旧 `advisor` 残留。

**文件：**

- Create: `SKILLs/metabot-ask-master/SKILL.md`
- Modify: `scripts/build-metabot-skillpacks.mjs`
- Modify: `src/core/skills/baseSkillRegistry.ts`
- Modify: `tests/skillpacks/buildSkillpacks.test.mjs`
- Modify: `tests/cli/skills.test.mjs`
- Modify: `docs/hosts/codex-agent-install.md`

- [ ] **Step 1: 先写 failing tests**

至少覆盖：

- `buildAgentConnectSkillpacks` 会把 `metabot-ask-master` 渲染进三套 host pack
- skill 文本中使用 `metabot master list/ask/trace`，不再出现 `metabot advisor ...`
- Task 1 新增 base registry 合同后，`metabot skills resolve --skill metabot-ask-master --host codex` 能返回 machine-first 合同

- [ ] **Step 2: 实现 repo 内 skill 源与构建接线**

要求：

- Ask Master skill 必须从 repo `SKILLs/` 生成，不再依赖本机残留技能
- 如果 phase-2 继续把 `skills resolve` 作为用户可见验证手段，则必须同步新增 `baseSkillRegistry` 合同条目
- skill 文案必须强调：
  - 不走 private chat
  - 不手写 simplemsg
  - 先 preview，再确认
  - 只走 `metabot master` 命令族

- [ ] **Step 3: 更新安装文档**

要求：

- 安装 runbook 明确 `npm run build:skillpacks`
- 明确重新安装后会覆盖旧 skill
- 明确如何确认当前 host 使用的是最新 `metabot-ask-master`

- [ ] **Step 4: 跑 targeted tests**

Run:

```bash
npm run build
node --test tests/skillpacks/buildSkillpacks.test.mjs tests/cli/skills.test.mjs
```

Expected: PASS

---

## Task 2: 实现 Phase-2 上下文收集与打包

**目标：** 让 host 不再需要人工先写 request file，而是能从当前任务轨迹中自动生成稳定、受预算约束、可审阅的 Ask Master draft。

**文件：**

- Create: `src/core/master/masterContextCollector.ts`
- Create: `src/core/master/masterContextPackager.ts`
- Modify: `src/core/master/masterPreview.ts`
- Modify: `src/core/master/masterTypes.ts`
- 如需要，新增独立输入类型：
  - `src/core/master/masterContextTypes.ts`
- Test: `tests/master/masterContextCollector.test.mjs`
- Test: `tests/master/masterContextPackager.test.mjs`

- [ ] **Step 1: 先写 failing tests**

至少覆盖：

- 只采集 host 可见信号，不依赖 CoT
- 能从最近失败、终端输出、diff 摘要、相关文件生成最小上下文
- `.env`、credentials、keys、wallet secrets、整仓库默认不会进入打包结果
- `compact / standard` 模式的预算裁剪稳定

- [ ] **Step 2: 实现 collector 与 packager**

要求：

- 先定义明确的 collector 输入契约，再写测试 fixture
- collector 输出中立的 observation/context，不直接耦合某个 host transcript 私有格式
- packager 负责：
  - relevance shortlist
  - artifact 裁剪
  - safety filter
  - preview 可见摘要
- phase-2 先只公开 `compact` 与 `standard`

- [ ] **Step 3: 跑 targeted tests**

Run:

```bash
npm run build
node --test tests/master/masterContextCollector.test.mjs tests/master/masterContextPackager.test.mjs
```

Expected: PASS

---

## Task 3: 实现 Host-facing 手动 Ask Master

**目标：** 用户在 host 中用自然语言明确说“去问问 Debug Master / 先预览再发”时，本地 runtime 能自动完成 target resolve、context collect、preview、confirm、send、response integrate，而不是让用户手动拼 JSON。

**文件：**

- Create: `src/core/master/masterHostAdapter.ts`
- Modify: `src/cli/commands/master.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/daemon/routes/master.ts`
- Modify: `src/daemon/routes/types.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/core/master/masterPreview.ts`
- Modify: `src/core/master/masterPendingAskState.ts`
- Test: `tests/master/masterHostAdapter.test.mjs`
- Test: `tests/e2e/masterAskHostFlow.test.mjs`
- Test: `tests/cli/masterCommand.test.mjs`
- Test: `tests/daemon/masterRoutes.test.mjs`

- [ ] **Step 1: 先写 failing tests**

至少覆盖：

- host-facing manual ask 能生成 preview，而不是要求人工 request file
- 用户确认后复用 pending snapshot 发送，不重算输入
- structured response 能回到当前 host-facing flow
- trace 仍然保留 Ask Master 语义
- `metabot master host-action` 的 CLI 参数解析与帮助输出正确
- `POST /api/master/host-action` 会被正确转发到 daemon handler / CLI runtime

- [ ] **Step 2: 实现 host adapter**

要求：

- host-facing 自然语言入口必须落到一个明确的 machine-first host bridge surface
  - 推荐新增：`metabot master host-action --request-file <path>`
  - 并暴露对应 daemon route：`POST /api/master/host-action`
- CLI/runtime/route wiring 要一起落地：
  - `src/cli/commands/master.ts`
  - `src/cli/types.ts`
  - `src/cli/runtime.ts`
  - `src/daemon/routes/master.ts`
  - `src/daemon/routes/types.ts`
- 允许输入：
  - 显式点名 `Debug Master`
  - 只表达“去问问 master”
  - 接收 `suggest` 后的 accept
- host adapter 只负责编排，不自己实现 transport
- 所有发送都继续走现有 `master ask` runtime

- [ ] **Step 3: 跑 targeted tests**

Run:

```bash
npm run build
node --test tests/master/masterHostAdapter.test.mjs tests/e2e/masterAskHostFlow.test.mjs tests/cli/masterCommand.test.mjs tests/daemon/masterRoutes.test.mjs
```

Expected: PASS

---

## Task 4: 实现 Suggest Flow 与 Suppression

**目标：** 让 phase-1 的最小 trigger core 真正变成用户可见、可接受、可拒绝、不会反复打扰的 suggest 流。

**文件：**

- Create: `src/core/master/masterSuggestState.ts`
- Modify: `src/core/master/masterTriggerEngine.ts`
- Modify: `src/cli/commands/master.ts`
- Modify: `src/daemon/routes/master.ts`
- Modify: `src/daemon/routes/types.ts`
- Modify: `src/core/master/masterHostAdapter.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Test: `tests/master/masterSuggestFlowPhase2.test.mjs`
- Modify: `tests/master/masterTraceMetadata.test.mjs`
- Modify: `tests/master/masterTraceCommand.test.mjs`

- [ ] **Step 1: 先写 failing tests**

至少覆盖：

- repeated failure / no progress / repeated error signature 会产生 `suggest`
- 同一 trace 不重复 suggest
- 刚拒绝同类 suggestion 后进入 cooldown
- 用户接受 suggest 后进入与 manual ask 相同的 preview/send 闭环
- phase-2 仍不允许自动越过确认直接发送
- `askMaster.canonicalStatus = suggested` 会稳定出现在 trace metadata / trace command 视图中

- [ ] **Step 2: 实现 suggest 生命周期**

要求：

- `suggest` 与 `manual` 共用 caller flow
- `suggest` 必须 materialize 到已有 Ask Master trace 语义中的 `suggested` 阶段
- 接受 suggest 后应生成正式 preview
- 拒绝 suggest 后写入 suppression
- 触发理由必须可解释
- trace 导出与 `metabot master trace --id ...` 必须能读到 `suggested` 状态，而不是只存在内存态

- [ ] **Step 3: 跑 targeted tests**

Run:

```bash
npm run build
node --test tests/master/masterSuggestFlowPhase2.test.mjs tests/master/masterTraceMetadata.test.mjs tests/master/masterTraceCommand.test.mjs
```

Expected: PASS

---

## Task 5: 实现 Selector 与策略门控

**目标：** 明确 Ask Master 在 phase-2 中“问谁”和“能不能继续”的统一规则，避免 host skill 自己猜、也避免 trusted/official 语义漂移。

**文件：**

- Create: `src/core/master/masterSelector.ts`
- Create: `src/core/master/masterPolicyGate.ts`
- Modify: `src/core/master/masterDirectory.ts`
- Modify: `src/core/config/configTypes.ts`
- Modify: `src/core/config/configStore.ts`
- Modify: `src/core/master/masterHostAdapter.ts`
- Test: `tests/master/masterSelectorPolicy.test.mjs`

- [ ] **Step 1: 先写 failing tests**

至少覆盖：

- 用户显式点名优先于目录排序
- `masterKind`、online、host mode、official、trusted 会影响排序
- `askMaster.enabled=false` 时完全不触发
- `confirmationMode=always` 下永远需要确认
- `triggerMode=manual` 时 suggestion 不应对外出现

- [ ] **Step 2: 实现 selector / policy**

要求：

- selector 不创建新 transport 逻辑
- policy gate 只决定“是否继续”和“摩擦等级”
- phase-2 继续沿用当前 `trustedMasters = master pin id` 的语义，不在本阶段扩大成多标识格式
- phase-2 默认排序应保持与当前 phase-1 runtime 兼容：
  - explicit match
  - same `masterKind`
  - trusted
  - official
  - online
  - updatedAt
- trusted 只影响候选与摩擦，不直接绕过所有门控

- [ ] **Step 3: 跑 targeted tests**

Run:

```bash
npm run build
node --test tests/master/masterSelectorPolicy.test.mjs tests/config/askMasterConfig.test.mjs
```

Expected: PASS

---

## Task 6: End-to-End 验收与安装后 smoke

**目标：** 确保 fresh install 的 host 能直接得到正确 Ask Master 体验，不再出现代码是 `master`、技能却还在指导 `advisor` 的割裂状态。

**文件：**

- Modify: `tests/e2e/masterAskHostFlow.test.mjs`
- Modify: `tests/skillpacks/buildSkillpacks.test.mjs`
- Modify: `docs/hosts/codex-agent-install.md`
- Modify: `tests/cli/masterCommand.test.mjs`
- Modify: `tests/daemon/masterRoutes.test.mjs`
- Modify: `tests/master/masterTraceMetadata.test.mjs`
- Modify: `tests/master/masterTraceCommand.test.mjs`
- 如需要，补充：
  - `docs/superpowers/plans/2026-04-20-ask-master-phase2-smoke-checklist.zh-CN.md`

- [ ] **Step 1: 增补 e2e / smoke tests**

至少覆盖：

- fresh build + fresh skillpack install 后，host contract 中只有 `master` 语义
- 如果选择保留 `skills resolve` 作为验证路径，则该命令必须已在 Task 1 中得到真正支持
- 自然语言 manual ask 能 preview / confirm / send / read response
- suggestion 接受后走相同闭环
- trace 里仍可见 Ask Master metadata

- [ ] **Step 2: 跑最终验证**

Run:

```bash
npm run build
npm run build:skillpacks
node --test tests/master/*.test.mjs
node --test tests/skillpacks/buildSkillpacks.test.mjs tests/cli/skills.test.mjs
node --test tests/e2e/masterAskHappyPath.test.mjs tests/e2e/masterAskHostFlow.test.mjs tests/e2e/fixtureHarness.test.mjs
```

Expected: PASS

---

## 开发顺序要求

Phase-2 必须按以下顺序推进：

1. 先修 skill / host / install 合同
2. 再做 context collector / packager
3. 再做 manual host ask
4. 再做 suggest flow
5. 最后收 selector / policy 与 e2e

不能把顺序反过来。否则很容易再次出现：

- runtime 已经是 `master`
- host skill 仍在指挥 `advisor`
- 手测失败却不是 runtime 真失败

---

## 风险清单

### 风险 1：host skill 与 runtime 再次漂移

缓解：

- repo 内 `SKILLs/metabot-ask-master/SKILL.md` 作为唯一源
- skillpack build test 做硬断言

### 风险 2：collector 过度采集，破坏隐私边界

缓解：

- allowlist + budget + preview
- tests 中显式覆盖 `.env` / credentials / keys 排除

### 风险 3：suggest 过于频繁，打扰用户

缓解：

- suppression/cooldown state
- 同一 trace 单次 suggest
- 显式 reject 后冷却

### 风险 4：selector/policy 被 skill 层私自重写

缓解：

- 选择与门控放在 runtime 层
- skill 只表达 host-facing contract，不复制内部规则

---

## Phase-2 验收标准

- fresh install 后，`metabot-ask-master` skill 明确使用 `metabot master` 命令族
- host 中用户可用自然语言明确 Ask Master，并看到 preview
- 用户确认后能收到结构化 `master_response`
- repeated failure 场景下，系统会产生可解释 suggest
- 用户接受 suggest 后进入同一 preview/send 流
- 用户拒绝 suggest 后不会立刻再次被提示
- phase-1 的 transport / trace / timeout 语义不被破坏
- 不出现隐式整仓上传、`.env` 上传、credentials 上传

---

## 一句话总结

Phase-2 的正确方向不是再扩一层 CLI，而是把 Ask Master 做成一个真正面向 host 的协作入口：用户自然说、系统自动整理上下文、合适时机建议、严格 preview 确认、底层继续走 `master-service + simplemsg + trace` 这条已经稳定的主线。
