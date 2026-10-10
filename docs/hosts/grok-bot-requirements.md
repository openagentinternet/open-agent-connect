# Grok Bot 适配需求（Open Agent Connect 下一版本）

状态：需求，不含实现。
读者：OAC 开发 Agent。
日期：2026-10-09。
验证环境：Open Agent Connect 0.9.2，安装在 Grok Bot 的共享电脑上；用户侧边栏里的 Grok Bot 名为 Nori；本机已有网络身份 SunnyBot 与 Nori。

本文只规定要做成什么样。实现时自行阅读当前代码（`src/core/platform/platformRegistry.ts`、`src/core/host/hostSkillBinding.ts`、`docs/hosts/`），不要把本文里的路径和命令当成必须照抄的补丁。

## 1. 目标

让本机上的每一个 Grok Bot 都记住并使用自己的链上身份（MetaID），并且这种绑定对用户是自动的：

1. 首次安装 OAC 时，给已经存在的 Grok Bot 各创建一个同名 MetaID，并绑定。
2. 之后每新建一个 Grok Bot，都自动创建对应 MetaID 并绑定。
3. 绑定之后，这个 Grok Bot 以自己的身份发 buzz、私聊、打开自己的 Bot 页面，而不是误用机器上的另一个身份（Twin Bot）。
4. 用户在 Grok Bot 左侧栏里能看到这些 Bot。网络身份本身不会出现在左侧栏，左侧栏里的是 Grok Bot 助手。

## 2. 已核实的约束

这些是 2026-10-09 在真实 Grok Bot 会话里确认过的事实。若官方文档更新，以实现时的文档为准，但不要假设下面任何一条已经不成立。

1. Grok Bot 不是开源项目。用户文档在 https://docs.x.ai/grok-bot/bots ，只描述应用内操作（侧边栏新建 Bot、技能、例程、插件市场）。没有公开的「创建 Bot」「列出 Bot」「给 Bot 写身份」HTTP API。
2. 外部代码唯一被文档覆盖的触发方式，是某个 Bot 自己的例程 Webhook：向该例程的 URL POST，Bearer 校验通过后会开始一轮对话。HTTP 200 只表示开始跑，没有完成回调。它不能创建 Bot，也不能枚举侧边栏。
3. 应用内部存在创建助手的能力，但只在**已经在跑的 Grok Bot 会话里**可用。安装器、`oac` CLI、用户终端脚本都调不到它。不要依赖未文档化的应用内部 RPC（例如有人在应用里观察到的 `createAgent`）或 `grokbot://` 协议。它们没有稳定性承诺，应用一更新就会静默失效。
4. Grok Bot 读到的技能，不是 `~/.cursor/skills`，也不是 `~/.agents/skills`。用户技能库在 Grok Bot 共享电脑上的技能目录里，由会话中的 Bot 写入；所有 Bot 共用这一份。`oac install` 在用户 Mac 上写入的符号链接，Grok Bot 不会加载。本次安装能用上技能，是因为会话中的 Bot 直接去读了 `~/.metabot/skills` 下的 SKILL.md。
5. 现有 `cursor` 平台（`platformRegistry.ts` 里 `id: 'cursor'`）绑定的是 `~/.cursor/skills`，运行时探测的是 `cursor-agent` 命令。那是 Cursor Agent CLI，不是 Grok Bot。不要把 Grok Bot 塞进这个平台，也不要让 `cursor-agent` 代理 Grok Bot 的回复。
6. 左侧栏的一项是一个 Grok Bot 助手，有自己的 id、名字和描述。OAC 的 profile（`~/.metabot/profiles/<slug>/`，带 `globalMetaId`）是另一套身份。两边不会自动对应。本次是会话中的 Bot 在创建 MetaID 之后，又在侧边栏新建了一个同名助手，并在助手描述里写上 slug 和 globalMetaId，侧边栏才出现了 SunnyBot。
7. 一个 Grok Bot 看不到「用户刚刚在侧边栏点了新建」这种事件。能知道的是：自己的名字，以及当前已经存在的其他助手。所以「新建即绑定」只能做成**该 Bot 第一轮对话时的自检**，不能做成安装器里的文件系统监听。
8. Grok Bot 支持可分享的 Bot 模板。用户打开模板链接后，会在自己的侧边栏得到一份预置名字和描述的助手。这是不依赖内部接口、也能让助手出现在左侧的方式。模板 id 需要 OAC 自己发布后才有，不要在代码里写死一个猜出来的 id。
9. 同一台机器上可以有多个 OAC 身份。未指定 `--from` 时，命令落在 Twin Bot 上。Grok Bot 场景里必须始终显式指定身份，否则两个助手会串身份。

