# Ask Master Phase-2 Host 适配与自然语言入口设计说明

**日期：** 2026-04-20

## 1. 文档目标

本文档定义 Ask Master 在 phase-2 中的 host-facing 入口层。

它只解决这些问题：

- host 中“自然语言 ask master”如何落到现有 `metabot master` runtime
- host adapter 应负责什么、不负责什么
- manual ask 与 suggest accept/reject 如何走统一入口
- host adapter、skill、runtime 三者的分工边界

本文档**不处理**：

- `master-service` 发布与发现协议细节
- `master_request / master_response` schema
- provider runtime 逻辑
- 具体上下文收集算法
- selector / policy 的内部打分细节

---

## 2. 设计原则

### 2.1 Host adapter 是编排入口，不是第二 runtime

host adapter 负责：

- 接收自然语言意图
- 调用 selector / collector / preview / confirm 流
- 把结构化结果回注当前 host 会话

host adapter 不负责：

- 手写 `simplemsg`
- 绕开 `metabot master ask`
- 发明第二套 trace 语义
- 在 skill 里复制一套 selector / policy

### 2.2 用户看到的是 Ask Master，不是底层 transport

host 里的正确心智是：

- “去问问 Debug Master”
- “系统建议要不要问 Master”
- “先给我预览再发”

而不是：

- “我要发一条 simplemsg”
- “我要调一个底层 route”
- “我要自己写 request json”

### 2.3 manual 与 suggest 必须走统一 caller flow

不论来源是：

- 用户显式 ask
- 系统 suggest 后用户接受

都必须收敛到同一条 runtime 闭环：

1. resolve target
2. collect/pack context
3. build preview
4. await confirmation
5. dispatch
6. integrate response

### 2.4 phase-2 仍坚持 preview / confirmation

即使 host 里能自然语言发起，也不能跳过：

- preview
- confirmation

phase-2 的目标是降低用户摩擦，不是降低安全边界。

---

## 3. 与现有实现的关系

### 3.1 当前 phase-1 已有基线

当前仓库已具备：

- `metabot master list`
- `metabot master ask --request-file ...`
- `metabot master ask --trace-id ... --confirm`
- `metabot master trace --id ...`
- `masterTriggerEngine` 的最小 `manual + suggest`
- `masterPreview` 与 pending ask store

### 3.2 当前缺口

phase-1 的主要缺口不是 runtime 不存在，而是 host-facing 入口还不够完整：

- 用户仍容易被引导去手写 request file
- host skill / install 合同仍可能残留旧 `advisor` 语义
- suggest 还没有完整接成 host 中的 accept/reject 流

因此 phase-2 的核心不是重写 runtime，而是补齐 host adapter 层。

---

## 4. 分层模型

建议 phase-2 使用以下分层：

1. `Host Intent Layer`
   - 识别显式 ask、接受 suggest、拒绝 suggest
2. `Host Adapter`
   - 统一编排入口
3. `Runtime Services`
   - selector / collector / packager / preview / pending store / dispatch / response integrator
4. `Existing Ask Master Runtime`
   - `metabot master` 命令与 daemon handlers

关键约束：

- host adapter 不直接做 transport
- host adapter 不直接读 provider inbox
- host adapter 不直接篡改 trace artifacts

### 4.1 必须有明确的 host bridge surface

phase-2 不能只增加一个内部 adapter 模块而没有可调用入口。

建议新增一条 machine-first host bridge：

- CLI：
  - `metabot master host-action --request-file host-action.json`
- daemon route：
  - `POST /api/master/host-action`

它负责承接：

- `manual_ask`
- `accept_suggest`
- `reject_suggest`

这不是新的用户心智入口，而是：

- host skill / host shim 调用 Ask Master runtime 的桥接面

---

## 5. Host 输入模型

### 5.1 三类入口动作

phase-2 host adapter 至少支持三类动作：

```ts
type HostAskMasterAction =
  | {
      kind: 'manual_ask';
      utterance: string;
      preferredMasterName?: string | null;
      preferredMasterKind?: string | null;
    }
  | {
      kind: 'accept_suggest';
      traceId: string;
      suggestionId: string;
    }
  | {
      kind: 'reject_suggest';
      traceId: string;
      suggestionId: string;
      reason?: string | null;
    };
```

### 5.2 显式 manual ask

以下表达应被视为明确 manual ask：

- “去问问 Debug Master 这个问题”
- “Ask Master 一下这个 bug”
- “先给我 preview 再发给 Debug Master”

对这类输入：

- 不应再做“要不要 suggest”的额外判断
- 应直接进入 host adapter 的 manual ask 路径

### 5.3 suggest accept / reject

当系统已经产出 suggestion 时，host adapter 需要接住：

- 用户接受
- 用户拒绝

接受后：

- 进入 preview

拒绝后：

- 写入 suppression state
- 当前会话不应继续就同一建议纠缠

---

## 6. Host adapter 输出契约

phase-2 host adapter 不应发明第二套 command state。

它应继续返回现有：

- `MetabotCommandResult<T>`

