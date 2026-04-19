# Ask Master Phase-2 Suggest 流设计说明

**日期：** 2026-04-20

## 1. 文档目标

本文档定义 Ask Master phase-2 中 `suggest` 的完整 host-facing 流程。

它只解决这些问题：

- 何时从 trigger engine 的内部决定投影成用户可见 suggest
- suggestion 在 host 中如何展示、接受、拒绝
- accept / reject 后如何进入 caller flow 或 suppression
- 如何避免重复打扰

本文档**不处理**：

- trigger engine 的全部评分细节
- manual ask 的自然语言识别细节
- selector 的排序算法细节
- context collector 的具体实现

---

## 2. 设计原则

### 2.1 Suggest 是用户可感知产品流，不只是一个内部 decision

phase-1 已经有：

- `manual_requested`
- `suggest`
- `auto_candidate`

但 phase-2 要求 `suggest` 不再只是内部结构，而要成为：

- 一个用户可看到的建议
- 一个可接受、可拒绝、可抑制的产品流

### 2.2 Suggest 不等于自动发送

phase-2 中：

- `suggest` 只能进入“建议 -> preview -> confirm -> send”
- 不能直接发送

因此 phase-2 的 suggest 仍然坚持：

- 有用户确认
- 有 preview
- 有 suppression

### 2.3 Accept 后必须复用 manual ask 主线

用户接受 suggest 后，不应再进入另一条独立发送路径。

必须共用：

- selector
- collector / packager
- preview builder
- pending ask
- dispatch / response integrate

### 2.4 Reject 必须是强信号

用户明确拒绝一个 suggestion 后：

- 不能下一轮又用同一理由继续提示
- rejection 必须进入 suppression / cooldown state

---

## 3. 与现有触发引擎的关系

### 3.1 当前 phase-1 基线

现有 `masterTriggerEngine` 已具备：

- 最小 observation normalization
- `manual_requested / suggest / no_action`
- 基础 suppression memory

### 3.2 phase-2 扩展目标

phase-2 不要求重写 trigger engine，而是要求：

- 把 `suggest` 变成完整 host 流
- 补充 accept / reject 生命周期
- 补强 suppression / cooldown
- 让 suggestion 原因对用户可解释

---

## 4. Suggest 生命周期

### 4.1 生成

当 observation 满足条件时：

- trigger engine 输出 `suggest`

host adapter 随后需要：

- 调 selector 看是否存在可执行 target
- 构造一个 suggestion view model
- materialize 一条与当前任务绑定的 Ask Master trace

如果没有可执行 target：

- 不应对用户展示一个无法执行的 suggest
- 也不应生成悬空的 `suggested` trace

### 4.2 展示

host 中展示 suggestion 时至少应包含：

- 为什么建议问 Master
- 建议的 master kind 或 display name
- 这是建议，不是已发送
- 接受后会先进入 preview

### 4.3 接受

用户接受 suggestion 后：

- 写一条 acceptance 事件
- 进入统一 host adapter ask 流
- 生成 preview

### 4.4 拒绝

用户拒绝 suggestion 后：

- 写 rejection 事件
- 更新 suppression / cooldown
- 本轮结束

### 4.5 失效

如果 suggestion 生成后：

- target master 下线
- 配置被关闭
- 当前问题状态明显已推进

则 suggestion 应过期，不再强推进入 preview。

---

## 5. Suggest 输出模型

建议 host-facing suggestion 结构至少包括：

```ts
type AskMasterSuggestion = {
  suggestionId: string;
  traceId: string;
  candidateMasterKind: string | null;
  candidateDisplayName: string | null;
  reason: string;
  confidence: number;
  createdAt: number;
};
```

其中：

- `suggestionId` 用于 accept/reject 追踪
- `traceId` 必须存在，因为 phase-2 的 suggestion 需要和 Ask Master trace 的 `suggested` 状态绑定
- `reason` 必须可解释

### 5.1 与 `suggested` 规范状态的关系

phase-2 不应绕开 phase-1 已定义的 caller 规范状态。

当一个 suggestion 真正对外展示时：

- 应 materialize 一条 caller trace
- 并写入：
  - `askMaster.canonicalStatus = suggested`

这样 accept / reject / suppress 才能围绕稳定的 `traceId` 运作。

---

## 6. Suppression / Cooldown

### 6.1 目标

suggest 流如果没有 suppression，很容易变成：

- 频繁提示
- 用户刚拒绝又来
- 同一错误签名无限重复

### 6.2 最小 suppression 维度

phase-2 建议至少按以下维度抑制：

- 当前 trace
- `masterKind`
- 错误签名
- 最近一次 reject 的 suggestionId

### 6.3 最小策略

建议最小策略：

- 同一 trace 最多 suggest 一次
- 用户明确 reject 后，短时间内不再 suggest 同类问题
- manual ask 或 accept suggest 后，不再立刻重复 suggest
- 同一错误签名在短窗口内只提示一次

### 6.4 Reset 条件

当以下条件出现时，可解除部分 suppression：

- 错误签名发生变化
- 当前任务进入新的 trace / 新阶段
- 用户显式再次要求 ask master

---

## 7. 与 preview 的关系

### 7.1 Suggest 不能直接显示最终 request

suggest 的展示内容不等于 preview。

建议阶段只需告诉用户：

- 是否值得问
- 为什么值得问
- 可能问谁

真正发送前的上下文细节，应在 preview 阶段展示。

### 7.2 Accept 后必须进入 preview

phase-2 明确要求：

```text
suggest
-> user accept
-> preview
-> user confirm
-> send
```

不能变成：

```text
suggest
-> user accept
-> send
```

preview 阶段的规范状态仍然应是：

- `awaiting_confirmation`

而不是新发明一个 `preview_ready` 状态名。

---

## 8. 与 `auto_candidate` 的关系

phase-2 中：

- `auto_candidate` 仍只保留架构位
- 不作为公开默认路径

也就是说，phase-2 的建议流只做：

- `manual`
- `suggest`

不开放：

- 无确认自动发送

---

## 9. 用户文案要求

suggest 的 host-facing 文案应满足：

- 可解释
- 不强迫
- 不误导为已发送

推荐文案信息要素：

- 当前为什么建议问 Master
- 推荐的目标是谁
- 接受后会先预览
- 拒绝后系统会暂停同类提示

不建议文案：

- “我已经帮你问了”
- “必须问”
- “这是唯一正确路径”

---

## 10. 测试要求

至少覆盖：

- 满足 repeated failure 条件会产生 suggest
- 没有在线/匹配 Master 时不会对外展示 suggest
- accept suggest 后进入 preview flow
- reject suggest 后写入 suppression
- 同一 trace 不重复 suggest
- phase-2 中 suggest 不会直接发送

推荐测试分层：

- 单元测试
  - suggestion projection
  - suppression update
- 集成测试
  - suggest -> accept -> preview
  - suggest -> reject -> cooldown
- e2e 测试
  - repeated failure host flow 出现 suggestion 并能被接受

---

## 11. 一句话总结

phase-2 的 suggest 流不只是“系统心里觉得值得问 Master”，而是一个真正可见、可接受、可拒绝、可抑制的协作入口；它帮助用户在合适时机问 Master，但绝不偷偷替用户发送。
