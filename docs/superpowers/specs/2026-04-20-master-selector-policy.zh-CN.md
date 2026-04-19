# Ask Master Phase-2 Master Selector 与策略门控设计说明

**日期：** 2026-04-20

## 1. 文档目标

本文档定义 Ask Master phase-2 的 `Master Selector + Policy Gate`。

它只解决这些问题：

- 当前任务“应该问谁”
- 当前策略“能不能继续”
- explicit target、official、trusted、online、host mode 如何共同作用
- `askMaster` 配置在 phase-2 中如何真正消费

本文档**不处理**：

- provider 侧发布协议细节
- 具体上下文收集算法
- suggest 触发评分细节
- host skill 文案

---

## 2. 设计原则

### 2.1 selector 决定“问谁”，policy gate 决定“能不能继续”

两者不能混为一层。

- selector
  - 在可用目录中选最合适 Master
- policy gate
  - 判断这次 ask 是否允许进入下一阶段

### 2.2 明确输入优先级

phase-2 必须支持以下优先级：

1. 用户显式点名
2. 用户显式要求某个 `masterKind`
3. 系统根据任务类型推荐
4. trusted / official / online 排序

不能把：

- “系统推荐”

放到：

- “用户已经点名”

之前。

### 2.3 trusted 影响摩擦，不等于绕过安全

`trustedMasters` 可以：

- 提升排序
- 降低建议门槛
- 为未来 `auto_candidate` 留口

但在 phase-2 中不能：

- 绕过总开关
- 绕过 confirmation
- 绕过 preview

### 2.4 无可用 target 时要显式失败

如果当前没有匹配、在线、支持当前 host 的 Master：

- policy 层内部可返回稳定 `blocked / no_action`
- 但 host-facing `MetabotCommandResult` 仍应映射成现有 `failed` 或 `success` 语义
- 不能偷偷 fallback 到 private chat 或其它旧路径

---

## 3. Selector 输入模型

建议 selector 接收：

```ts
type MasterSelectorInput = {
  hostMode: string;
  preferredDisplayName?: string | null;
  preferredMasterKind?: string | null;
  trustedMasters: string[];
  onlineOnly: boolean;
  candidates: MasterDirectoryItem[];
};
```

其中 `trustedMasters` 在 phase-2 中应继续沿用当前 phase-1 已稳定使用的：

- `master pin id`

phase-2 默认不扩大成多标识格式，以避免配置语义漂移。

---

## 4. Selector 排序规则

### 4.1 第一层：硬过滤

先过滤掉：

- 不支持当前 host mode 的 Master
- 被 revoke / offline 且当前要求 onlineOnly 的 Master
- `masterKind` 明显不匹配的 Master

### 4.2 第二层：显式点名优先

如果用户显式点名：

- `Official Debug Master`
- `Debug Master`
- 某个明确 provider/globalMetaId/servicePinId

则优先精确匹配这一目标。

### 4.3 第三层：语义匹配

没有显式点名时，按以下维度综合排序：

- `masterKind`
- specialties 命中度
- trusted
- official
- online
- hostModes
- updatedAt

### 4.4 phase-2 推荐最小排序顺序

推荐最小顺序：

1. exact explicit match
2. same `masterKind`
3. trusted
4. official
5. online
6. updatedAt

注意：

- official 不应压过用户显式点名
- trusted 不应压过 host mode 不匹配

---

## 5. Policy Gate 输入模型

建议 gate 接收：

```ts
type MasterPolicyGateInput = {
  config: {
    enabled: boolean;
    triggerMode: 'manual' | 'suggest' | 'auto';
    confirmationMode: 'always' | 'sensitive_only' | 'never';
    contextMode: 'compact' | 'standard' | 'full_task';
    trustedMasters: string[];
  };
  action: 'manual_ask' | 'accept_suggest' | 'reject_suggest' | 'auto_candidate';
  selectedMaster: MasterDirectoryItem | null;
};
```

---

## 6. Policy Gate 规则

### 6.1 `enabled=false`

当 `askMaster.enabled=false`：

- manual ask 在 policy 层应被判定为 `blocked`，再映射成 host-facing `failed`
- suggest 不应对外展示
- auto candidate 不应继续

这是硬门控。

### 6.2 `triggerMode=manual`

当 `triggerMode=manual`：

- manual ask 允许
- suggest 不对外展示
- auto candidate 不继续

### 6.3 `triggerMode=suggest`

当 `triggerMode=suggest`：

- manual ask 允许
- suggest 可以展示
- auto candidate 仍不对外公开

### 6.4 `confirmationMode`

phase-2 默认：

- `always`

即：

- 无论 manual 还是 accept suggest，发送前都要确认

即便将来支持：

- `sensitive_only`
- `never`

phase-2 公开能力仍建议保持 `always`。

### 6.5 `contextMode`

policy gate 需要感知 context mode，原因是：

- 如果当前只允许 `compact`
- 那么某些需要大上下文的问题不应给出过强建议

phase-2 中 gate 至少应能把：

- `compact`
- `standard`

传递给 collector / packager。

---

## 7. Direct Provider Hint

phase-2 不应扩大 `providerDaemonBaseUrl` 的语义。

它仍然只是：

- transport hint

而不是：

- selector 主键

phase-2 中只有在 host 已持有完整显式 target 时，才允许继续解析目标，例如：

- `servicePinId`
- `providerGlobalMetaId`
- `masterKind`
- 可选的 `providerDaemonBaseUrl`

但前提是：

- 用户或上游流程显式提供了这些字段
- caller 侧本地 draft / host-action 输入继续使用 `servicePinId`
- 真正构造 `master_request` wire payload 时，再映射成 `target.masterServicePinId`
- 仍然通过 Ask Master runtime 校验 identity / capability / simplemsg 可达性
- `providerDaemonBaseUrl` 不能单独构成一个合法 target

不能因此变成：

- 自行直发 simplemsg

---

## 8. 错误语义

selector / gate 至少应输出以下几类稳定错误：

- `ask_master_disabled`
- `master_not_found`
- `master_offline`
- `master_host_mode_mismatch`
- `trigger_mode_disallows_suggest`
- `confirmation_required`

关键要求是：

- 失败要能解释
- 不做静默 fallback

---

## 9. 与 phase-1 的关系

phase-1 已有：

- `master-service` 目录读法
- config 默认值
- minimal trigger core

phase-2 的 selector / gate 应建立在这些基线上，而不是再开第二套：

- 目录系统
- config 体系
- target 解析逻辑

---

## 10. 测试要求

至少覆盖：

- 用户显式点名优先
- host mode 不匹配会失败
- offline target 在需要在线时会失败
- `enabled=false` 时 policy 会 blocked，host-facing 结果映射为可解释失败
- `triggerMode=manual` 时 suggestion 不对外出现
- trusted 影响排序，但不绕过 confirmation
- 只有完整显式 target 才能结合 `providerDaemonBaseUrl` 继续解析目标

推荐测试分层：

- 单元测试
  - selector ranking
  - policy gate decisions
- 集成测试
  - manual ask -> select -> preview
  - accept suggest -> gate -> preview

---

## 11. 一句话总结

phase-2 的 selector 与 policy gate 要把 Ask Master 的“问谁”和“能不能继续”这两个问题明确拆开：selector 负责按显式意图与目录质量稳妥选人，policy gate 负责守住总开关、triggerMode、confirmationMode 等边界，而且两者都不允许通过 fallback 把用户偷偷带回旧路径。
