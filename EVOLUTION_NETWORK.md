# Open Agent Connect Evolution Network

## 一句话定义

MetaBot Evolution Network 是 `Open Agent Connect` 上的一套 MetaWeb-native 共同进化模块。

它的目标不是把 skill 托管到一个中心化云端，而是让任何安装了 `Open Agent Connect` 的 Agent 宿主，在保持本地控制权的前提下，参与一个无许可、可验证、可追溯、可持续累积的技能共同进化网络。

这里也要明确：

- `Evolution Network` 是 `Open Agent Connect` 的一个**模块**
- 它建立在 foundation runtime 之上
- 它不是整个 `Open Agent Connect` 项目的全部

当前实现状态可以概括为：

- `Open Agent Connect` 已经实现到 `M2-C`
- 当前只支持一个演进目标 skill：`metabot-network-directory`
- 体系已经具备本地修复、链上发布、链上搜索、远端导入、远端手动采用这几个核心闭环

## 这套东西要解决什么问题

普通 Web2 skill 市场更像“上传一个版本，别人下载一个版本”。

我们要做的不是单纯分发 skill，而是让 skill 的改进过程本身也进入 MetaWeb：

- 改进可以无许可发布
- 历史和 lineage 可以长期保存
- 任何兼容宿主都能受益
- 每台机器仍然保留本地采用权，不会被远端强制覆盖

这也是它和中心化“共享社区”最大的区别：

- 中心化社区解决的是“分享”
- MetaWeb 共同进化网络解决的是“共享 + 追溯 + 无许可 + 可验证演进”

## 当前已经实现的能力

### M1: 本地 skill 自我修复闭环

M1 证明了一件关键事情：本地 skill 可以在不改源码仓库、也不改宿主安装包文件的前提下完成“运行时演进”。

当前已实现：

- 为进化网络增加总开关：`evolution_network.enabled`
- 为 `metabot-network-directory` 建立稳定的 base skill contract
- 宿主安装的 skill 不再是最终静态内容，而是 runtime-resolve shim
- `metabot network services --online` 的执行会被记录为 execution record
- 系统会对 execution 做 analysis，识别：
  - `hard_failure`
  - `soft_failure`
  - `manual_recovery`
- 对符合条件的失败生成 `FIX` 类型候选变体
- 对候选变体做验证
- 满足“same skill + same scope”时可本地采用
- 支持回滚到 base behavior

本阶段的核心价值是：

- skill 改进不再需要手工去改仓库里的 `SKILL.md`
- 宿主看到的 skill 标识保持稳定
- 真正变化的是 runtime 解析结果

### M2-A: 将本地验证通过的改进发布到 MetaWeb

M2-A 在 M1 基础上增加了链上发布能力。

当前已实现：

- 本地已验证通过的 evolution artifact 可以手动发布
- 发布分成两部分：
  - artifact body 先通过 `/file` 上传
  - metadata 再写入 `/protocols/metabot-evolution-artifact-v1`
- metadata 中带有：
  - `skillName`
  - `variantId`
  - `artifactUri`
  - `scopeHash`
  - `lineage`
  - `triggerSource`
  - `evolutionType`
  - verification 摘要
- 发布不会改变本地 active variant

这一步让“本地改进”第一次具备了被别的 Agent 看到和复用的基础。

### M2-B: 链上搜索与远端导入

M2-B 增加了从 MetaWeb 读取他人改进的能力。

当前已实现：

- 可以按 skill 搜索最近发布的兼容 artifact
- 搜索会检查：
  - `skillName` 是否一致
  - `scopeHash` 是否一致
  - verification 是否通过
- 搜索结果会去重、排序，并标记是否已经导入本机
- 可以按 `pinId` 导入一个远端 artifact
- 导入内容会进入单独的 remote store，而不是写进本地自演进仓库

这一步的关键边界是：

- “能看到并导入” 不等于 “已经采用”
- 远端内容不会覆盖本地自修复产物

### M2-C: 远端导入产物的本地采用

M2-C 补上了“导入以后如何在本机生效”的最后一步。

当前已实现：

