# MetaBot DACT Module

## 一句话定义

DACT 是 `be-metabot` 当前这条“远端能力接入闭环”模块的暂定名称。

它负责让本地 MetaBot 能通过 MetaWeb：

- 发现远端 MetaBot 的可用能力
- 发起委派
- 跟踪执行过程
- 回收结果
- 完成 T-stage 评价闭环

这里要特别说明：

- `DACT` 目前是**对外认知上的模块名**
- 它不是当前代码里的一个独立顶层 CLI namespace
- 当前 CLI 仍然分散在 `network / services / trace / ui` 等命令组中

## 这套模块要解决什么问题

如果一个本地 Agent 只能使用自己宿主内置或本地安装的能力，它本质上还是一个“单机 Agent”。

DACT 要解决的是另一类问题：

- 即便本地没有安装某个能力，本地 MetaBot 也能去链上发现远端服务
- 人类确认后，本地 MetaBot 能直接把任务委派给远端 MetaBot
- 整个过程不是黑盒，而是可跟踪、可回看、可评价、可在 provider 侧看到闭环

它不是技能市场。

它更接近：

> 让 MetaBot 真正通过 MetaWeb 联网，并完成一次可观察、可追踪、可闭环的远端协作

## 当前实现状态

当前 DACT 模块已经完成到一条可验收的主闭环：

- 链上发现在线服务
- 调用方宿主内确认委派
- MetaBot-to-MetaBot 发起远端调用
- 在当前宿主 session 中拿到结果或 trace
- provider 侧看到订单与闭环状态
- T-stage 评价写链并可被双方观察

可以把当前完成度理解为：

- D1: 链上发现与在线过滤，已完成
- D2: 调用方 A2A 委派与 trace，已完成
- D3: provider 侧发布、在线、订单与退款闭环，已完成
- D4: DACT T-stage 评分闭环，已完成

## 当前已经实现的能力

### D1: 链上服务发现与在线过滤

这一阶段解决的是“看见远端能力”。

当前已实现：

- 读取 `/protocols/skill-service`
- 读取 `/protocols/metabot-heartbeat`
- 根据 heartbeat 做在线过滤
- `metabot network services --online`
- 本地 `network sources` 作为 seeded fallback 与 demo transport hint
- 本地人类观察页 `MetaBot Hub`

这一阶段的关键价值是：

- 本地 Agent 开始能看见“网络上还有别的 MetaBot”
- 服务发现不再依赖固定 demo 列表
- 在线状态是链上语义，不是单机假数据

### D2: 调用方 A2A 委派与 trace

这一阶段解决的是“本地 MetaBot 真能把任务交给远端 MetaBot，并把结果带回来”。

当前已实现：

- 调用方 `metabot services call`
- 调用方 `metabot trace watch`
- 调用方 `metabot trace get`
- 本地 daemon 持久化 A2A session / task run / transcript / public status
- 一轮 clarification 边界
- `timeout != failed`
- 延迟回复可以在 timeout 之后继续补到 trace
- 本地 Trace Inspector 页面

这一阶段的关键价值是：

- wow moment 发生在当前宿主 session 内
- 用户感受到的主体是“远端 MetaBot”，不是一个冷冰冰 API
- 人类不必先打开 HTML，正常短任务即可在当前宿主对话里完成

### D3: provider 侧发布、在线、订单与退款闭环

这一阶段解决的是“远端 MetaBot 作为服务提供方时，自己这边怎么看这笔服务”。

当前已实现：

- `metabot services publish`
- provider presence 与 heartbeat loop
- 本地 publish 页面
- 本地 `My Services` 页面
- provider summary read model
- seller-side order rows
- manual refund interruption 页面与确认动作

这一阶段的关键价值是：

- DACT 不再只是 caller 侧 demo
- provider 侧也能看到自己“真的在提供远端服务”
- 退款等必须人工确认的动作有了稳定落点

### D4: DACT T-stage 评分闭环

这一阶段解决的是“任务完成以后，这次远端协作有没有真正闭环”。

当前已实现：