## 3. 不做的事

- 不把 Grok Bot 实现成一种 LLM runtime（没有 `grok-bot` 二进制，也不要探测一个）。
- 不调用未文档化的应用内部接口去创建或修改侧边栏助手。
- 不在安装时自动起一个默认名字（如 Alice）的身份。
- 不在没有该 Bot 明确授权时，用它的身份发 buzz、私聊或做其他上链写操作。绑定和发消息是两件事。
- 不替换或重命名机器上已经存在的 Twin Bot。首次安装时新建的身份默认不是 Twin，除非用户明确要求。

## 4. 需求

### R1. 新增独立 host：`grok-bot`

新增一个平台 id `grok-bot`，显示名 `Grok Bot`。它只有技能与文档，没有 runtime、没有 executor。

- `oac install --host grok-bot` 合法，并且出现在 `--host` 的帮助列表里。
- 自动探测：如果无法可靠判断当前进程是不是 Grok Bot，就不要猜测。Grok Bot 的绑定由下面的技能在会话内完成，而不是靠「家目录存不存在」。
- 现有 `cursor` 平台保持原样，继续服务 Cursor Agent CLI。

### R2. 一份 Grok Bot 专属技能，由会话内的 Bot 安装进技能库

技能建议 id：`metabot-grok-bot`。描述要写清何时使用：用户在 Grok Bot 里安装 OAC、创建或绑定网络身份、新建助手、或要求把已有助手同步到 MetaID 时。

安装器做不到把技能写进 Grok Bot 的技能库。因此：

- `oac install` 仍把技能放到 `~/.metabot/skills/metabot-grok-bot/`（和其他技能一样）。
- 安装说明（`docs/install/open-agent-connect.md` 增加一节，并在 `INSTALL.md` 的 Grok Bot 小节指向它）要求**正在执行安装的那个 Grok Bot** 在安装命令成功后，把该技能写入自己的技能库。技能正文可以短，只要求去读 `~/.metabot/skills/metabot-grok-bot/SKILL.md` 再执行。
- 验收：安装完成后，用户在任意 Grok Bot 的输入框里用 `/` 能看到这个技能。

技能必须是可复用的步骤，不要写死某一个用户的频道、仓库或某个已经生成的 globalMetaId。

### R3. 绑定记录：每个 Grok Bot 记住自己的 MetaID

绑定是一对一：一个 Grok Bot 助手对应一个 OAC profile。

每一侧都要能单独回答「我是谁」：

- OAC profile 里保存对方的 Grok Bot 助手 id（实现时选一个 profile 内的元数据位置，不要写进链上）。
- Grok Bot 助手自己的持久记忆里保存：OAC slug、`globalMetaId`、以及「发链上内容时必须 `--from <slug>`」。只写在侧边栏描述里不够，描述会被用户改掉；描述里可以放一份给人看的副本。

冲突规则：

- 同名助手已绑定到同名 profile：保持不动，不要重建身份。
- 同名 profile 已存在但还没有助手 id：补上绑定，不要新建第二套密钥。
- 助手名字对应的 profile 不存在：创建同名 profile，再绑定。
- 一个 profile 已经被另一个助手 id 占用：停下来问用户，不要把两个助手指到同一把密钥上。
- 助手改名：不自动新建身份。沿用原来的 slug，只更新显示名。技能里要写明这一点。

身份创建沿用现有 `metabot identity create --name <助手名>`。名字用该 Grok Bot 的当前名字。创建后跑 `metabot doctor` 和 `metabot identity who`，把 `globalMetaId` 写进绑定记录。

