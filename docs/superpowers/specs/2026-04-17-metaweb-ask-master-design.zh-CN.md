# MetaWeb Ask Master 设计说明

**日期：** 2026-04-17

## 1. 文档目的

本设计文档用于重新定义 `Ask Master` 的产品形态与技术边界，替换此前“将 master 作为 skill-service 上 advisor profile”的旧思路。

本轮重新对齐后的核心结论是：

- 我们要做的是 **MetaWeb 版的 advisor-tool**
- 用户心智是 **Ask Master**
- `master-service` 必须与 `skill-service` 分开
- 底层技术可尽量复用技能服务已有框架
- MetaWeb 的技术哲学是：**把 MetaWeb 看作一台大电脑，不同 MetaBot 是这台电脑上的不同 Agent 线程/进程，它们通过区块链消息总线进行沟通**

### 1.1 参考来源

本设计的重要灵感来源于 Claude 官方的 advisor-tool 机制说明：

- Claude 官方文档：<https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool>

后续如果文档维护时间较长，其他 AI 或开发者可以通过该链接快速理解这里所说的 “advisor-tool” 指的是什么，以及它在自动/半自动触发、自动上下文打包、任务流程内协作等方面的设计思路。

---

## 2. 产品目标

`Ask Master` 的目标不是做一个“特殊技能服务”，也不是做一个“远端执行平台”的别名，而是让本地 Agent 在任务推进过程中，可以在合适时机向更强的远端 Master Agent 请求协作帮助。

理想体验应接近 advisor-tool：

- 本地 Agent 正在工作
- 系统在合适时机自动或半自动判断“值得请教 Master”
- 系统自动打包当前任务上下文
- 按策略决定是否需要用户确认
- 请求通过 MetaWeb 发给远端 Master
- 远端 Master 返回结构化帮助
- 本地 Agent 在当前会话里继续执行

用户应感受到：

> 我不是一个人写程序。我的本地 Agent 在需要时，可以通过 MetaWeb 去请教另一端更强的 Agent。

---

## 3. 产品心智

### 3.1 Ask Master 与 Skill Service 是两个产品

`Ask Master` 与普通 `skill-service` 不是同一产品层级。

两者的区别在于：

- `skill-service` 更像可被显式调用的远端能力目录
- `Ask Master` 更像任务流程中的高阶协作机制
- `skill-service` 偏“功能调用”
- `Ask Master` 偏“任务协作与求助”
- `skill-service` 通常由用户或 Agent 明确选择使用
- `Ask Master` 可以由系统自动或半自动触发

因此，`master-service` 必须在产品语义、发现入口、元数据结构、调用方式上都与 `skill-service` 分开。

### 3.2 MetaWeb 大电脑模型

本产品采用如下技术哲学：

- MetaWeb 是一台大电脑
- 不同 MetaBot 是这台大电脑上的不同 Agent
- 链上共享状态可被无许可读取与写入
- 链上消息总线承担跨 Agent 的沟通职责

在这个模型下，`Ask Master` 可以被理解为：

- 一个 Agent 在任务执行过程中，向另一个更适合的 Agent 发起协作请求

---

## 4. 总体设计原则

### 4.1 独立产品语义，复用底层框架

应复用技能服务已有的底层技术框架，但不复用它的产品定义。

应复用的包括：

- 链上发布与读取框架
- 本地目录缓存与索引逻辑
- provider presence / online 状态维护
- 本地 daemon、state store、trace 体系
- skillpack 构建与 host 封装方式
- `simplemsg` 私聊能力

不应复用的包括：

- `skill-service` 产品语义
- `services call` 作为 Ask Master 的主要调用语义
- “master 只是特殊 skill”的定义

### 4.2 CLI 先行，skill 通用封装

实现顺序应为：

1. 先实现独立的 `master-service` 协议与 CLI
2. 再通过通用 skill 封装自然语言使用方式

这里的 skill 是跨 host 通用层，不是 Codex 专属层。

Codex 当前只是开发与验收平台，不代表未来要为 Codex 做专门产品分支。

### 4.3 尽量向 advisor-tool 靠拢

本产品应尽量参考 advisor-tool 的机制，而不是只参考其命令表面。

需要重点借鉴的机制包括：

- 自动或半自动触发，而不是每次全靠用户手动发起
- 自动构建上下文，而不是每次手工拼 request
- 在任务关键时机介入，而不是只作为一个孤立命令
- Master 作为本地 Agent 的协作对象，而不是替代本地 Agent

### 4.4 不依赖 CoT

系统不应依赖 CoT 判断是否卡住，也不应把读取 CoT 作为产品依赖。