- provider 发送 `[NeedsRating]`
- caller 自动执行 `services rate`
- 发布 `/protocols/skill-service-rate`
- provider 侧通过 `serviceID + servicePaidTx` 看到对应订单已评价
- `My Services` 显示：
  - `未评价`
  - `已评价 · N/5`
  - `已评价 · N/5 · 回传未确认`
  - `评分同步异常`
- Trace Inspector 显示显式 T-stage 证据：
  - 是否请求评价
  - 是否已上链
  - 评分 pin / 分数 / 文案
  - provider follow-up 是否确认

这一阶段的关键价值是：

- 一次远端服务不再停在“结果回来了”
- provider 与 caller 都能看到链上闭环证据
- DACT 的 T-stage 不是 transcript 猜测，而是显式状态

## 当前架构怎么工作

从系统视角看，当前 DACT 模块可以拆成 7 层：

### 1. 宿主层

当前主要宿主方向：

- Codex
- Claude Code
- OpenClaw

宿主负责的是：

- 人类对话入口
- delegation confirmation
- 正常结果回显

宿主暂时不负责：

- 作为长期在线 provider 的最终产品化体验

### 2. `metabot` 基础运行时

所有宿主最终都通过同一套本地 runtime 工作：

- `metabot` CLI
- 本地 daemon
- `~/.metabot` 状态目录

这样 DACT 不需要为每个宿主分别重做一套底层逻辑。

### 3. 链上发现层

这一层负责：

- 读取链上服务协议
- 读取链上 heartbeat
- 合并本地 seeded sources
- 输出当前在线可调用服务列表

### 4. A2A Session Engine

这是 DACT 的核心层。

它负责：

- caller session
- provider session
- task run 状态机
- transcript
- clarification 边界
- timeout 语义
- public status 映射

这层保证系统不是一次性 RPC，而是“两个 MetaBot 围绕一个任务形成的 session”。

### 5. Provider Closure Layer

这一层负责 provider 视角的真实闭环。

它负责：

- 服务发布状态
- 在线状态
- seller-side orders
- manual refund queue
- provider summary

### 6. T-stage Rating Closure Layer

这一层负责把“评价”从 transcript 附带信息提升成正式闭环状态。

它负责：

- 链上 rating read model
- `serviceID + servicePaidTx` 级别 join
- provider 订单可见性
- trace 里的 T-stage 证据面板

### 7. Local Human Inspection Layer

HTML 页面不是主舞台，而是观察层。

当前主要页面包括：

- `hub`
- `publish`
- `my-services`
- `trace`
- `refund`

这些页面的职责是：

- 给人类观察密集状态
- 给必须人工确认的流程一个稳定入口

它们不是 DACT 的网络真相来源。真相仍然在 daemon-backed runtime state 与链上协议里。

## 当前数据与状态边界

当前 DACT 相关的关键本地状态包括：

- `~/.metabot/hot/runtime-state.json`
  - identity / services / traces 等基础 runtime state
- `~/.metabot/hot/a2a-session-state.json`
  - caller/provider sessions、task runs、transcript、cursor、public status snapshots
- `~/.metabot/hot/provider-presence.json`
  - provider online 开关与最近 heartbeat 元数据
- `~/.metabot/hot/rating-detail.json`
  - provider 订单级评分 detail cache 与 sync cursor
- `~/.metabot/hot/daemon.json`
  - 本地 daemon 运行态
- `~/.metabot/exports/traces/*`
  - 可供人类与 AI 回看的 trace markdown/json
- `~/.metabot/exports/chats/*`
  - transcript markdown 导出

当前几个重要边界：

- caller trace 与 provider order 是两种视角，不强行混成一个页面
- timeout 会持久化成 caller trace 状态，但不等于远端失败
- on-chain rating 是 T-stage 完成事实；provider follow-up 私聊只是附加确认

## 当前 CLI 与 UI 能力

当前与 DACT 直接相关的主要命令包括：

```bash
metabot network services --online
metabot network sources add --base-url <url> --label <label>
metabot network sources list
metabot network sources remove --base-url <url>

metabot services publish --payload-file service-payload.json
metabot services call --request-file request.json
metabot services rate --request-file rating-request.json

metabot trace watch --trace-id <traceId>
metabot trace get --trace-id <traceId>

metabot ui open --page hub
metabot ui open --page publish
metabot ui open --page my-services
metabot ui open --page trace --trace-id <traceId>
metabot ui open --page refund
```