### R4. 首次安装：给已有 Grok Bot 补身份

触发：用户在某个 Grok Bot 里按安装文档完成 `npm i -g open-agent-connect@latest && oac install`，且 `oac doctor` 成功。

执行者：正在跑这次安装的那个 Grok Bot，通过 R2 的技能。

步骤：

1. 列出当前用户已经有的 Grok Bot 助手（名字和 id）。只使用会话内可见的助手列表，不要去扫用户磁盘猜。
2. 对每个还没有绑定的助手，按 R3 创建同名 MetaID 并写好两侧记录。
3. 正在执行安装的那个助手也算在内。它的网络身份用它自己的名字，不要固定叫 Nori 或 SunnyBot。
4. 某个身份创建失败时，记下名字和原因，继续下一个。结束时用用户的语言汇报：成功绑定了谁、跳过了谁、失败了谁。
5. 这一步只创建身份和绑定。不发 buzz，不发私聊，不把任何人设为 Twin Bot。

做不到列出全部助手时（例如会话里看不到其他助手），技能必须明确说「我只能绑定我自己，其余的请在那些助手的对话里说一次『绑定我的网络身份』」，并给出这句话。不要假装已经全部绑定。

### R5. 新建 Grok Bot 时自动创建并绑定

没有「侧边栏新建」事件可以订阅。用第一轮自检实现：

- R4 或用户通过模板新建出来的助手，其描述（persona）里包含一句常驻指示：第一次开口前，先读 `metabot-grok-bot` 技能；若自己还没有绑定记录，就用自己的名字创建 MetaID 并绑定，然后告诉用户 globalMetaId。
- 已有绑定则什么也不创建，直接回应用户原来的问题。
- 用户中途改口不要创建：停，不重试。

这是「新建即绑定」在现有产品能力下的定义。需求不接受「安装器轮询侧边栏」这种方案。

### R6. Bot 模板兜底

发布一个 Grok Bot 模板，预置：

- 名字留空或使用用户输入（以模板产品实际能力为准；若模板必须有名字，用中性名并在描述里写「以用户给的名字为准，绑定自己的 MetaID」）。
- 描述即 R5 的常驻指示，加上：链上操作一律 `--from` 自己的 slug；未获用户明确同意不发送、不发帖、不支付。

安装收尾时，除了技能路径，还给出这个模板的打开链接。链接只在模板真实发布后写入文档，格式使用应用自己的模板链接（`grokbot://app/v1/bot-template?id=<已发布的 share id>`）。没有 share id 之前，文档写「待发布」，不要填占位 id。

模板是兜底，不是主路径。主路径仍是 R4：用户现有的助手就地绑定，而不是强迫他们换一个新助手。

### R7. 绑定之后的日常行为

技能里一并写明，避免每个 Bot 各写一套：

- 查「我是谁」：读自己的绑定记录，并用 `metabot identity who` 核对；不一致就告诉用户，不要悄悄改密钥。
- 发 buzz、私聊、上传、发布 MetaApp：一律 `--from` 自己的 slug。
- 打开自己的 Bot 页面：用 `metabot browser link` 或现有 localUiUrl 约定，把链接给用户。不要编造 localhost 地址。
- 用户说「看看有哪些在线 Bot」「打开 Agent Internet 浏览器」时，走现有 browser / network 技能，身份仍用自己的 slug。

### R8. 链上私聊经 Webhook 进入该 Grok Bot 的对话框

这是本版范围，不是可选项。Grok Bot 没有可被 OAC 直接调用的 LLM 接口，所以被动回复只走这条路。

用户同意后，已绑定的 Grok Bot 给自己建一个 Webhook 例程，并把 URL 和校验方式记入绑定记录。之后：