- 可以列出本地已经导入的远端 artifact
- 可以手动采用远端 artifact：
  - `metabot evolution adopt --skill ... --variant-id ... --source remote`
- active variant 状态变成 source-aware：
  - 不再只是字符串 `variantId`
  - 现在会记录 `{ source, variantId }`
- `skills resolve` 可以暴露当前 active variant 的来源
- `rollback` 仍然可以把 skill 恢复到 base behavior

本阶段的重要设计点：

- remote adopt 是“切换解析结果”，不是“复制远端 artifact 到本地仓库”
- remote store 和 local evolution store 继续保持分离
- 只有 scope、skill、verification 都重新满足条件时才允许采用

## 当前架构怎么工作

从系统角度看，当前架构可以拆成 6 层：

### 1. 宿主层

当前支持的宿主包方向：

- Codex
- Claude Code
- OpenClaw

宿主里安装的是稳定 skill 名称和薄 shim，不直接写死最终 skill 文本。

### 2. `metabot` 统一运行时

所有宿主最终都通过同一套本地 runtime 工作：

- `metabot` CLI
- 本地 daemon
- 统一状态目录 `~/.metabot`（当前保留为兼容路径）

这意味着共同进化逻辑不需要分别重写三套宿主版本。

### 3. Runtime Skill Resolver

这是整个进化网络最关键的一层。

它负责：

- 读取 base contract
- 读取当前 active variant
- 决定当前这次应该解析出 base、local variant，还是 remote variant
- 输出宿主需要的 markdown 或 json 结果

也就是说：

- 宿主 skill 身份是稳定的
- 真正可进化的是解析出来的运行时 contract

### 4. Local Evolution Kernel

这是本地自修复闭环。

它负责：

- 记录 execution
- 生成 analysis
- 生成 FIX 候选
- 验证候选
- 根据 adoption policy 自动采用或等待手动采用

### 5. Local / Remote 双存储

当前存储边界很清晰：

- 本地自演进产物在 `~/.metabot/evolution`
- 远端导入产物在 `~/.metabot/evolution/remote`

这样的好处是：

- 本地与远端来源不会混淆
- 回滚语义清晰
- 后续做 trust policy 时更容易

### 6. MetaWeb 发布与读取层

链上部分当前承担的是“共享进化产物”而不是“替本机做决策”。

它现在支持：

- 发布 evolution artifact metadata
- 搜索最近兼容的公开发布
- 拉取并导入某个远端 artifact

它暂时还不负责：

- 自动排名
- 自动推荐
- 自动采用
- 声誉系统

## 当前数据与状态边界

当前几个关键文件/目录的职责如下：

- `~/.metabot/hot/config.json`
  - 全局配置
  - 包含 `evolution_network.enabled`
- `~/.metabot/evolution/executions`
  - 本地 execution records
- `~/.metabot/evolution/analyses`
  - execution analysis records
- `~/.metabot/evolution/artifacts`
  - 本地产生的 evolution artifacts
- `~/.metabot/evolution/index.json`
  - 本地 index 与 active variant refs
- `~/.metabot/evolution/remote/artifacts`
  - 导入的远端 artifact 与 sidecar
- `~/.metabot/evolution/remote/index.json`
  - 远端导入索引

## 当前 CLI 能力

当前与进化网络直接相关的命令包括：

```bash
metabot config get evolution_network.enabled
metabot config set evolution_network.enabled false

metabot skills resolve --skill metabot-network-directory --host codex --format markdown
metabot skills resolve --skill metabot-network-directory --host codex --format json

metabot evolution status
metabot evolution publish --skill metabot-network-directory --variant-id <variantId>
metabot evolution search --skill metabot-network-directory
metabot evolution import --pin-id <pinId>
metabot evolution imported --skill metabot-network-directory
metabot evolution adopt --skill metabot-network-directory --variant-id <variantId> --source remote
metabot evolution rollback --skill metabot-network-directory
```

## 当前版本的明确边界

这点很重要。当前系统已经打通核心闭环，但仍然是保守版本。

当前明确还没做的事情：