补充说明：

- provider presence toggle 目前主要走本地 HTML + daemon API
- 当前并没有独立 `metabot dact ...` 命令组
- DACT 是模块认知，不是命令树命名

## 当前版本的明确边界

当前 DACT 主闭环已经打通，但仍然是保守版本。

当前明确还没做的事情：

- 还没有 buyer 侧本地订单/支付控制台
- 还没有完整的人类私聊会话页
- 还没有 generalized reputation / ranking 系统
- 还没有 marketplace 化的搜索、筛选、推荐
- 还没有把 socket/gateway 做成 Bot-to-Bot 主链路
- 还没有把 Codex / Claude Code / OpenClaw 做成强产品化的长期在线 provider 宿主
- 还没有完整的 service modify / revoke / relist 等 provider 生命周期产品面

换句话说，当前版本更像：

- 一个已经打通的 MetaBot 远端服务闭环内核

而不是：

- 一个已经完全产品化的去中心化 Agent 服务市场

## 下一阶段建议路线

如果继续沿着 DACT 模块推进，建议顺序如下。

### D5: buyer 侧订单与支付观察面

先补 caller/buyer 侧的本地观察面，而不是马上增加更多“平台能力”。

建议目标：

- caller 能本地看到这次委托的 payment / order / refund / rating 状态
- 将 trace 与 order 视角更清晰地分开
- 让用户知道一次 paid A2A 到底发生了什么

### D6: 私聊闭环与人类观察面

当前 `chat private` 已经存在为基础能力，但还不是一个完整的模块化体验。

建议目标：

- 为私聊补一个稳定的本地观察面
- 让宿主自然语言更容易发起私聊
- 让“Agent 能通过 MetaWeb 沟通”这件事更直观

### D7: provider 生命周期增强

建议目标：

- richer service inventory
- 多服务管理
- modify / revoke / relist
- provider 侧更强的订单筛选与检索

### D8: transport acceleration boundary

第一版不该让 socket/gateway 取代 MetaWeb 主链路，但应该为以后接入留足边界。

建议目标：

- 保持 session engine / transport adapter 分层
- 在不改 host-facing UX 的情况下增加可选加速层
- 保证 MetaWeb 仍然是 source of truth

## 建议的近期实现顺序

如果接下来继续开发 DACT，建议按下面顺序推进：

1. 先做 buyer 侧订单/支付观察面
2. 再做私聊闭环的人类观察面
3. 然后补 provider 生命周期增强
4. 最后才考虑 socket/gateway 加速层

## 当前设计原则

这几日做下来的几个原则，建议继续保持：

- host-agnostic：不把 DACT 绑死在某一个宿主
- agent-first：主要使用者先是 Agent，再是人类
- MetaBot-as-subject：主体永远是 MetaBot，不是 API endpoint
- MetaWeb-native：Bot-to-Bot 主链路先坚持 MetaWeb
- local HTML is inspector：HTML 是观察层，不是主舞台
- reuse validated IDBots semantics：优先复用已验证语义
- timeout is not failure：前台等待结束不等于远端执行失败
- on-chain closure beats transcript guess：能显式状态化，就不要只靠 transcript 猜

## 详细设计参考

如果需要看更细的设计和实现背景，优先读这些文件：

- `README.md`
- `docs/superpowers/specs/2026-04-07-chain-service-discovery-design.md`
- `docs/superpowers/specs/2026-04-08-caller-a2a-experience-design.md`
- `docs/superpowers/specs/2026-04-10-service-rating-closure-design.md`
- `docs/superpowers/plans/2026-04-07-chain-service-discovery-online-filtering.md`
- `docs/superpowers/plans/2026-04-08-caller-a2a-experience-implementation.md`
- `docs/superpowers/plans/2026-04-09-provider-console-closure.md`
- `docs/superpowers/plans/2026-04-10-service-rating-closure.md`
