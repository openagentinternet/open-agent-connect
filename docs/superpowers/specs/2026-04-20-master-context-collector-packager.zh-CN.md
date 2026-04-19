# Ask Master Phase-2 上下文收集与打包设计说明

**日期：** 2026-04-20

## 1. 文档目标

本文档定义 Ask Master phase-2 的 `Context Collector + Context Packager`。

它只解决这些问题：

- host 中哪些可见信号可以进入 Ask Master 上下文
- 如何从这些信号自动构建最小 request draft
- 如何做 budget、裁剪、脱敏与 safety preview
- manual ask 与 suggest 共用什么上下文打包模型

本文档**不处理**：

- selector 排序规则
- provider runtime 如何消费这些上下文
- trigger engine 的评分模型
- host skill wording

---

## 2. 设计原则

### 2.1 只采集 host 可见信号

collector 允许的输入来源仅限：

- 用户消息
- assistant 可见输出
- tool call 与 tool result
- 测试结果
- 终端 stderr/stdout 摘要
- git diff 摘要
- 相关文件路径与小片段
- plan / todo / blocked 状态

明确禁止：

- CoT
- 隐式读取整仓库全文
- 隐式读取 `.env`
- 隐式读取 credentials / keys / wallet secrets

### 2.2 collector 与 packager 解耦

建议分成两层：

- collector
  - 从 host 可见轨迹收集原始上下文片段
- packager
  - 将原始片段裁剪并归一化为可发送 draft

这样可以避免：

- trigger engine 直接耦合具体 host transcript 形状
- preview builder 同时承担采集与裁剪

### 2.3 先最小、再丰富

phase-2 不追求“拿到一切上下文”，而追求：

- 对当前问题足够
- 明确可见
- 可审阅
- 可控边界

### 2.4 preview 中必须可见上下文边界

用户在发送前至少要看到：

- 问题摘要
- 目标 Master
- 相关文件列表
- artifact 标签与大小级别
- safety 承诺

---

## 3. 分层模型

### 3.0 Collector 输入契约

phase-2 需要先定义一个稳定输入契约，避免测试和实现各自发明 fixture。

建议 collector 输入至少为：

```ts
type MasterContextCollectionInput = {
  now: number;
  hostMode: string;
  traceId: string | null;
  conversation: {
    currentUserRequest: string | null;
    recentMessages: Array<{
      role: 'user' | 'assistant';
      content: string;
    }>;
  };
  tools: {
    recentToolResults: Array<{
      toolName: string;
      exitCode: number | null;
      stdout: string;
      stderr: string;
    }>;
  };
  workspace: {
    goal: string | null;
    constraints: string[];
    relevantFiles: string[];
    diffSummary: string | null;
    fileExcerpts: Array<{
      path: string;
      content: string;
    }>;
  };
  planner: {
    hasPlan: boolean;
    todoBlocked: boolean;
    onlyReadingWithoutConverging: boolean;
  };
};
```

这个输入契约的意义是：

- 它代表 host adapter 传给 collector 的统一形状
- 测试必须直接围绕它写 fixture
- 这样 phase-2 不会再把“从哪拿对话/工具/计划”混进 packager 的责任里

### 3.1 Collector 输出

collector 建议输出：

```ts
type CollectedMasterContext = {
  hostMode: string;
  taskSummary: string | null;
  questionCandidate: string | null;
  workspaceSummary: string | null;
  diagnostics: {
    failingTests: string[];
    failingCommands: string[];
    repeatedErrorSignatures: string[];
    stderrHighlights: string[];
  };
  workState: {
    goal: string | null;
    constraints: string[];
    errorSummary: string | null;
    diffSummary: string | null;
    relevantFiles: string[];
  };
  artifacts: Array<{
    kind: 'text';
    label: string;
    content: string;
    source: 'terminal' | 'test' | 'diff' | 'chat' | 'file_excerpt';
  }>;
};
```

### 3.2 Packager 输出

packager 建议输出 phase-2 仍兼容现有 `MasterAskDraft`：

```ts
type PackagedMasterAskDraft = {
  target?: {
    servicePinId?: string;
    providerGlobalMetaId?: string;
    masterKind?: string;
    displayName?: string | null;
  };
  triggerMode: 'manual' | 'suggest' | 'auto';
  contextMode: 'compact' | 'standard';
  userTask: string;
  question: string;
  goal: string | null;
  workspaceSummary: string | null;
  errorSummary: string | null;
  diffSummary: string | null;
  relevantFiles: string[];
  artifacts: Array<{
    kind: 'text';
    label: string;
    content: string;
  }>;
  constraints: string[];
  desiredOutput: {
    mode: string;
  };
};
```

---

## 4. Collector 信号来源

### 4.1 对话层

允许采集：

- 当前用户 ask 的原文
- 最近几轮与当前问题强相关的用户/assistant 对话摘要

不建议直接把全部 transcript 原样上传。

应优先抽取：

- 当前任务是什么
- 当前卡在哪
- 用户明确要求 Master 回答什么