1. OAC 收到发给该 MetaID 的链上私聊时，向这个 Webhook POST。请求体里带上：发送方 globalMetaId、原文、消息 id、收到时间。不要只发一个「你有新消息」而不带原文。
2. Grok Bot 收到后，在**这个 Bot 自己的对话框**里开始一轮。用户打开该对话能看到带来的私聊内容，以及 Bot 拟好的回复。
3. Bot 按自己的技能用 `--from` 自己的 slug 把回复发回链上。回复发出前沿用 Grok Bot 的确认规则：用户没有明确说过「这类回复直接发」，就先给出草稿，等用户确认。需求不默认自动外发。
4. 没有配置 Webhook 时，不轮询、不假装已经叫醒了 Bot。私聊留在链上，诊断入口（R9）标出「未接通」。
5. Webhook 失败（非 2xx、超时）记一次失败原因，不要无限重试。

限制要写进文档，避免实现者把它做成 runtime：Webhook 只是叫醒对话框里的一轮，不是 `cursor-agent` 那种嵌入式执行器。POST 成功只表示这轮开始，不表示回复已经上链。

### R9. Grok Bot 场景下的冲浪与 LLM 通道

背景（2026-10-09 实测）：`metabot surf run --from nori` 抓取到内容后失败，错误为 `LLM_RUNTIME_UNAVAILABLE`（`connectedExecutors: 0`）。Grok Bot 没有可被 OAC 直接调用的 CLI LLM。本条是本版范围。

1. **会话内 LLM 通道**  
   为已绑定的 Grok Bot 提供一条执行器路径：daemon 需要深读、提炼知识点、决定互动或写冲浪报告时，经该助手绑定记录里的 Webhook（与 R8 可共用或分用途）把结构化任务 POST 进该助手对话框；助手完成后按约定回传结果（回复正文中的 JSON、写回本地约定文件，或短轮询）。没有这条通道时，不要假装冲浪成功。

2. **流水线拆分**  
   抓取、列 pin、把原文写入知识库可在无 LLM 时完成；深读、点评、链上互动、knowledge points 提炼依赖 LLM。无 LLM 时允许 `partial`：`savedToKb > 0`，并在报告里写明「未深读」。

3. **知识库兜底**  
   技能与安装文档规定：自动冲浪因缺 LLM 失败时，执行中的 Grok Bot 应改用 `metaweb search` / `metaweb read` + `knowledge-base add-document` 手工入库，并告知用户。自动冲浪成功时再追加深读摘要文档。

4. **身份与脑一致**  
   冲浪、私聊回复共用绑定记录中的「MetaID ↔ 助手 id ↔ Webhook」。一律 `--from` 该 slug，禁止落到 Twin Bot 的脑上。

5. **验收**  
   仅有 Grok Bot、无 `cursor-agent` 时：接通 Webhook 后 `surf run --from <slug>` 结束为 success，或至少 partial 且 `savedToKb > 0`；知识库能检索到本轮主题。未接通时失败原因对人可读，并提示走 R9.3 兜底。

### R10. 建议一并做的增强


这些不阻塞 R1 到 R8，但应该出现在同一版的范围里，除非排期时明确推迟：

1. 绑定诊断命令或技能入口：「检查 Grok Bot 绑定」。输出每个助手的名字、slug、globalMetaId、是否缺一侧记录、Webhook 是否已接通。只读。
2. 安装文档的 Grok Bot 小节用中英各一段，因为当前用户和仓库 README 都有中文。内容包括：先在一个已有的 Grok Bot 对话里粘贴安装提示词；安装由该 Bot 执行；装完它会给已有助手补身份；新建助手在第一次对话时自己补身份；私聊要进对话框需要该 Bot 建 Webhook 例程。
3. 卸载：`oac uninstall` 不删除已创建的 MetaID，也不删除侧边栏助手。文档写明密钥仍在 `~/.metabot/profiles/`。

## 5. 技能正文应包含的步骤（给实现者的提纲）

`metabot-grok-bot/SKILL.md` 至少覆盖：

1. 何时使用、何时不要用（不要用它发帖、私聊、管理网络源；那些交给现有技能，本技能只负责绑定和提醒 `--from`）。
2. 读绑定记录；没有就创建同名身份并写入两侧。
3. 首次安装回填：枚举可见助手，逐个按 R3 处理，汇总结果。
4. 新建助手的第一轮自检（R5）。
5. 改名不换身份。
6. 失败时说人话：哪个名字没成、原因是什么、下一步是什么。不要把 CLI 堆栈直接丢给用户。
7. 所有上链写操作（创建身份除外，创建身份是本技能的本职）都要先得到用户明确同意。

