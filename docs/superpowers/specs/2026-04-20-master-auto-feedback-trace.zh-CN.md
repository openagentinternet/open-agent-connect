# Ask Master Phase-3 Auto Feedback 与 Trace Loop 设计说明

**日期：** 2026-04-20

## 1. 文档目标

本文档定义 Ask Master phase-3 中 auto flow 的 feedback loop、suppression、trace metadata 与导出语义。

它只解决这些问题：

- auto ask 产生后，哪些反馈需要持久化
- trace 如何解释 auto reason / confidence / friction mode
- reject / timeout / direct send 后如何进入 cooldown
- artifacts 与内存态如何保持一致

本文档**不处理**：

- ask-worthiness detector 打分规则
- selector 的排序细节
- provider fixture 的业务内容

---

## 2. 设计原则

### 2.1 auto 行为必须比 manual 更可解释，而不是更不可解释

manual ask 至少是用户自己发起的。

auto ask 是系统主动行为，因此：

- 必须留下更强的解释信息
- 不能只在内存态短暂存在

### 2.2 feedback loop 先做规则记忆，不做黑盒学习

phase-3 的 feedback loop 目标是：

- 避免同类打扰
- 记住 reject / accept / timeout 结果
- 调整近期 auto ask 频率

不需要上来就做：

- 个性化模型训练
- 不透明权重更新

### 2.3 trace 与 state store 语义一致

不能出现：

- runtime 里显示被 reject
- 导出的 trace.json / trace.md 还停在 auto prepared

phase-3 必须把这类不一致问题在设计层面堵住。

---

## 3. 建议新增反馈状态模型

建议新增：

```ts
type MasterAutoFeedbackRecord = {
  traceId: string;
  masterKind: string | null;
  masterServicePinId: string | null;
  triggerReasonSignature: string | null;
  status: 'prepared' | 'confirmed' | 'rejected' | 'sent' | 'timed_out' | 'completed';
  createdAt: number;
  updatedAt: number;
};
```

### 3.1 最小用途

- per-trace suppression
- recent rejection cooldown
- timeout 后短期内避免重复 auto ask 同一目标
- trace 解释时可回看最近的 auto decision history

---

## 4. Trace 扩展建议

### 4.1 Ask Master metadata 扩展

建议在现有 `askMaster` metadata 上补充：

```ts
type AskMasterAutoMetadata = {
  reason: string | null;
  confidence: number | null;
  frictionMode: 'preview_confirm' | 'direct_send' | null;
  detectorVersion: string | null;
  selectedMasterTrusted: boolean | null;
  sensitivity: {
    isSensitive: boolean;
    reasons: string[];
  } | null;
};
```

并放入：

- `trace.askMaster.auto`

### 4.2 必须可导出的字段

至少需要出现在：

- `trace.json`
- `trace.md`
- `metabot master trace --id`

的字段包括：

- `triggerMode = auto`
- `confirmationMode`
- `reason`
- `confidence`
- `frictionMode`
- `selectedMasterTrusted`
- `sensitivity`
- 当前 canonical status

---

## 5. Canonical Status 与 Auto 事件

### 5.1 phase-3 不建议新增过多 status 名称

为避免把已有 trace 语义打碎，phase-3 建议继续沿用：

- `awaiting_confirmation`
- `requesting_remote`
- `remote_received`
- `completed`
- `timed_out`
- `failed`

auto 特有信息放在 metadata / latestEvent 上，而不是再发明一套平行状态机。

### 5.2 建议新增 latestEvent

可考虑新增：

- `auto_candidate_detected`
- `auto_preview_prepared`
- `auto_preview_rejected`
- `auto_sent_without_confirmation`

它们帮助解释：

- 为什么这条 trace 会存在
- 为什么没经过人工确认

---

## 6. Reject / Timeout / Cooldown

### 6.1 reject

当用户 reject auto preview：

- feedback state 写 `rejected`
- 当前 trace 更新为：
  - `canonicalStatus = failed`
  - `latestEvent = auto_preview_rejected`
  - `failure.code = auto_rejected_by_user`
  - `display.statusText = Declined`

这样做的原因是：

- canonical status 需要稳定终态
- 但 CLI / export / trace metadata 必须明确这是用户拒绝，而不是 provider/system 失败

### 6.2 timeout

当 auto ask 发送后超时：

- feedback state 写 `timed_out`
- cooldown 应短期阻止对同一目标马上再次 auto send

### 6.3 direct send completed

当 direct send 成功完成：

- feedback state 写 `completed`
- 后续同一 trace 不应再次 auto ask

---

## 7. Artifacts 一致性要求

phase-3 明确要求：

- 任何 auto 状态变化，只要更新 runtime trace，就必须重导出 artifacts
- 不能接受“内存里是 rejected / timed_out，磁盘导出还是 prepared”的状态分裂

这条要求是为了避免：

- `master trace`、markdown 导出、json 导出相互打架

---

## 8. Trace Command 展示建议

`metabot master trace --id ...` 建议最少展示：

- Ask Master Flow: master
- Trigger Mode: auto
- Confirmation Mode
- Auto Reason
- Confidence
- Friction Mode
- Trusted Target
- Sensitivity
- Current Status
- 如果有 response / failure，则继续展示摘要

---

## 9. 测试要求

至少覆盖：

- auto prepared preview 的 metadata 完整
- reject / timeout / direct send 都会同步更新 JSON / Markdown artifacts
- `metabot master trace --id` 能读到 auto metadata
- reject auto preview 后 canonical status / latestEvent / display status 唯一稳定
- trusted direct-send trace 必须能解释当前 `confirmationMode` 与 trusted 判定
- late reply 仍遵循原语义，不会被 feedback state 错误吞掉

---

## 10. 小结

phase-3 的 Auto Feedback 与 Trace Loop，是 Ask Master 自动能力能否被信任的关键。用户只有在事后能看懂“系统为什么这样做、做完之后发生了什么、为什么之后没有再次打扰我”时，auto ask 才是一个可持续的产品能力。