### 4.2 工具与终端层

允许采集：

- 最近失败的测试名
- 失败命令与 exit code
- stderr 高亮
- 关键 stack trace 摘要

不应直接把超长终端输出整段塞进 artifacts。

应优先做：

- 错误签名归一化
- 关键行截断
- 只保留少量高价值片段

### 4.3 代码与文件层

允许采集：

- 相关文件路径
- diff 摘要
- 很小的文件片段

不允许：

- 整仓 snapshot
- 大文件原文
- 无关目录遍历上传

### 4.4 计划与状态层

允许采集：

- 当前 goal
- 当前 constraints
- 是否多轮失败无进展
- 是否只在搜索/阅读，没有收敛动作

这类信息通常比大段原始日志更适合作为 Ask Master 的高层上下文。

### 4.5 当前 repo 的映射要求

phase-2 文档不强制绑定某一个 host transcript 类，但实现计划必须满足：

- 对话层输入由 host adapter 显式传入 `MasterContextCollectionInput.conversation`
- tool 结果由 host adapter 或 daemon handlers 传入 `tools.recentToolResults`
- plan/todo/blocked 信号由 host adapter 汇总到 `planner`
- diff / relevantFiles / excerpts 由 host adapter 或 workspace helper 汇总到 `workspace`

也就是说：

- collector 的输入必须先在 host bridge surface 被组装好
- collector 自己不去“偷读”未知全局状态

---

## 5. Safety Filter

packager 在 phase-2 必须做硬过滤。

### 5.1 默认排除

默认排除：

- `.env`
- `*.pem`
- `*.key`
- token / secret / mnemonic / private key 文本
- wallet 凭证
- 与当前问题无关的大 diff
- 与当前问题无关的文件

### 5.2 文件策略

phase-2 建议：

- `relevantFiles` 只发路径列表
- 真正的文件内容只允许进入小型 text artifact
- 单个 artifact 必须小

### 5.3 敏感内容检测

phase-2 不要求做复杂 DLP，但建议至少做：

- 文件名规则排除
- 明显敏感关键字排除
- 超长片段拒绝

---

## 6. Budget 策略

### 6.1 两档模式

phase-2 公开两档：

- `compact`
- `standard`

`full_task` 只保留枚举位，不作为公开默认能力。

### 6.2 `compact`

适合：

- 单个 bug
- 单个失败测试
- 明确的诊断问题

建议限制：

- relevant files：最多 3 个
- artifacts：最多 3 个
- 每个 artifact：短文本摘要

### 6.3 `standard`

适合：

- 稍复杂的失败链
- 需要给出 next steps / risk 判断的请求

建议限制：

- relevant files：最多 8 个
- artifacts：最多 8 个
- 允许更完整的 diff/test/terminal 摘要

### 6.4 phase-2 不做

phase-2 不做：

- 自适应大上下文扩容
- 自动整仓引用
- 多轮 context refill

---

## 7. Preview 可见模型

preview 至少应显示：

- `userTask`
- `question`
- `goal`
- `workspaceSummary`
- `errorSummary`
- `diffSummary`
- `relevantFiles`
- `artifacts` 的 label 与长度提示
- safety 承诺

其中 safety 承诺至少应包括：

- no implicit repo upload
- no implicit secrets
- transport = `simplemsg`

---

## 8. 与 manual ask / suggest 的关系

### 8.1 manual ask

manual ask 下：

- `question` 优先来自用户明确提问
- collector 辅助补全 `workspaceSummary / errorSummary / diffSummary`

### 8.2 suggest

suggest 下：

- `question` 可以由 host adapter 基于失败信号生成默认问法
- 但 preview 中必须让用户看到实际将问出的内容

这意味着：

- suggest 只是帮助构造问题
- 不是绕过 preview

---

## 9. 推荐实现边界

建议新增两个模块：

- `masterContextCollector.ts`
- `masterContextPackager.ts`

而不是把所有逻辑继续堆进：

- `masterPreview.ts`
- `defaultHandlers.ts`

这样后续扩展：

- different host collectors
- different context modes
- richer diagnostics extraction

会更稳。

---

## 10. 测试要求

至少覆盖：

- collector 不读取 CoT
- collector 只消费 host 可见输入
- `.env` / credentials / keys / wallet secrets 被排除
- `compact` / `standard` 模式预算稳定
- relevantFiles 只包含高相关路径
- artifacts 会被裁剪，不会无限增长
- preview 中能明确看到 safety 边界

推荐测试分层：

- 单元测试
  - collector input normalization
  - collector normalization
  - safety filter
  - budget trimming
- 集成测试
  - collected context -> packaged draft -> preview
- e2e 测试
  - host manual ask 自动生成 preview

---

## 11. 一句话总结

phase-2 的 Context Collector + Packager 应把 Ask Master 的上下文准备，从“人手拼 request”升级成“系统基于 host 可见轨迹自动整理、严格裁剪、明确预览”的安全编排层，同时守住不读 CoT、不隐式传整仓与敏感信息的边界。