`Ask Master` 的触发与上下文构建，应基于可观测任务轨迹，例如：

- 用户消息
- assistant 可见输出
- 最近若干轮 prompt / response
- 工具调用及其结果
- 终端报错
- 测试输出
- diff 与文件变更
- 当前计划 / todo

### 4.5 总开关必须存在

`Ask Master` 必须有明确总开关。

当总开关关闭时：

- 不进行相关监控
- 不运行相关调度程序
- 不进行自动建议
- 不进行自动发起
- 不进行上下文采集

---

## 5. 架构分层

`Ask Master` 的正确分层应为：

### 5.1 公共发现层：`master-service`

负责：

- Master 发布
- Master 列表发现
- Master 元数据读取
- Master 匹配与选择

这层是公开可见的目录层。

### 5.2 私密通讯层：`simplemsg`

真正的 `Ask Master` 请求与响应，不应走明文公开链上内容，而应通过 `simplemsg` 私聊协议传输。

原因：

- Ask Master 传输的通常是任务上下文
- 可能包含代码片段、报错、任务计划、会话摘要
- 做成公开明文既不必要，也不合适

因此：

- discovery 走 `master-service`
- communication 走 `simplemsg`

### 5.3 消息语义层：`master_request` / `master_response`

`Ask Master` 不需要新起一套消息传输协议，但需要在 `simplemsg` 消息体内部定义自己的结构化消息类型。

建议消息类型：

- `master_request`
- `master_response`

它们是 `simplemsg` 中的 envelope 类型，不是新的 transport family。

### 5.4 本地调度层：`Master Invocation Engine`

本地 runtime 需要一个专门的调度器，负责：

- 监控任务上下文
- 判断是否值得 Ask Master
- 选择合适的 Master
- 打包上下文
- 决定是否确认
- 发送与等待响应
- 回写本地 trace / host 会话

---

## 6. Provider 侧模型

Provider 侧应先配置自己的 MetaBot，并通过独立的 `master-service` 发布能力。

### 6.1 Provider 发布内容

`master-service` 至少应包含：

- `serviceName`
- `displayName`
- `description`
- `masterKind`
- `specialties`
- `hostModes`
- `modelInfo`
- `style`
- `pricingMode`
- `price`
- `currency`
- `responseMode`
- `contextPolicy`
- `official`
- `trustedTier`

### 6.2 `master-service` 的产品意义

`master-service` 不是普通技能目录项，而是代表一个“可被系统级协作机制调用的 Master”。

它应支持：

- 被列表发现
- 被自动匹配
- 被配置为 trusted master
- 被触发引擎自动或半自动选中

### 6.3 V1 Provider 供给

V1 先支持官方 master，至少保留：

- Official Debug Master

后续可扩展：

- Architecture Master
- Review Master
- 其他垂类 Master

### 6.4 V1 轻量发布路径

从快速实现角度，V1 不要求先做复杂的发布 UI。

建议初期采用最轻量的发布方式：

1. 提供一个 `master-service` JSON 模板
2. 由 Provider 自己填写必要字段
3. 再通过本地 Agent / skill 调用 CLI 完成发布

这种方式的优点是：

- 实现轻
- 易于验收
- 能快速形成一批结构相对规范的官方或半官方 Master
- 比手输零散参数更不容易发布出乱七八糟的信息

建议的初期 CLI 形态：

```bash
metabot master publish --payload-file master-service.json
```

建议模板示意如下：

```json
{
  "serviceName": "official-debug-master",
  "displayName": "Official Debug Master",
  "description": "面向调试与排障场景的官方 Master。",
  "masterKind": "debug",
  "specialties": [
    "debugging",
    "failing tests",
    "runtime diagnosis"
  ],
  "hostModes": [
    "codex",
    "claude-code",
    "openclaw"
  ],
  "modelInfo": {
    "provider": "metaweb",
    "model": "official-debug-master-v1"
  },
  "style": "direct_and_structured",
  "pricingMode": "free",
  "price": "0",
  "currency": "SPACE",
  "responseMode": "structured",
  "contextPolicy": "standard",
  "official": true,
  "trustedTier": "official"
}
```

V1 对模板字段的要求是：

- 字段尽量少而明确
- 尽量使用可枚举值
- 避免发布者自由填写过多营销化、噪音化信息

后续如果发布链路成熟，再考虑：

- 发布表单
- 模板校验助手
- 更丰富的 metadata
- 官方模板市场

---

## 7. Caller 侧模型

Caller 侧不应主要依赖“用户每次手动指定一个 MetaBot”，而应以任务协作流程为主。