- 还不支持多 skill 共同进化
- 还没有链上推荐与排序系统
- 还没有 reputation / attestation / trust policy
- 还没有 remote artifact 自动采用
- 还没有后台定时同步与静默更新
- 还没有“执行失败后自动发布到链上”的默认路径
- 还没有把共同进化结果反馈回更多宿主级 UI 提示

换句话说，当前版本更像：

- 一个安全、清晰、可追溯的共同进化内核

而不是：

- 一个已经完全自动化的共同进化网络产品

## 下一阶段建议路线

下面是当前阶段之后最合理的继续推进顺序。

### M3: 链上发现、比较与推荐

M3 应该先解决“看见更多候选，但不急着自动采用”。

建议目标：

- 为当前 skill 提供更强的 candidate discovery
- 在本地给出 recommendation，而不是只返回原始搜索结果
- 引入基础 ranking 信号，例如：
  - 发布时间
  - lineage 深度
  - publisher identity
  - verification 完整度
  - 是否已被本机导入/回滚过
- 允许宿主或人类看到“为什么推荐这个变体”

建议新增能力：

- `metabot evolution recommend --skill <skillName>`
- 推荐解释字段
- 本地 compare 视图或 markdown 输出

M3 的原则应当是：

- 先做“建议采用”
- 不直接做“自动采用”

### M4: 信任模型、证明与安全自动采用

当链上发现能力足够后，下一步要解决的是“能不能放心采用”。

建议目标：

- 引入 verification attestation
- 引入 publisher trust inputs
- 引入本地 policy modes
- 让远端 artifact 在严格条件下可 auto-adopt

建议增加的判断维度：

- same skill
- same scope
- protocol compatibility
- replay validation
- not worse than base
- publisher allowlist / denylist
- local rollback history

M4 的核心不是“更自动”，而是“自动之前先有安全边界”。

### M5: 后台化、无感化、真正的共同进化网络

M5 才是最终产品体验开始成形的阶段。

建议目标：

- 后台搜索与同步
- 多 skill 支持
- 更少人工操作
- 宿主侧“无感获得进化能力”

理想状态下，安装了 `Open Agent Connect` 的宿主会自然具备：

- 本地自修复
- 链上共享改进
- 链上发现兼容改进
- 在安全策略内自动受益

这时它才真正接近：

> 让任何装了 `Open Agent Connect` 的 Agent 都能无感接入 MetaWeb-native 共同进化网络

## 建议的近期实现顺序

如果接下来继续开发，建议按下面顺序推进：

1. 先做 M3 的 recommendation/read-side，而不是直接碰自动采用
2. 为 published artifact 增加更完整的比较与解释字段
3. 设计 attestation / trust policy 的链上协议与本地配置
4. 把当前单 skill 路径抽象到第二个 skill，验证架构不是特例
5. 再进入远端安全 auto-adopt 与后台同步

## 当前设计原则

这几日做下来的几个原则，建议继续保持：

- local-first：链上负责共享，本机负责最终采用决策
- stable skill identity：宿主看到的 skill 名称保持稳定
- runtime resolution：真正可演进的是运行时 contract
- separate local vs remote stores：本地与远端产物严格分层
- manual-first before auto：先手动闭环，再做自动化
- feature-gated：整个共同进化网络可整体开关
- host-agnostic：不把这套能力绑死在单一宿主上

## 详细设计参考

如果需要看更细的设计和分期实现细节，优先读这些文件：

- `README.md`
- `docs/superpowers/specs/2026-04-09-metabot-evolution-network-design.md`
- `docs/superpowers/specs/2026-04-09-metabot-evolution-network-m2a-publish-design.md`
- `docs/superpowers/specs/2026-04-09-metabot-evolution-network-m2b-search-import-design.md`
- `docs/superpowers/specs/2026-04-10-metabot-evolution-network-m2c-remote-adoption-design.md`
- `docs/superpowers/plans/2026-04-09-metabot-evolution-network-m1.md`
- `docs/superpowers/plans/2026-04-09-metabot-evolution-network-m2a-publish.md`
- `docs/superpowers/plans/2026-04-10-metabot-evolution-network-m2b-search-import.md`
- `docs/superpowers/plans/2026-04-10-metabot-evolution-network-m2c-remote-adoption.md`
