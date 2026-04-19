# Ask Master Phase-2 Skillpack / 安装 / Prompt 合同一致性设计说明

**日期：** 2026-04-20

## 1. 文档目标

本文档定义 Ask Master phase-2 的 host 技能分发与安装一致性要求。

它只解决这些问题：

- Ask Master skill 的 repo 真相源在哪
- skillpack 如何把 Ask Master skill 渲染给不同 host
- 安装文档如何保证重新安装后获得最新合同
- 如何避免“runtime 是 master，技能还在说 advisor”的漂移

本文档**不处理**：

- Ask Master runtime 业务逻辑
- selector / collector / suggest 的内部算法
- provider 侧逻辑

---

## 2. 设计原则

### 2.1 repo 内必须存在 Ask Master skill 源

phase-2 Task 1 必须把 Ask Master 技能源纳入 repo：

- `SKILLs/metabot-ask-master/SKILL.md`

不能继续依赖：

- 某台开发机上已经安装好的 skill
- 手工拷贝到 `~/.codex/skills` 的临时版本

### 2.2 skillpack 构建是唯一分发路径

host 实际安装的 Ask Master skill 必须来自：

- `scripts/build-metabot-skillpacks.mjs`

而不是：

- 人工复制文件
- 在 host 本地直接热修

### 2.3 安装文档必须明确“重装可覆盖旧 skill”

phase-2 的安装说明必须直接告诉用户：

- 重新执行 build + install 会覆盖旧 skill 目录
- 这是修复旧 `advisor` 残留的标准路径

### 2.4 skill 合同必须只说真话

Ask Master 技能合同中不能再出现：

- `metabot advisor list`
- `metabot advisor ask`
- `metabot advisor trace`

也不能指导 host：

- 走 private chat
- 手工写 simplemsg
- 直接走 `services call`

---

## 3. 现状问题

当前已暴露出的真实问题是：

- 仓库 runtime 已经切换到 `metabot master`
- 但 host 上安装的 `metabot-ask-master` skill 仍可能残留旧 `advisor` 合同

这会导致：

- 用户测试时走错路径
- host 误调用旧命令族
- 看起来像“产品功能不通”，其实是安装合同漂移

因此 phase-2 必须把：

- repo skill 源
- skillpack build
- install runbook
- host resolved contract

当成同一条产品链路来治理。

---

## 4. Source Of Truth

### 4.1 repo 源

phase-2 目标态下，唯一真相源应为：

- `SKILLs/metabot-ask-master/SKILL.md`

### 4.2 build 渲染

由：

- `scripts/build-metabot-skillpacks.mjs`

负责把 Ask Master skill 渲染到：

- `skillpacks/codex/skills/metabot-ask-master/SKILL.md`
- `skillpacks/claude-code/skills/metabot-ask-master/SKILL.md`
- `skillpacks/openclaw/skills/metabot-ask-master/SKILL.md`

### 4.3 安装落点

安装脚本把 skillpack 复制到 host 目录，例如：

- Codex: `${CODEX_HOME:-$HOME/.codex}/skills`

因此 host 侧看到的技能合同，本质上是 repo 源的派生产物。

---

## 5. Ask Master skill 最小合同

repo 内 Ask Master skill 至少应明确：

- 何时应触发 Ask Master
- 只使用 `metabot master list/ask/trace`
- 先 preview，后确认
- 不走 private chat
- 不走 `/protocols/simplemsg` 手工发送
- 不走旧 `advisor` 命令族
- 不走 `services call`

另外还应明确：

- local agent 仍是执行者
- remote Master 只负责给建议与结构化帮助

---

## 6. 构建脚本要求

`scripts/build-metabot-skillpacks.mjs` 在 phase-2 必须满足：

- `METABOT_SKILLS` 中包含 `metabot-ask-master`
- host README 的 skill 列表能看到它
- build test 会硬断言三套 host output 都有该技能

如果未来 Ask Master 合同再次变化，必须先改 repo 源，再 rebuild skillpacks。

---

## 7. 安装文档要求

`docs/hosts/codex-agent-install.md` 在 phase-2 中至少要说明：

- 需要执行：

```bash
npm install
npm run build
npm run build:skillpacks
cd skillpacks/codex
./install.sh
```

- 重新安装会覆盖旧的 `metabot-ask-master`
- 在 Task 1 落地前，如要确认 host 上的新 skill 已生效，应直接检查安装后的：
  - `${CODEX_HOME:-$HOME/.codex}/skills/metabot-ask-master/SKILL.md`
- 只有当 Task 1 已把 `metabot-ask-master` 接入 `baseSkillRegistry` 之后，才可额外使用：
  - `metabot skills resolve --skill metabot-ask-master --host codex --format markdown`
  - 但它验证的是 repo/base contract，不是已安装 host skill 本体

文档还应提醒：

- 新开 session 可能是必要的

---

## 8. Contract 验证路径

phase-2 至少应提供两种自动验证：

### 8.1 构建产物验证

通过：

- `tests/skillpacks/buildSkillpacks.test.mjs`

断言：

- Ask Master skill 已进入三套 host pack
- 合同中使用 `master` 而不是 `advisor`

### 8.2 CLI resolve 验证

如果 phase-2 继续把 `metabot skills resolve` 作为用户可见验证路径，则 Task 1 还必须同步修改：

- `src/core/skills/baseSkillRegistry.ts`

为 `metabot-ask-master` 增加 machine-first base contract。

这里要特别说明：

- `skills resolve` 验证的是 machine-first base contract
- `skillpacks/*/skills/metabot-ask-master/SKILL.md` 验证的是实际分发给 host 的 markdown skill
- `${CODEX_HOME:-$HOME/.codex}/skills/metabot-ask-master/SKILL.md` 验证的是当前机器上已安装并生效的 host skill

两者不是同一文件，但语义必须一致。

通过：

- `tests/cli/skills.test.mjs`

断言：

- `metabot skills resolve --skill metabot-ask-master --host codex`

返回的合同中：

- 不含 `advisor ask`
- 包含 `metabot master ask`

---

## 9. 明确不允许的状态

phase-2 明确不允许以下状态继续存在：

- runtime 是 `master`，skill 还是 `advisor`
- repo 中没有 Ask Master skill 源，只能靠本机已有副本
- install 文档不提 rebuild skillpacks
- host resolve 出来的合同与 runtime 命令族不一致

这些都应被视为：

- 产品可用性 bug

而不是“文档小问题”。

---

## 10. 测试要求

至少覆盖：

- Ask Master skill 被纳入 build 输出
- host README 列出该技能
- resolve 出来的合同使用 `master` 命令族
- 合同中不含 `advisor list/ask/trace`
- 安装 runbook 与 skillpack 构建步骤一致

---

## 11. 一句话总结

phase-2 必须把 Ask Master 的 repo 技能源、skillpack 构建、安装文档、host resolved contract 统一成一条可验证的分发链路；否则 runtime 再正确，用户实际拿到的体验也可能仍然是旧世界的 `advisor` 幻影。