Caller 侧应包括：

- 人类用户
- 当前 host 会话
- 本地 MetaBot
- 本地 daemon
- 本地 `Master Invocation Engine`

---

## 8. Master Invocation Engine

### 8.1 作用

`Master Invocation Engine` 是 Ask Master 的核心运行时模块。

它负责把“是否询问远端 Master”从单个手动命令，提升为任务流程中的一环。

### 8.2 组成

建议由以下模块组成：

#### A. Context Collector

自动收集任务上下文，包括：

- 当前任务摘要
- 最近会话上下文
- 相关工具调用与结果
- 测试失败信息
- 当前 diff
- 相关文件摘要或片段
- 最近几轮失败尝试

#### B. Trigger Engine

根据任务轨迹判断是否应当触发 Ask Master。

建议支持三类触发：

- `manual`
- `suggest`
- `auto`

#### C. Master Selector

根据当前任务类型，从 `master-service` 列表中选择最合适的 Master。

选择依据包括：

- `masterKind`
- `specialties`
- `hostModes`
- 是否官方
- 是否 trusted
- 是否在线
- 成本策略

#### D. Context Packager

将自动收集的上下文打包成可发送的 `master_request`。

#### E. Dispatch Policy

决定：

- 是否需要用户确认
- 是否允许自动发起
- 是否进行冷却与限流

---

## 9. 触发机制

### 9.1 触发模式

建议支持三种模式：

- `manual`
  - 仅当用户明确要求时才发起
- `suggest`
  - 系统检测到值得请教 Master 时，向用户提出建议
- `auto`
  - 系统满足策略后可自动发起

### 9.2 触发时机

参考 advisor-tool，后续理想形态应支持以下触发时机：

- 初步探索之后
- 明显卡住时
- 准备收尾前

### 9.3 是否卡住的判定

系统不依赖 CoT，而基于可观测信号进行“卡住”评分。

可用信号包括：

- 同类错误连续重复出现
- 同一测试或命令多次失败
- 多轮尝试没有实质推进
- 长时间只有搜索/阅读，没有收敛
- assistant 在公开输出中表达不确定或卡住
- 任务复杂度高且当前方案风险上升

注意：

- “卡住”只是触发原因之一，不是唯一触发条件

### 9.4 冷却与限流

为避免频繁打扰，应支持：

- 每任务最大触发次数
- 同类问题冷却时间
- 用户拒绝后的抑制周期

---

## 10. 总开关与策略配置

建议引入如下配置：

- `askMaster.enabled`
- `askMaster.triggerMode`
- `askMaster.confirmationMode`
- `askMaster.contextMode`
- `askMaster.trustedMasters`

语义建议如下：

### 10.1 `askMaster.enabled`

- `true`
- `false`

当为 `false` 时，完全关闭 Ask Master 相关监控与调度。

### 10.2 `askMaster.triggerMode`

- `manual`
- `suggest`
- `auto`

### 10.3 `askMaster.confirmationMode`

- `always`
- `sensitive_only`
- `never`

长期目标不应把“每次必须人工确认”写死为架构前提。

V1 可以默认 `always`，但架构要允许未来向更自动的模式演进。

### 10.4 `askMaster.contextMode`

- `compact`
- `standard`
- `full_task`

### 10.5 `askMaster.trustedMasters`

用于标记可被自动或低摩擦调用的 Master 列表。

---

## 11. 上下文模型

### 11.1 方向

上下文策略不应像旧 advisor MVP 那样被过早限制为极小上下文。

既然要尽量接近 advisor-tool，就应支持自动打包较完整的任务上下文。

### 11.2 分层模式

建议分层：

#### `compact`

- 当前问题
- 当前目标
- 最近错误
- 最近 diff
- 极少量相关文件

#### `standard`

- 最近任务上下文
- 若干轮会话
- 关键工具结果
- 测试输出
- 相关文件摘要与片段

#### `full_task`

- 当前任务完整会话
- 更完整的工具轨迹
- 更完整的文件摘要与片段
- 最近多轮尝试历史

### 11.3 共享边界

在 MetaWeb 大电脑模型下，应尽量放宽对“任务上下文”的传输限制，但仍要保留私有边界。

默认不应隐式发送：

- `.env`
- credentials
- 私钥
- wallet secrets
- 与当前任务无关的本地私有文件

---

## 12. 通讯模型

### 12.1 发现与通讯分离

完整调用流程应为：

1. 通过 `master-service` 发现目标 Master
2. 通过 `simplemsg` 发送 `master_request`
3. 通过 `simplemsg` 收到 `master_response`
4. 本地 runtime 将过程映射为 trace 与 host 会话输出