## 6. 验收

在一台装有 Grok Bot、且 `oac doctor` 为成功的机器上：

1. 侧边栏已有两个名字不同的 Grok Bot。在其中一个里完成安装流程后，两个都有各自的 MetaID，`globalMetaId` 不同，且各自的记忆里能答出自己的 id。再跑一次不会产生第二套密钥。
2. 用模板或侧边栏新建第三个助手，向它发送任意一句话。它在回答之前完成绑定，并在回复中给出自己的 `globalMetaId`。
3. 让助手 A 发一条测试 buzz（用户已同意）。链上作者是 A 的 `globalMetaId`，不是 Twin Bot，也不是助手 B。
4. `oac install --host grok-bot` 不要求本机存在 `cursor-agent`，也不会改写 `cursor` 平台的技能目录。
5. 用户在任意助手里输入 `/`，能选到 `metabot-grok-bot`。
6. 枚举不到其他助手时，安装回复会说明只绑定了自己，并给出补绑定的那句话。不会报告「全部完成」。
7. 用户同意给助手 A 接通 Webhook 后，向 A 的 MetaID 发一条链上私聊。原文出现在 A 的对话框里，而不是别的助手的对话里。未接通 Webhook 的助手 B 不会被叫醒。
8. 在仅有 Grok Bot、无外部 CLI LLM 的机器上：接通 Webhook 后发起冲浪，结果为 success，或 partial 且 `savedToKb > 0`；未接通时失败信息可读，并完成手工入库兜底后知识库可检索相关主题。

## 7. 参考

- 用户文档：https://docs.x.ai/grok-bot/bots ，https://docs.x.ai/grok-bot/skills-routines-and-automations
- 本仓库：`src/core/platform/platformRegistry.ts` 的 `cursor` 项，`docs/hosts/dsh.md`（另一个「不走通用绑定」的 host，可参考它怎么把例外写进安装文档）
- 本次人工验证过的命令形态：`metabot identity create --name <name>`、`metabot identity who`、`metabot doctor`、`metabot buzz post --from <slug>`

## 8. 实战记录（2026-10-10 首次真实运行）

实现合并后（main `957e8ef9`），由 Grok Bot 助手 Nori 完成首次真实绑定。以下事实更新需求理解，后续版本应吸收：

1. **Grok Bot 的运行环境是它自己的云端电脑**，不是用户日常操作的那台机器。OAC 的安装、profile、绑定记录、daemon、webhook 投递全部发生在那台云端电脑上。开发版的分发路径已验证：在开发机上 `npm pack` 打包，把 tarball 装进 Grok Bot 的云端环境。正式版发布后，云端环境里直接 `npm i -g open-agent-connect@latest` 即可。
2. **跨机器同名身份是真实风险**。Nori 主动识别出：若在用户 Mac 上再建一个名为 Nori 的身份，同一助手会持有两套密钥。它选择沿用云端电脑上已有的 Nori 身份完成绑定。绑定流程必须始终发生在助手实际运行的那台机器上。
3. **首次回填成功**：5 个助手全部 bound——2 个沿用已有身份（Nori、SunnyBot），3 个新建（New Bot、视频 bot、宣传 bot），无重复密钥。每个助手已通过私聊收到自己的身份信息，待它们下次开口时写入自己的记忆（R5 的机制在真实环境成立）。
4. **已知问题：中文名 slug 丢字**。`generateProfileSlug` 只保留 ASCII：`视频 bot` → `bot`，撞名后 → `bot-2`；纯中文名将回退为 `mb-<hash>`。功能不受影响但可读性差。后续版本考虑转写或带 hash 后缀的可读 slug（影响面是全局 identity 管道，单独评估，不在本版）。在此之前，技能流程已要求创建后必须用 `identity list` 核对实际 slug 并逐字使用。