并在 `data` 中补充 host-facing 载荷。

建议最小模型：

```ts
type HostAskMasterData = {
  hostAction: 'manual_ask' | 'accept_suggest' | 'reject_suggest';
  traceId: string;
  suggestionId?: string | null;
  preview?: Record<string, unknown>;
  response?: Record<string, unknown>;
  rejected?: boolean;
};
```

状态映射必须继续复用现有 runtime 语义：

- preview 阶段：
  - `state = awaiting_confirmation`
- 用户确认并完成实际发送后：
  - 默认立即返回 `state = success`
  - `data` 中携带稳定的 `traceId / requestId / session` 等 in-flight 信息
- `state = waiting`：
  - 只保留给显式 polling / watch 一类接口
  - 不是普通 confirm/send 的默认返回状态
- 已收到结构化结果：
  - `state = success`
- suggestion 被拒绝：
  - 推荐 `state = success`，并在 `data.rejected = true`
- 缺少能力或门控失败：
  - `state = failed`

这样 host 可继续沿用现有 `commandResult` / route typing / tests，而不需要再适配一套新状态名。

---

## 7. 与 skill 的关系

### 7.1 skill 负责“触发与措辞”，不负责“实现”

repo 内的 `metabot-ask-master` skill 负责：

- 告诉 host 什么时候该用 Ask Master
- 指导 host 优先走本地 `metabot master` runtime
- 保持不走 private chat / simplemsg 直发

skill 不应负责：

- 自己做 selector
- 自己做 policy gate
- 自己组装 transport payload

### 7.2 skill 是 repo 内的源，不是本机临时副本

phase-2 必须明确：

- Task 1 会新增 `SKILLs/metabot-ask-master/SKILL.md` 作为 repo 源
- `scripts/build-metabot-skillpacks.mjs` 负责渲染到 `skillpacks/*/skills/`
- 安装后 host 使用的是生成产物

不能继续依赖开发机上历史残留的 `~/.codex/skills/metabot-ask-master` 作为真相源。

---

## 8. 与 `metabot master ask` 的关系

### 8.1 Host adapter 不是替代品

phase-2 仍然把 `metabot master ask` 视为 Ask Master caller runtime 的主入口。

host adapter 的作用是：

- 帮用户自动完成 draft 构造
- 自动调用 preview
- 自动把确认后的请求继续送到已有 runtime

### 8.2 仍应复用 pending ask 语义

确认后不应重算原始输入，而应继续复用：

- pending snapshot
- stable `traceId`
- stable `requestId`

这样才能保持：

- trace 稳定
- preview 与 send 一致
- host-facing 结果可信

---

## 9. phase-2 host 交互流

### 9.1 manual ask

```text
用户自然语言明确 ask
-> host adapter 识别 manual_ask
-> selector 选目标 Master
-> collector / packager 生成 draft
-> runtime build preview
-> host 展示 preview
-> `awaiting_confirmation`
-> 用户确认
-> runtime 发送
-> response integrate
-> 当前 host 会话展示结构化结果
```

### 9.2 suggest accept

```text
trigger engine 输出 suggest
-> host 展示建议
-> 为当前任务 materialize 一条 Ask Master trace，`askMaster.canonicalStatus = suggested`
-> 用户接受
-> host adapter 进入 accept_suggest
-> 与 manual ask 共用 preview/send 流
```

### 9.3 suggest reject

```text
trigger engine 输出 suggest
-> host 展示建议
-> suggestion 与 traceId 绑定
-> 用户拒绝
-> host adapter 进入 reject_suggest
-> 写 suppression / cooldown
-> 本轮结束
```

---

## 10. 明确禁止的 fallback

phase-2 host adapter 必须禁止以下 fallback：

- fallback 到 private chat
- fallback 到手工 `/protocols/simplemsg`
- fallback 到旧 `advisor` 命令族
- fallback 到 `services call`
- fallback 到“只给用户一段 preview 文案但其实没经过 runtime”

如果当前环境缺少必要能力，正确做法应是：

- 返回现有 command result 语义里的 `failed`
- 明确说明缺失项

而不是静默换路。

---

## 11. 测试要求

至少覆盖：

- 自然语言 manual ask 会进入 `awaiting_confirmation`
- 用户确认后默认返回 `success`，且返回值保留 in-flight/session 信息
- suggest accept 会复用同一 caller flow
- suggest reject 会写入 suppression，不再立即重复提示
- host adapter 不会走 private chat / services call fallback
- host adapter 返回的 `traceId` 与 runtime trace 一致

推荐测试分层：

- 单元测试
  - host action normalization
  - host adapter handoff
- 集成测试
  - manual ask -> preview -> confirm -> response
  - suggest accept / reject
- e2e 测试
  - fresh skill install 后的自然语言 Ask Master 流

---

## 12. 一句话总结

phase-2 的 host adapter 本质上是 Ask Master 的“本地协作入口编排层”：它把用户的自然语言求助意图或系统 suggestion，稳定地接入现有 `metabot master` runtime，而不是再造一层 transport 或让 skill 自己偷偷换路。