### 12.2 `master_request`

`master_request` 应是 `simplemsg` 中的结构化消息体，包含至少：

- 类型标识
- caller 身份信息
- 目标 master 标识
- 当前任务摘要
- 上下文包
- 触发原因
- 期望输出模式
- trace / correlation 标识

### 12.3 `master_response`

`master_response` 应是结构化消息体。

为了不把 Master 长期能力边界锁死，响应模型应允许扩展，不应仅限于“诊断 + next steps”。

V1 可以有默认结构化字段，但消息协议本身应保留扩展能力。

---

## 13. CLI 设计

建议提供独立 CLI：

```bash
metabot master publish --payload-file master-service.json
metabot master list
metabot master ask
metabot master trace --id <trace_id>
```

其中：

- `master publish`
  - 通过结构化 JSON 模板发布一个 `master-service`
  - 适合作为 V1 最轻量的 provider 发布入口
- `master list`
  - 查看当前可用的 master-service
- `master ask`
  - 手动发起一次 Ask Master
  - 也可被 skill 作为统一调用入口
- `master trace`
  - 读取一次 Ask Master 的 trace 与结果

后续如有必要，可扩展：

```bash
metabot master config
metabot master enable
metabot master disable
```

---

## 14. Skill 封装原则

Skill 仍然重要，但它是 CLI 之上的通用封装层。

Skill 需要负责：

- 识别自然语言里的 Ask Master 意图
- 调用 `metabot master ...` CLI
- 展示结果
- 将结果回注当前 host 会话

Skill 不应负责：

- 自己发明一套底层传输逻辑
- 自己绕过本地 runtime 的触发与策略层
- 直接替代 `Master Invocation Engine`

---

## 15. Trace 与状态

`Ask Master` 应有独立 trace 语义，但底层仍可复用现有 trace 基础设施。

建议状态包括：

- `discovered`
- `suggested`
- `awaiting_confirmation`
- `requesting_remote`
- `remote_received`
- `master_responded`
- `completed`
- `timed_out`
- `failed`

需要强调：

- `timed_out` 仍然表示“本地停止等待”，不等于远端 definitively failed

---

## 16. V1 范围

V1 建议做到：

- 独立 `master-service`
- 独立 `master list / ask / trace` CLI
- `simplemsg` 作为实际通讯通道
- `master_request / master_response` 结构化消息
- 独立 trace 语义
- Ask Master 总开关
- `manual` 与 `suggest` 两种模式
- 默认 `confirmationMode = always`
- 官方 Debug Master fixture
- 通用 skill 封装

V1 暂不强求：

- 完整 `auto` 自动发起
- 多轮开放式持续对话
- 远端直接改本地代码
- 全量信任自动模式

---

## 17. 后续扩展方向

后续阶段可扩展：

- `auto` 触发模式
- trusted master 自动调用
- 更多 master 种类
- 更丰富的结构化响应
- 多轮协作
- 更强的任务上下文自动打包
- 对 host 侧更多运行时事件的接入

---

## 18. 对现有 `open-advisor-mvp` 分支的评估

当前 `codex/open-advisor-mvp` 分支属于旧路线样机。

其问题在于：

- 把 Master 做成了 `skill-service` 上的 `advisor` profile
- 把产品语义收窄成了 advisor
- 把调用主路径绑定在原 `services call` 思路上

这些都与本次重新对齐后的需求不一致。

### 18.1 可复用部分

可以复用：

- preview / confirmation contract 的实现经验
- 结构化 request / response 校验思路
- trace 与 timeout 处理经验
- provider fixture 思路
- skillpack 构建经验

### 18.2 不应继续沿用部分

不应继续沿用：

- `advisor` 命名作为主产品概念
- `skill-service` discovery 作为 Ask Master 的主入口
- `services call` 作为 Ask Master 的主调用语义

### 18.3 建议

建议将当前分支保留为旧路线验证样机参考，不直接作为最终产品分支继续迭代。

在本 spec 定稿后，再决定：

- 从主干新开分支重做
- 或从旧分支抽取可复用模块迁移

当前倾向是：

- **以新 spec 为准，重新评估并重建实现路径**

---

## 19. 一句话总结

我们要做的是：

> 一个 MetaWeb 版 advisor-tool，用户心智叫 Ask Master；Master 作为独立 `master-service` 被发现，真正的请求与响应通过 `simplemsg` 私密通讯完成，本地 runtime 在手动、半自动、自动三种模式下调度远端 Master 协作，让不同 MetaBot 像同一台大电脑中的不同 Agent 一样工作。
