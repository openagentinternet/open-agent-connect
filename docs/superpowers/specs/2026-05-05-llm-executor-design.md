# MetaBot LLM Executor 开发方案（SDD 文档）

> **目标读者**：AI 开发 Agent（Claude Code / Codex），需能直接根据本文档进行开发。
> **语言**：中文。代码注释、commit message 使用英文。
> **原则**：本文档描述的是「MetaBot daemon」的增强方案。所有改动在 `open-agent-connect` 仓库内完成，不改动 `openloom` 仓库。

---

## 目录

1. [概述与目标](#1-概述与目标)
2. [架构总览](#2-架构总览)
3. [`~/.metabot/` 文件布局变更](#3-metabot-文件布局变更)
4. [LLM Executor 模块设计](#4-llm-executor-模块设计)
5. [MetaBot Daemon API 设计](#5-metabot-daemon-api-设计)
6. [私有聊天（Chat）集成改造](#6-私有聊天chat集成改造)
7. [UI 界面改造（/ui/bot）](#7-ui-界面改造uibot)
8. [实施计划（分阶段）](#8-实施计划分阶段)
9. [验收标准](#9-验收标准)
10. [附录：参考实现](#10-附录参考实现)

---

## 1. 概述与目标

### 1.1 背景

当前 OAC 的 LLM 执行机制（`src/core/llm/hostLlmExecutor.ts`）非常简陋：

- **Codex**：`codex exec <prompt>` — 一次性命令行，无多轮，无流式事件
- **Claude Code**：`claude --print <prompt>` — 同上，且 prompt 超 4000 字符时走 stdin
- **无 session 管理**：每次执行都是全新的
- **无技能注入**：host skill binding 只做 symlink，不参与执行流程

需要将其升级为**完整的 LLM 执行引擎**，参考 Multica 和 Symphony 的最佳实践。

### 1.2 目标

1. **LLM Executor 模块**（`src/core/llm/executor/`）：一个自包含、与 OAC 业务逻辑解耦的执行引擎
2. **Codex app-server 模式**：JSON-RPC 2.0 over stdio，支持多轮、流式事件、session 恢复
3. **Claude Code stream-json 模式**：`--output-format stream-json --input-format stream-json`，支持流式事件、auto-approve、session 恢复
4. **技能注入系统**：执行前将 skill 写入各 provider 的原生路径
5. **MetaBot Daemon API**：新增 `POST /api/llm/execute`、`GET /api/llm/sessions/:id`（SSE）等端点
6. **Chat 私聊集成**：将 `hostLlmChatReplyRunner.ts` 切换到新的 LLM Executor
7. **UI 完善**：`/ui/bot` 页面可查看 runtime 状态、管理绑定、查看执行历史

### 1.3 不做的事

- 不改动 `openloom` 仓库
- 不实现「远程技能服务执行」（技能注入基础设施做好即可）
- 不实现 OpenClaw executor（只做 stub）
- 不改变现有 CLI 命令的接口

---

## 2. 架构总览

### 2.1 整体数据流

```
┌──────────────────────────────────────────────────────┐
│                  MetaBot Daemon                       │
│                                                      │
│  HTTP API (新增)                                      │
│  ├─ POST /api/llm/execute    ← OpenLoom 未来调用      │
│  ├─ GET  /api/llm/sessions/:id (SSE)                  │
│  ├─ POST /api/llm/sessions/:id/cancel                 │
│  └─ GET  /api/llm/sessions                            │
│                                                      │
│  调用方（已有）                                        │
│  ├─ Chat Auto-Reply  ← 私聊自动回复                   │
│  ├─ Ask Master       ← 向远端求助                     │
│  └─ (未来) Remote Service ← 远端调用本地技能           │
│         │                                            │
│         ▼                                            │
│  ┌──────────────────────────────────────┐            │
│  │        LLM Executor (新增)            │            │
│  │                                      │            │
│  │  executor.ts (门面)                   │            │
│  │  ├─ resolveRuntime()  ← 复用已有      │            │
│  │  ├─ skillInjector.ts  ← 新增          │            │
│  │  ├─ sessionManager.ts ← 新增          │            │
│  │  └─ backends/                        │            │
│  │       ├─ backend.ts    (接口)         │            │
│  │       ├─ codex.ts      (app-server)  │            │
│  │       └─ claude.ts     (stream-json) │            │
│  └──────────────────────────────────────┘            │
│         │                                            │
│         ▼ 子进程 (stdio)                              │
│  ┌─────────────┐  ┌──────────────┐                   │
│  │ codex        │  │ claude        │                  │
│  │ app-server   │  │ stream-json   │                  │
│  │ --listen     │  │ --input-format│                  │
│  │ stdio://     │  │ stream-json   │                  │
│  └─────────────┘  └──────────────┘                   │
└──────────────────────────────────────────────────────┘
```

### 2.2 模块边界

LLM Executor（`src/core/llm/executor/`）的硬性约束：

| 可以依赖 | 禁止依赖 |
|---------|---------|
| `node:child_process`, `node:fs/promises`, `node:path` | OAC 业务逻辑（chain, a2a, buzz, chat） |
| `~/.metabot/` 路径（通过参数传入） | `src/core/state/paths.ts`（应由调用方传入路径） |
| 自身 `types.ts` 和 `backends/*` | daemon HTTP 层 |
| `LlmRuntime`、`LlmBinding` 类型（从 `../llmTypes`） | `MetabotCommandResult` 等 CLI 类型 |

这样设计确保未来可以提取为独立 package 供 OpenLoom 使用。

---

## 3. `~/.metabot/` 文件布局变更

### 3.1 新增路径

在 `resolveMetabotPaths()` 中新增以下属性：

```typescript
// 新增到 MetabotPaths 接口
interface MetabotPaths {
  // ... 已有属性 ... 

  // LLM Executor 新增
  llmExecutorRoot: string;         // <metabotRoot>/LLM/executor
  llmExecutorSessionsRoot: string; // <metabotRoot>/LLM/executor/sessions
  llmExecutorTranscriptsRoot: string; // <metabotRoot>/LLM/executor/transcripts
}
```

对应的路径推导（在 `resolveMetabotPaths` 中）：

```typescript
llmExecutorRoot: path.join(metabotRoot, 'LLM', 'executor'),
llmExecutorSessionsRoot: path.join(metabotRoot, 'LLM', 'executor', 'sessions'),
llmExecutorTranscriptsRoot: path.join(metabotRoot, 'LLM', 'executor', 'transcripts'),
```

### 3.2 完整的 `~/.metabot/LLM/` 布局

```
~/.metabot/LLM/
  runtimes.json              # 已有 — LlmRuntimesState
  secrets/                   # 已有 — API keys

  executor/                  # 新增
    sessions/                # 活跃 session 状态
      <sessionId>.json       # LlmSessionRecord
    transcripts/             # 执行转录
      <sessionId>.log        # 原始 provider 输出日志
```

### 3.3 Session 记录格式

```typescript
// ~/.metabot/LLM/executor/sessions/<sessionId>.json
interface LlmSessionRecord {
  sessionId: string;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled';
  runtimeId: string;
  provider: LlmProvider;
  metaBotSlug?: string;
  
  // 请求参数
  prompt: string;
  systemPrompt?: string;
  skills?: string[];
  model?: string;
  cwd?: string;
  
  // session 信息
  providerSessionId?: string;  // codex thread ID / claude session ID
  resumeSessionId?: string;    // 用于恢复的 prior session
  
  // 结果
  result?: {
    status: string;
    output: string;
    error?: string;
    durationMs: number;
    usage?: Record<string, {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    }>;
  };
  
  // 时间戳
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}
```

---

## 4. LLM Executor 模块设计

### 4.1 目录结构

```
src/core/llm/executor/
  types.ts              # 所有类型定义
  backends/
    backend.ts           # Backend 接口
    codex.ts             # Codex app-server JSON-RPC 2.0 实现
    claude.ts            # Claude Code stream-json 实现
    openclaw.ts          # OpenClaw stub（本次不实现）
  skill-injector.ts      # 技能注入器
  session-manager.ts     # 会话管理器（文件持久化）
  executor.ts            # 主入口（LlmExecutor 类）
  index.ts               # 公共导出
```

### 4.2 类型定义（`executor/types.ts`）

```typescript
import type { LlmProvider, LlmRuntime } from '../llmTypes';

// ── 执行请求 ──
export interface LlmExecutionRequest {
  /** runtime ID，指向 ~/.metabot/LLM/runtimes.json 中的 runtime */
  runtimeId: string;
  /** 已解析的 runtime 对象（调用方提供，避免 executor 内部读文件） */
  runtime: LlmRuntime;
  /** 任务 prompt */
  prompt: string;
  /** 系统 prompt（注入为 system/developer instruction） */
  systemPrompt?: string;
  /** 最大轮数（app-server 模式有效） */
  maxTurns?: number;
  /** 整体超时 ms，默认 20min */
  timeout?: number;
  /** 语义不活跃超时 ms，仅 Codex，默认 10min */
  semanticInactivityTimeout?: number;
  /** 工作目录 */
  cwd?: string;
  /** 要注入的 skill 名称列表（对应 ~/.metabot/skills/<name>/） */
  skills?: string[];
  /** 恢复之前的 session */
  resumeSessionId?: string;
  /** model 覆盖 */
  model?: string;
  /** 额外环境变量 */
  env?: Record<string, string>;
  /** 额外 CLI 参数（追加在 daemon 默认参数之后） */
  extraArgs?: string[];
}

// ── 流式事件 ──
export type LlmExecutionEvent =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; tool: string; callId: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; callId: string; output: string }
  | { type: 'status'; status: string; sessionId?: string }
  | { type: 'error'; message: string }
  | { type: 'log'; level: string; message: string };

// ── 执行结果 ──
export interface LlmExecutionResult {
  status: 'completed' | 'failed' | 'timeout' | 'cancelled';
  output: string;
  error?: string;
  providerSessionId?: string;  // 用于后续 resume
  durationMs: number;
  usage?: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  }>;
}

// ── 事件发射器接口 ──
export interface LlmEventEmitter {
  emit(event: LlmExecutionEvent): void;
}

// ── 会话状态（同 3.3 节 LlmSessionRecord） ──
// ... 与 3.3 一致
```

### 4.3 Backend 接口（`executor/backends/backend.ts`）

参考 Multica 的 `agent.Backend` 接口设计：

```typescript
import type { LlmExecutionRequest, LlmExecutionResult, LlmEventEmitter } from '../types';

/**
 * LLM Backend 接口 — 每个 Coding Agent provider 实现此接口。
 * 
 * 职责：
 * 1. 启动 provider 子进程（如 codex app-server）
 * 2. 通过 stdio 与之通信
 * 3. 将 provider 的输出解析为统一的 LlmExecutionEvent
 * 4. 返回统一的 LlmExecutionResult
 */
export interface LlmBackend {
  /** provider 标识 */
  readonly provider: string;

  /**
   * 执行 prompt。
   * 
   * @param request - 执行请求（runtime + prompt + 配置）
   * @param emitter - 事件发射器，backend 通过它流式输出事件
   * @param signal - AbortSignal，用于取消执行
   * @returns 执行结果
   */
  execute(
    request: LlmExecutionRequest,
    emitter: LlmEventEmitter,
    signal: AbortSignal,
  ): Promise<LlmExecutionResult>;
}

/** Backend 工厂 */
export type LlmBackendFactory = (binaryPath: string, env?: Record<string, string>) => LlmBackend;
```

### 4.4 Codex Backend（`executor/backends/codex.ts`）★ 核心

**参考实现**：
- Multica `server/pkg/agent/codex.go`（1100+ 行）
- Symphony `elixir/lib/symphony_elixir/codex/app_server.ex`（1100 行）

#### 4.4.1 启动子进程

```typescript
// 启动命令（不可被 custom_args 覆盖的参数要 blocked）
// $ codex app-server --listen stdio://
// 加上 per-agent 的 custom_args（过滤掉 --listen 等关键参数后追加）

const args = ['app-server', '--listen', 'stdio://'];
// 追加 extraArgs（过滤 blocked flags 后）
// 追加 request.extraArgs（过滤 blocked flags 后）
```

**Blocked args**（不允许 custom_args 覆盖的）：
- `--listen`：daemon 固定为 `stdio://`

#### 4.4.2 JSON-RPC 2.0 协议

Codex app-server 使用 JSON-RPC 2.0 over stdio。每行一个 JSON 对象。

**步骤 1：initialize**

```json
→ {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"capabilities":{"experimentalApi":true},"clientInfo":{"name":"metabot-daemon","title":"MetaBot Daemon","version":"0.2.5"}}}
← {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"..."}}
→ {"jsonrpc":"2.0","method":"initialized","params":{}}
```

**步骤 2：thread/start（或 thread/resume）**

当 `request.resumeSessionId` 存在时，先尝试 `thread/resume`：

```json
→ {"jsonrpc":"2.0","id":2,"method":"thread/resume","params":{"threadId":"<resumeSessionId>","cwd":"<cwd>","model":null,"developerInstructions":"<systemPrompt>"}}
```

如果 `thread/resume` 失败（thread 已过期/不存在），记录 warning 并回退到 `thread/start`：

```json
→ {"jsonrpc":"2.0","id":2,"method":"thread/start","params":{"cwd":"<cwd>","approvalPolicy":null,"sandbox":null,"developerInstructions":"<systemPrompt>","persistExtendedHistory":true}}
← {"jsonrpc":"2.0","id":2,"result":{"thread":{"id":"thread_abc123"}}}
```

**步骤 3：turn/start**

```json
→ {"jsonrpc":"2.0","id":3,"method":"turn/start","params":{"threadId":"thread_abc123","input":[{"type":"text","text":"<prompt>"}],"cwd":"<cwd>"}}
← {"jsonrpc":"2.0","id":3,"result":{"turn":{"id":"turn_xyz789"}}}
```

**步骤 4：处理通知（Notifications）**

在等待 turn 完成期间，stdout 上会收到 JSON-RPC 通知（无 `id` 字段）。

**协议版本检测**：codex 有新旧两种通知格式：

- **Legacy**：`{"method":"codex/event","params":{"msg":{...}}}` — 事件嵌套在 `params.msg` 中
- **Raw v2**：`{"method":"turn/started","params":{...}}` — 事件直接在顶层 method/params

实现策略：
1. 收到第一个通知时检查 `method` 前缀
2. 如果 `method` 以 `codex/event` 开头 → legacy 模式
3. 如果 `method` 是 `turn/started` 或 `turn/completed` 或 `item/*` → raw v2 模式
4. 未知 → 继续观察，锁定后用确定的分发器处理

**Raw v2 通知处理**（优先实现，这是新协议）：

| 通知 method | 处理 |
|------------|------|
| `turn/started` | `emitter.emit({type:'status', status:'running'})` |
| `turn/completed` | 检查 `params.turn.status`，提取 token usage。`completed` → 正常结束。`cancelled`/`aborted`/`interrupted` → 标记 aborted。`failed` → 提取 error message |
| `item/started` (agentMessage) | 文本块开始，后续 `item/agentMessage/delta` 会送来增量 |
| `item/agentMessage/delta` | `emitter.emit({type:'text', content: delta})` |
| `item/started` (commandExecution) | `emitter.emit({type:'tool_use', tool:'exec_command', callId: itemId, input:{command}})` |
| `item/completed` (commandExecution) | `emitter.emit({type:'tool_result', tool:'exec_command', callId: itemId, output})` |
| `item/started` (fileChange) | `emitter.emit({type:'tool_use', tool:'patch_apply', callId: itemId})` |
| `item/completed` (fileChange) | `emitter.emit({type:'tool_result', tool:'patch_apply', callId: itemId})` |
| `item/completed` (agentMessage, phase=final_answer) | 如果 turnStarted，触发 turn done |
| `error` | 记录 error，如果是非 retry 的 terminal error，标记失败 |
| `thread/status/changed` (idle) | 如果 turn 已开始，触发 turn done |

**子 agent 线程过滤**：Codex 可能在同一个 stdio 通道上多路复用子 agent 线程（如 memory consolidation）。只处理当前 `threadId` 的通知，其他线程的忽略。

**Legacy 通知处理**（向后兼容）：

| `msg.type` | 处理 |
|-----------|------|
| `task_started` | `emitter.emit({type:'status', status:'running'})` |
| `agent_message` | `emitter.emit({type:'text', content: msg.message})` |
| `exec_command_begin` | `emitter.emit({type:'tool_use', tool:'exec_command', callId, input})` |
| `exec_command_end` | `emitter.emit({type:'tool_result', tool:'exec_command', callId, output})` |
| `patch_apply_begin/end` | 同上模式 |
| `task_complete` | 触发 turn done（extract token usage from msg） |
| `turn_aborted` | 触发 turn done（aborted=true） |
| `token_count` | 累计 token usage |

**步骤 5：Auto-Approve**

Codex 会通过 JSON-RPC **Server Request**（有 `id` 和 `method`，但不是客户端发出的）请求批准：

```json
← {"jsonrpc":"2.0","id":10,"method":"item/commandExecution/requestApproval","params":{...}}
→ {"jsonrpc":"2.0","id":10,"result":{"decision":"accept"}}

← {"jsonrpc":"2.0","id":11,"method":"item/fileChange/requestApproval","params":{...}}
→ {"jsonrpc":"2.0","id":11,"result":{"decision":"accept"}}
```

daemon 模式下自动批准所有命令执行和文件变更请求。对其他未知 method 的 Server Request，返回空 result。

**步骤 6：超时处理**

两种超时机制：

1. **整体超时**（`request.timeout`，默认 20 分钟）：`AbortSignal` 触发后 kill 子进程
2. **语义不活跃超时**（`request.semanticInactivityTimeout`，默认 10 分钟）：
   - 跟踪最后一次「有意义的」活动（tool_use、tool_result、text delta）
   - 如果超过计时器时长无活动，标记 timeout
   - 定时器在每次有意义活动时重置

**步骤 7：退出清理**

turn 完成后：
1. 关闭 stdin → codex 进程退出
2. 等待 reader goroutine 读完 stdout
3. `cmd.Wait()` 确保 stderr 也被完全消费
4. 构建 LlmExecutionResult

**步骤 8：Token Usage 提取**

优先级：
1. 从 `turn/completed` 通知的 `params.turn.usage` 提取（raw v2 协议）
2. 从 `task_complete` 事件提取（legacy 协议）
3. Fallback：扫描 `~/.codex/sessions/YYYY/MM/DD/*.jsonl`，找到本次 session 的最后一次 `token_count` 事件

Token usage 格式：
```typescript
{
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}
```

从 codex 的多种 key 命名中提取（兼容 `input_tokens`/`input`/`prompt_tokens`，`output_tokens`/`output`/`completion_tokens`，`cache_read_tokens`/`cache_read_input_tokens`/`cached_input_tokens`）。

### 4.5 Claude Code Backend（`executor/backends/claude.ts`）★ 核心

**参考实现**：Multica `server/pkg/agent/claude.go`（600 行）

#### 4.5.1 启动子进程

```typescript
// 启动命令（不可被 custom_args 覆盖的参数要 blocked）
// $ claude -p --output-format stream-json --input-format stream-json --verbose --permission-mode bypassPermissions --strict-mcp-config

const args = [
  '-p',                                          // non-interactive
  '--output-format', 'stream-json',              // JSON 行输出
  '--input-format', 'stream-json',               // JSON 行输入
  '--verbose',                                    // 更多日志
  '--permission-mode', 'bypassPermissions',       // 自动批准所有权限请求
  '--strict-mcp-config',                          // 只用显式传入的 MCP config
];
// 如果 request.maxTurns > 0:
args.push('--max-turns', String(request.maxTurns));
// 如果 request.model:
args.push('--model', request.model);
// 如果 request.systemPrompt && !request.resumeSessionId:
args.push('--append-system-prompt', request.systemPrompt);
// 如果 request.resumeSessionId:
args.push('--resume', request.resumeSessionId);
// 追加 extraArgs（过滤 blocked flags 后）
// 追加 request.extraArgs（过滤 blocked flags 后）
```

**Blocked args**：
- `-p`、`--output-format`、`--input-format`、`--permission-mode`
- `--mcp-config`（由 daemon 从 agent.mcp_config 设置）
- `--resume`（由 resumeSessionId 控制）
- `--max-turns`（由 maxTurns 控制）

#### 4.5.2 Stream-JSON 协议

**输入**（写入 stdin）：

```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"<prompt>"}]}}
```

**输出**（读取 stdout 的 JSON 行）：

| `type` | 处理 |
|--------|------|
| `system` | 提取 `session_id`。`emitter.emit({type:'status', status:'running', sessionId})` |
| `assistant` | 解析 `message.content[]`。对每个 block：<br>- `text` → `emitter.emit({type:'text', content})` 并累积到 output<br>- `thinking` → `emitter.emit({type:'thinking', content})`<br>- `tool_use` → `emitter.emit({type:'tool_use', tool:name, callId:id, input})`<br>提取 `message.usage` 按 model 累计 token |
| `user` | 解析 `message.content[]`。对每个 block：<br>- `tool_result` → `emitter.emit({type:'tool_result', callId, output})` |
| `result` | 最终结果。提取 `result`、`is_error`、`session_id`、`duration_ms`、`num_turns` |
| `log` | `emitter.emit({type:'log', level, message})` |

**Auto-Approve Control Requests**：

Claude Code 通过 stdin 发送 control request：
```json
← (stdin) {"type":"control_request","request_id":"...","request":{"subtype":"...","tool_name":"...","input":{...}}}
```

daemon 需要响应（写入 stdin）：
```json
→ (stdin) {"type":"control_response","response":{"subtype":"success","request_id":"...","response":{"behavior":"allow","updatedInput":{...}}}}
```

实现：在后台任务中持续读取 stdin（但 Claude Code 目前主要通过 `bypassPermissions` 跳过请求，这个作为安全网保留）。

**步骤 5：退出清理**

1. 等待 stdout scanner 返回 EOF（进程退出）
2. 调用 `cmd.Wait()` 确保 stderr 被消费
3. 如果 ExitCode ≠ 0 且 result status 是 completed，标记 failed
4. 构建 LlmExecutionResult

**步骤 6：Session ID 处理**

```typescript
// 如果调用方请求 resume 但 claude 返回了不同的 session ID 且 run 失败
// → resume 没有生效，返回空 sessionId，让调用方回退到新 session
function resolveSessionId(
  requestedResume: string | undefined,
  emittedSessionId: string | undefined,
  failed: boolean,
): string | undefined {
  if (failed && requestedResume && emittedSessionId && emittedSessionId !== requestedResume) {
    return undefined;  // resume failed
  }
  return emittedSessionId;
}
```

### 4.6 技能注入器（`executor/skill-injector.ts`）

**参考实现**：Multica `server/internal/daemon/execenv/context.go`

#### 4.6.1 设计原则

- 在执行 `backend.execute()` **之前**，将指定的 skill 写入 provider 原生路径
- 不同 provider 有不同的原生 skill 发现路径
- 支持从 `~/.metabot/skills/<name>/` 读取 skill 内容
- 注入后的 skill 文件在执行结束后保留（不自动清理，供多次执行复用）

#### 4.6.2 Provider 原生路径映射

```typescript
const PROVIDER_SKILL_ROOTS: Record<string, (cwd: string) => string> = {
  'claude-code': (cwd) => path.join(cwd, '.claude', 'skills'),
  'codex': (cwd) => path.join(cwd, '.codex', 'skills'),
  'openclaw': (cwd) => path.join(cwd, '.openclaw', 'skills'),
  // 未来可扩展
};

function resolveProviderSkillRoot(provider: string, cwd: string): string {
  const resolver = PROVIDER_SKILL_ROOTS[provider];
  if (resolver) return resolver(cwd);
  // Fallback: .agent_context/skills/
  return path.join(cwd, '.agent_context', 'skills');
}
```

#### 4.6.3 注入流程

```typescript
export interface SkillInjectorInput {
  /** skill 名称列表（对应 ~/.metabot/skills/<name>/） */
  skills: string[];
  /** ~/.metabot/skills/ 路径 */
  skillsRoot: string;
  /** provider 标识 */
  provider: string;
  /** 工作目录（skill 写入 cwd 下的原生路径） */
  cwd: string;
}

export interface SkillInjectionResult {
  /** 成功注入的 skill */
  injected: string[];
  /** 注入失败的 skill + 错误信息 */
  errors: Array<{ skill: string; error: string }>;
}

export async function injectSkills(input: SkillInjectorInput): Promise<SkillInjectionResult> {
  const skillRoot = resolveProviderSkillRoot(input.provider, input.cwd);
  await fs.mkdir(skillRoot, { recursive: true });
  
  const injected: string[] = [];
  const errors: Array<{ skill: string; error: string }> = [];
  
  for (const skillName of input.skills) {
    try {
      const srcDir = path.join(input.skillsRoot, skillName);
      const dstDir = path.join(skillRoot, skillName);
      
      // 检查源是否存在
      await fs.access(srcDir);
      
      // 如果目标已存在且是目录，跳过（避免覆盖已注入的）
      try {
        await fs.access(dstDir);
        injected.push(skillName);
        continue;
      } catch { /* 目标不存在，继续 */ }
      
      // 递归复制 skill 目录
      await fs.cp(srcDir, dstDir, { recursive: true });
      injected.push(skillName);
    } catch (err) {
      errors.push({ skill: skillName, error: String(err) });
    }
  }
  
  return { injected, errors };
}
```

**注意**：当前实现使用 `fs.cp`（文件复制），与 OAC 已有的 symlink 方式（`hostSkillBinding.ts`）不同。原因是：
1. 执行工作目录可能是临时的（git worktree），symlink 指向的 `~/.metabot/skills/` 可能不可达
2. 复制确保 skill 内容在执行期间不会被外部修改
3. 执行结束后文件随工作目录一起清理

### 4.7 会话管理器（`executor/session-manager.ts`）

#### 4.7.1 接口

```typescript
export interface SessionManager {
  /** 创建新 session */
  create(record: LlmSessionRecord): Promise<void>;
  /** 更新 session 状态 */
  update(sessionId: string, patch: Partial<LlmSessionRecord>): Promise<void>;
  /** 获取 session */
  get(sessionId: string): Promise<LlmSessionRecord | null>;
  /** 列出所有 session（最近的在前面） */
  list(limit?: number): Promise<LlmSessionRecord[]>;
  /** 删除 session */
  delete(sessionId: string): Promise<void>;
}

export function createFileSessionManager(sessionsRoot: string): SessionManager;
```

#### 4.7.2 实现

文件持久化到 `~/.metabot/LLM/executor/sessions/<sessionId>.json`。每个 session 一个文件，读写使用 `fs.readFile/writeFile`，不做内存缓存（daemon 重启后 session 状态仍在）。

### 4.8 主入口（`executor/executor.ts`）

```typescript
export class LlmExecutor {
  constructor(options: {
    /** session 存储目录 */
    sessionsRoot: string;
    /** transcript 存储目录 */
    transcriptsRoot: string;
    /** ~/.metabot/skills/ 路径 */
    skillsRoot: string;
    /** backend 工厂 */
    backends: Record<string, LlmBackendFactory>;
  });

  /**
   * 执行 LLM 请求。
   * 
   * @returns sessionId（用于后续 SSE 订阅）
   */
  async execute(request: LlmExecutionRequest): Promise<string>;

  /**
   * 取消正在运行的 session。
   */
  async cancel(sessionId: string): Promise<void>;

  /**
   * 获取 session 状态。
   */
  async getSession(sessionId: string): Promise<LlmSessionRecord | null>;

  /**
   * 列出最近的 sessions。
   */
  async listSessions(limit?: number): Promise<LlmSessionRecord[]>;

  /**
   * 创建 SSE 流 — 订阅 session 事件。
   * 返回 AsyncIterable<LlmExecutionEvent>。
   */
  streamEvents(sessionId: string): AsyncIterable<LlmExecutionEvent>;
}
```

**`execute()` 内部流程**：

1. 验证 `request.runtimeId` 和 `request.runtime`
2. 注入 skills（如果 `request.skills` 非空）：调用 `skillInjector`
3. 创建 `LlmSessionRecord`（status: 'starting'），持久化
4. 按 provider 选择 backend factory：
   - `'codex'` → `createCodexBackend(binaryPath, env)`
   - `'claude-code'` → `createClaudeBackend(binaryPath, env)`
5. 创建 `AbortController`
6. 调用 `backend.execute(request, emitter, abortSignal)`
   - `emitter` 在每次事件时更新 session record（text 累积到 output，tool_use/result 记录）
7. 等待 `backend.execute()` 返回 `LlmExecutionResult`
8. 更新 session record 为 terminal 状态
9. 返回 sessionId

---

## 5. MetaBot Daemon API 设计

### 5.1 新增端点

在 `src/daemon/routes/llm.ts` 中新增以下路由处理：

#### `POST /api/llm/execute`

```typescript
// Request Body
{
  runtimeId: string;
  prompt: string;
  systemPrompt?: string;
  maxTurns?: number;          // 默认不限制（由 provider 控制）
  timeout?: number;           // ms，默认 1_200_000 (20 min)
  semanticInactivityTimeout?: number; // ms，仅 Codex，默认 600_000 (10 min)
  cwd?: string;               // 默认 daemon CWD
  skills?: string[];          // skill 名称列表
  resumeSessionId?: string;   // 恢复之前的 session
  model?: string;
  metaBotSlug?: string;       // 关联的 MetaBot
  env?: Record<string, string>;
  extraArgs?: string[];
}

// Response (HTTP 202 Accepted)
{
  ok: true,
  data: {
    sessionId: string;        // 用于后续查询/流式订阅
    status: "starting";
  }
}
```

**Handler 逻辑**：

1. 读取 body，从 `~/.metabot/LLM/runtimes.json` 加载匹配 `runtimeId` 的 runtime
2. 如果 runtime 不存在或不健康 → 400
3. 调用 `executor.execute(request)` → 获得 sessionId
4. 返回 202 + sessionId

#### `GET /api/llm/sessions/:id`

```typescript
// 如果请求头 Accept: text/event-stream → SSE 模式
// 否则 → JSON 模式，返回当前 session record

// SSE 模式（推荐用于实时 UI）
// 每个事件作为一个 SSE message：
//   data: {"type":"text","content":"..."}
//   data: {"type":"tool_use","tool":"exec_command",...}
//   ...
//   data: {"type":"result","status":"completed","output":"...","usage":{...}}
//
// 连接在 session 完成后自动关闭

// JSON 模式
{
  ok: true,
  data: <LlmSessionRecord>
}
```

**SSE 实现要点**：

- 设置响应头：`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- 从 `executor.streamEvents(sessionId)` 读取事件
- 每个事件格式化为 `data: <JSON>\n\n`
- Session 已完成时发送最后一个 `result` 事件并关闭连接
- 处理客户端断开连接

#### `POST /api/llm/sessions/:id/cancel`

```typescript
// Response
{
  ok: true,
  data: { status: "cancelled" }
}
```

调用 `executor.cancel(sessionId)`。

#### `GET /api/llm/sessions`

```typescript
// Query: ?limit=20（默认 20，最大 100）
// Response
{
  ok: true,
  data: {
    sessions: LlmSessionRecord[];
  }
}
```

### 5.2 现有端点的修改

现有 LLM 端点（`/api/llm/runtimes`、`/api/llm/bindings/*`、`/api/llm/preferred-runtime/*`）保持不变。路由文件中新增上述 handler。

### 5.3 Handler 注册

在 `src/daemon/defaultHandlers.ts`（或相应的 handler 注册文件）中，新增 `llm.execute`、`llm.getSession`、`llm.cancelSession`、`llm.listSessions` handler。

### 5.4 Daemon 生命周期集成

在 `src/cli/runtime.ts` 的 `serveCliDaemonProcess()` 中：

1. 创建 `LlmExecutor` 实例（传入 sessionsRoot、transcriptsRoot、skillsRoot）
2. 将其注入到 handler 工厂中
3. 在 daemon shutdown 时不需要特殊清理（子进程由 AbortController 管理）

---

## 6. 私有聊天（Chat）集成改造

### 6.1 现状

`src/core/chat/hostLlmChatReplyRunner.ts` 使用 `executeLlm()`（来自 `hostLlmExecutor.ts`）：

```typescript
// 当前（一次性执行，无流式）
const execResult = await executeLlm({
  runtime: resolved.runtime,
  prompt,
  timeoutMs,
});
```

Chat runner 不知道执行过程，只拿到最终 `{ ok, output, exitCode }`。

### 6.2 改造目标

将 `executeLlm()` 调用替换为新的 `LlmExecutor`，保持现有 Chat 接口不变（Chat 不需要流式事件）。

### 6.3 改造方案

**选项 A（最小改动，推荐）**：在 Chat runner 中通过 daemon HTTP API 调用 execute。

```typescript
// hostLlmChatReplyRunner.ts 改造

async function tryExecute(...): Promise<...> {
  // ... resolve runtime ...

  const response = await fetch(`${daemonBaseUrl}/api/llm/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runtimeId: resolved.runtime.id,
      prompt,
      timeoutMs,
      metaBotSlug,
    }),
  });
  const { data } = await response.json();
  const sessionId = data.sessionId;

  // 轮询等待完成（或使用 SSE）
  // ... 等待 session 状态变为 terminal ...
  const session = await getSession(sessionId);

  if (session.result?.status === 'completed') {
    return {
      result: parseRunnerOutput(session.result.output),
      bindingId: resolved.bindingId,
    };
  }
  // ... fallback ...
}
```

**但这样会在 Chat runner 中引入 HTTP 调用**。更干净的做法是直接调用 `LlmExecutor` 实例（在 daemon 进程内）。

**选项 B（进程内调用）**：daemon 启动时将 `LlmExecutor` 实例注入到 handler 中，Chat runner 通过 handler 间接调用。

选择**选项 A**更简单，且保持了 Chat runner 与 Executor 的松耦合。

### 6.4 具体改动文件

1. `src/core/chat/hostLlmChatReplyRunner.ts`：
   - 修改 `tryExecute()` 函数，将 `executeLlm()` 替换为通过 daemon API 的 `POST /api/llm/execute` + 轮询 `GET /api/llm/sessions/:id`
   - 增加 daemon base URL 参数
   - `parseRunnerOutput()` 保持不变（结果解析逻辑不变）

2. `src/core/llm/hostLlmExecutor.ts`：
   - **保留但标记为 deprecated**
   - Chat runner 迁移完成后可删除

---

## 7. UI 界面改造（/ui/bot）

### 7.1 现状

`/ui/bot` 页面（`src/ui/pages/bot/index.html` + `app.ts`）当前功能：
- 显示 runtime 列表（名称、路径、版本、认证状态）
- 选择 profile，查看/管理其 bindings（role、priority、runtime）
- 统计卡片（runtimes、profiles、bindings、active profile）

### 7.2 需要新增的功能

**不改动现有功能**，额外增加：

#### 7.2.1 Runtime 健康状态实时显示

- 每个 runtime 显示健康状态指示灯（healthy=绿、degraded=黄、unavailable=红）
- 添加「重新发现」按钮（调用 `POST /api/llm/runtimes/discover`）

#### 7.2.2 执行历史面板

在页面底部增加「Recent Executions」区域：

- 列出最近的 session（调用 `GET /api/llm/sessions?limit=20`）
- 每行显示：时间、MetaBot、Provider、状态（色标）、耗时、prompt 摘要
- 点击展开可看到完整 prompt 和 output（截断 500 字符）
- 运行中的 session 显示「进行中」动画

#### 7.2.3 测试执行（可选，后期加）

添加一个简单的测试区：
- 选择一个 profile + runtime
- 输入简短 prompt
- 点击「Test Execute」→ 调用 `POST /api/llm/execute`
- 通过 SSE 实时显示执行事件流

此项标记为 P2，本次可不实现。

### 7.3 实现方式

OAC 的 UI 是服务端渲染的 HTML（TypeScript 生成 HTML 字符串 + 内联 JS）。不需要 React 或前端框架。

修改文件：
- `src/ui/pages/bot/index.html`：增加新 UI 区域的 HTML + CSS
- `src/ui/pages/bot/app.ts`：增加 API 调用和 DOM 操作逻辑 ии

---

## 8. 实施计划（分阶段）

### Phase 1：LLM Executor 核心（预计 3-5 天）

**文件**：
- `src/core/llm/executor/types.ts`
- `src/core/llm/executor/backends/backend.ts`
- `src/core/llm/executor/backends/codex.ts`（核心，~500 行）
- `src/core/llm/executor/backends/claude.ts`（核心，~400 行）
- `src/core/llm/executor/backends/openclaw.ts`（stub，~20 行）
- `src/core/llm/executor/skill-injector.ts`（~100 行）
- `src/core/llm/executor/session-manager.ts`（~100 行）
- `src/core/llm/executor/executor.ts`（~200 行）
- `src/core/llm/executor/index.ts`

**验收**：
1. Codex app-server：能启动、initialize、创建 thread、发送 turn、接收流式通知、返回结果
2. Claude stream-json：能启动、写 stdin、解析 stdout JSON 行、返回结果
3. Session manager：能创建、更新、读取 session 文件
4. Skill injector：能将 `~/.metabot/skills/<name>/` 复制到 `.claude/skills/<name>/` 等
5. 单元测试通过

### Phase 2：Daemon API + Chat 集成（预计 2-3 天）

**文件**：
- `src/daemon/routes/llm.ts`（修改，新增 ~100 行）
- `src/daemon/defaultHandlers.ts`（修改，新增 execute/getSession/cancelSession/listSessions handler）
- `src/cli/runtime.ts`（修改，创建 LlmExecutor 实例并注入）
- `src/core/chat/hostLlmChatReplyRunner.ts`（修改，切换到新的 execute API）
- `src/core/state/paths.ts`（修改，新增 llmExecutorRoot 等路径）

**验收**：
1. `POST /api/llm/execute` 返回 sessionId
2. `GET /api/llm/sessions/:id`（SSE）实时推送事件
3. `POST /api/llm/sessions/:id/cancel` 取消运行中的 session
4. `GET /api/llm/sessions` 列出历史
5. 私聊自动回复正常工作（通过新的 LLM Executor）
6. 私聊回复质量不低于改造前

### Phase 3：UI 完善（预计 1-2 天）

**文件**：
- `src/ui/pages/bot/index.html`（修改）
- `src/ui/pages/bot/app.ts`（修改）

**验收**：
1. Runtime 健康状态实时显示
2. 执行历史面板可见
3. 「重新发现」按钮能触发 runtime 扫描

### Phase 4：测试与文档（预计 1 天）

- 编写 `tests/llm/executor/` 下的单元测试
- 端到端测试：启动 daemon → POST execute → SSE 观察事件 → 确认完成
- 更新 `CLAUDE.md` 和相关文档

---

## 9. 验收标准

### 9.1 核心功能验收

| # | 验收项 | 验证方法 |
|---|--------|---------|
| 1 | Codex 以 app-server 模式运行 | `POST /api/llm/execute` 使用 codex runtime，SSE 能看到 `turn/started`、`item/agentMessage/delta`、`turn/completed` 等事件 |
| 2 | Claude 以 stream-json 模式运行 | `POST /api/llm/execute` 使用 claude-code runtime，SSE 能看到 `assistant`、`tool_use`、`result` 等事件 |
| 3 | 多轮执行（Codex） | 同一个 thread 发送两次 `turn/start`，第二次能继续第一次的上下文 |
| 4 | Session 恢复（Codex） | 第一次执行记录 threadId，第二次带 `resumeSessionId` 执行，能从之前的 workspace 继续 |
| 5 | Session 恢复（Claude） | 同上，使用 `--resume` flag |
| 6 | 技能注入 | `POST /api/llm/execute` 带 `skills: ["metabot-post-buzz"]`，确认 `.claude/skills/metabot-post-buzz/SKILL.md` 被写入 |
| 7 | 超时处理 | 设置 `timeout: 5000`，5 秒后 session 状态变为 `timeout` |
| 8 | 取消执行 | `POST /api/llm/sessions/:id/cancel` 后 session 状态变为 `cancelled` |
| 9 | Token 追踪 | 执行结果包含 `usage` 字段（input/output/cache tokens） |

### 9.2 Chat 集成验收

| # | 验收项 | 验证方法 |
|---|--------|---------|
| 10 | 私聊自动回复正常工作 | 两个 MetaBot 进行私聊，自动回复正常生成 |
| 11 | 回复质量不低于改造前 | 对比改造前后相同对话的回复内容 |
| 12 | 异常回退 | 当 runtime 不可用时，Chat 能回退到 template-only 回复（已有 fallback 逻辑保持不变） |

### 9.3 UI 验收

| # | 验收项 | 验证方法 |
|---|--------|---------|
| 13 | Runtime 健康状态显示 | 打开 `/ui/bot`，看到每个 runtime 的健康状态指示灯 |
| 14 | 执行历史面板 | 能看到最近的执行记录（状态、耗时、prompt 摘要） |
| 15 | 重新发现按钮 | 点击后触发 runtime 扫描，新 runtime 出现在列表中 |

### 9.4 非功能验收

| # | 验收项 | 验证方法 |
|---|--------|---------|
| 16 | 错误处理健壮 | Codex/Claude 进程崩溃时，session 正确标记为 failed，没有僵尸进程 |
| 17 | 日志可追溯 | daemon log 中能看到完整的 agent 启动、执行、退出日志 |
| 18 | 并发安全 | 同时执行多个 session 不会互相干扰 |

---

## 10. 附录：参考实现

### 10.1 关键参考文件

| 参考 | 文件 | 用途 |
|------|------|------|
| Multica Codex | `multica/server/pkg/agent/codex.go` | Codex app-server JSON-RPC 2.0 完整实现 |
| Multica Claude | `multica/server/pkg/agent/claude.go` | Claude Code stream-json 完整实现 |
| Multica Backend | `multica/server/pkg/agent/agent.go` | Backend 接口定义 |
| Multica Skill | `multica/server/internal/daemon/execenv/context.go` | 技能注入路径映射 |
| Symphony Codex | `symphony/elixir/lib/symphony_elixir/codex/app_server.ex` | JSON-RPC 2.0 协议参考 |
| OAC Chat | `open-agent-connect/src/core/chat/hostLlmChatReplyRunner.ts` | Chat 集成点 |
| OAC LLM Types | `open-agent-connect/src/core/llm/llmTypes.ts` | 已有类型定义 |
| OAC Paths | `open-agent-connect/src/core/state/paths.ts` | 路径解析入口 |
| OAC Skill Bind | `open-agent-connect/src/core/host/hostSkillBinding.ts` | 已有技能 symlink 逻辑 |

### 10.2 Multica Go → TypeScript 映射

Multica 的 Go 实现是本文档的主要参考。以下是关键概念映射：

| Go (Multica) | TypeScript (本项目) |
|-------------|-------------------|
| `agent.Backend` interface | `LlmBackend` interface |
| `agent.ExecOptions` struct | `LlmExecutionRequest` interface |
| `agent.Session{Messages, Result}` | `LlmExecutor.execute()` + SSE |
| `agent.Message` struct | `LlmExecutionEvent` union type |
| `agent.Result` struct | `LlmExecutionResult` interface |
| `codexBackend.Execute()` | `CodexBackend.execute()` |
| `claudeBackend.Execute()` | `ClaudeBackend.execute()` |
| `codexClient` struct | `CodexBackend` 内部 JSON-RPC 客户端 |
| `startOrResumeThread()` | `execute()` 内的 thread/start 或 thread/resume 逻辑 |
| `writeContextFiles()` | `injectSkills()` |
| `resolveSkillsDir()` | `resolveProviderSkillRoot()` |
