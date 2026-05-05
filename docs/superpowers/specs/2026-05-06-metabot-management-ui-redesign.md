# MetaBot 管理页面重设计 开发方案（SDD 文档）

> **目标读者**：AI 开发 Agent（Claude Code / Codex），需能直接根据本文档进行开发。
> **语言**：中文。代码注释、commit message 使用英文。
> **原则**：所有改动在 `open-agent-connect` 仓库内完成。本文档描述的是 `/ui/bot` 页面从 LLM-runtime 中心视角重设计为 MetaBot 中心视角的完整方案。

---

## 目录

1. [概述与目标](#1-概述与目标)
2. [架构总览](#2-架构总览)
3. [数据模型变更](#3-数据模型变更)
4. [Provider 检测扩展](#4-provider-检测扩展)
5. [MetaBot Profile Manager 模块](#5-metabot-profile-manager-模块)
6. [API 设计](#6-api-设计)
7. [UI 界面重设计](#7-ui-界面重设计)
8. [Chain Sync 集成](#8-chain-sync-集成)
9. [实施计划（分阶段）](#9-实施计划分阶段)
10. [验收标准](#10-验收标准)
11. [附录：参考实现](#11-附录参考实现)

---

## 1. 概述与目标

### 1.1 背景

当前 `/ui/bot` 页面（`src/ui/pages/bot/`）是一个 LLM Runtime 管理面板：

- 展示 LLM 运行时列表（名称、路径、版本、认证状态、健康状态）
- Profile 下拉选择器，切换 profile 后加载 bindings
- Bindings 表格（primary/fallback/reviewer/specialist 四种 role，priority 优先级）
- Preferred Runtime 设置
- 执行历史列表

**问题**：MetaBot 在这里被弱化为一个 profile 选择器，LLM runtime 成为主角。用户的核心心智模型应该是「管理我的 MetaBot」，LLM 只是 MetaBot 的一个属性（类似电脑的 CPU 配置）。

### 1.2 目标

将 `/ui/bot` 改造为以 **MetaBot 为中心** 的管理页面：

1. **顶部摘要区**：4 个统计卡片 — BOTS（MetaBot 数量）、RUNTIMES（健康 runtime 数量）、EXECUTION（执行总次数）、SUCCESS RATE（成功率）
2. **左右布局**：左 MetaBot 列表，右详细信息区（参照 `/ui/trace` 页面布局）
3. **MetaBot 列表**：头像、名字、GlobalMetaID + 复制按钮
4. **右侧详情区**：TabBar 切换「基础信息」「执行历史」
5. **基础信息 Tab**：可编辑字段 — 名字、头像（允许上传本地文件）、角色（读/写 ROLE.md）、灵魂（读/写 SOUL.md）、目标（读/写 GOAL.md）、Primary Provider（可用 provider 下拉）、Fallback Provider（可用 provider 下拉）
6. **执行历史 Tab**：当前 MetaBot 的执行历史列表
7. **添加 MetaBot**：名字必填，其他可选
8. **修改后同步上链**：先上链，成功后再保存本地，链为 Single Source of Truth

### 1.3 不做的事

- 不实现钱包显示 / token 余额 / 手动转账
- 不实现助记词恢复
- 不保留 reviewer / specialist / priority 等 LLM role 概念（内部保留默认值，UI 不暴露）
- 不实现「背景」「主人 metaid」字段
- 不保留 Preferred Runtime UI
- 不保留 Profile 下拉选择器（被左侧 MetaBot 列表替代）
- 不改动 `openloom` 仓库
- 不实现 10-bot 限制

---

## 2. 架构总览

### 2.1 页面结构

```
┌──────────────────────────────────────────────────────┐
│  Topbar (MetaBot logo + Bot Management + Nav)         │
├──────────────────────────────────────────────────────┤
│  [BOTS: 3]  [RUNTIMES: 5]  [EXECUTIONS: 128]  [SUCCESS RATE: 94%]  │
├──────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌────────────────────────────────┐ │
│  │ MetaBots     │  │ [Basic Info] [Exec History]     │ │
│  │              │  │ ─────────────────────────────── │ │
│  │ [Avatar] Bot1│  │                                  │ │
│  │ idq1gc... 📋 │  │  Avatar: [img] [Upload]          │ │
│  │              │  │  GlobalMetaID: idq1gc... [📋]    │ │
│  │ [Avatar] Bot2│  │  Name: [____________]            │ │
│  │ idm3kd... 📋 │  │  Role: [____________]            │ │
│  │              │  │  Soul: [____________]            │ │
│  │ [Avatar] Bot3│  │  Goal: [____________]            │ │
│  │ idxp94... 📋 │  │  Primary Provider: [dropdown▼]   │ │
│  │              │  │  Fallback Provider: [dropdown▼]  │ │
│  │ [+ Add Bot]  │  │  [Save Changes]  ✓ Saved          │ │
│  └──────────────┘  └────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### 2.2 数据流

```
Browser GET /ui/bot
  → Daemon: renderBuiltInPage('bot')
    → loadTemplate('bot') → index.html
    → buildBotPageDefinition() → inline JS script
  → Returns full HTML

Page load (JS):
  → GET /api/bot/stats       → 4 stat cards
  → GET /api/bot/profiles    → left metabot list
  → GET /api/bot/runtimes    → provider dropdowns
  → GET /api/bot/sessions    → history preload

Select metabot:
  → Click left item
  → state.selectedSlug = slug
  → Render info tab (from cached profile data)
  → If history tab active: GET /api/bot/sessions?slug=xxx

Edit & Save:
  → User edits fields → clicks Save
  → PUT /api/bot/profiles/:slug { name?, role?, soul?, goal?, avatarDataUrl?, primaryProvider?, fallbackProvider? }
  → Server: chain sync first (if on chain) → then local save
  → Return updated profile → update UI

Create metabot:
  → + Add MetaBot → fill name → Create
  → POST /api/bot/profiles { name, role?, soul?, goal? }
  → Server: create local profile (no chain sync on create)
  → Close modal, reload list, select new bot
```

### 2.3 文件清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `src/core/llm/llmTypes.ts` | 扩展 provider 从 3 → 11，新增常量映射 |
| 修改 | `src/core/llm/llmRuntimeDiscovery.ts` | 扩展 provider 检测逻辑 |
| **新建** | `src/core/bot/metabotProfileManager.ts` | MetaBot profile 业务逻辑 + chain sync |
| **新建** | `src/daemon/routes/bot.ts` | `/api/bot/*` 路由 handler |
| 修改 | `src/daemon/routes/types.ts` | 新增 `bot` handler 类型 |
| 修改 | `src/daemon/defaultHandlers.ts` | 注册 bot handler 实现 |
| 修改 | `src/daemon/httpServer.ts` | 注册 bot 路由 |
| 重写 | `src/ui/pages/bot/index.html` | 全新 HTML + CSS（左右布局） |
| 重写 | `src/ui/pages/bot/app.ts` | 全新 JS 逻辑 |
| 不改 | `src/ui/pages/types.ts` | 页面定义接口不变 |
| 不改 | `src/daemon/routes/ui.ts` | 页面路由不变 |
| 不改 | `src/core/state/paths.ts` | 路径解析已覆盖所需 |
| 不改 | `src/core/identity/identityProfiles.ts` | 复用现有 profile CRUD |

---

## 3. 数据模型变更

### 3.1 Provider 类型扩展

**文件**：`src/core/llm/llmTypes.ts`

```typescript
// 扩展前
export type LlmProvider = 'claude-code' | 'codex' | 'openclaw' | 'custom';

// 扩展后
export type LlmProvider =
  | 'claude-code' | 'codex' | 'copilot' | 'opencode'
  | 'openclaw' | 'hermes' | 'gemini' | 'pi'
  | 'cursor' | 'kimi' | 'kiro' | 'custom';
```

**新增常量**：

```typescript
export const SUPPORTED_LLM_PROVIDERS: LlmProvider[] = [
  'claude-code', 'codex', 'copilot', 'opencode',
  'openclaw', 'hermes', 'gemini', 'pi',
  'cursor', 'kimi', 'kiro',
];

export const HOST_BINARY_MAP: Record<string, string> = {
  'claude-code': 'claude',
  'codex': 'codex',
  'copilot': 'gh',           // GitHub Copilot CLI 二进制名为 gh（gh copilot）
  'opencode': 'opencode',
  'openclaw': 'openclaw',
  'hermes': 'hermes',
  'gemini': 'gemini',
  'pi': 'pi',
  'cursor': 'cursor-agent',
  'kimi': 'kimi',
  'kiro': 'kiro-cli',
};

export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  'codex': 'Codex (OpenAI)',
  'copilot': 'GitHub Copilot CLI',
  'opencode': 'OpenCode',
  'openclaw': 'OpenClaw',
  'hermes': 'Hermes',
  'gemini': 'Gemini CLI',
  'pi': 'Pi',
  'cursor': 'Cursor Agent',
  'kimi': 'Kimi',
  'kiro': 'Kiro CLI',
};
```

**更新 `isLlmProvider` guard**：包含全部 11 个 provider 字符串。

**更新 `HOST_SEARCH_ORDER`**：包含全部 11 个 provider，claude-code 优先。

**保留 `LlmBindingRole` 类型**（`'primary' | 'fallback' | 'reviewer' | 'specialist'`）不删除，内部仍使用，但 UI 不再暴露 `reviewer` 和 `specialist`。

### 3.2 MetaBotProfileFull 类型

**文件**：`src/core/bot/metabotProfileManager.ts`（新建）

```typescript
import type { LlmProvider } from '../llm/llmTypes';

export interface MetabotProfileFull {
  // 来自 identity-profiles.json
  name: string;
  slug: string;
  aliases: string[];
  homeDir: string;
  globalMetaId: string;
  mvcAddress: string;
  createdAt: number;
  updatedAt: number;
  // 来自 persona 文件
  role: string;       // ROLE.md 内容
  soul: string;       // SOUL.md 内容
  goal: string;       // GOAL.md 内容
  // 头像
  avatarDataUrl?: string;  // data:image/...;base64,...
  // 来自 LLM bindings
  primaryProvider?: LlmProvider | null;
  fallbackProvider?: LlmProvider | null;
}

export interface CreateMetabotInput {
  name: string;           // 必填
  role?: string;          // 可选
  soul?: string;          // 可选
  goal?: string;          // 可选
  avatarDataUrl?: string; // 可选，data URL，max 200KB
}

export interface UpdateMetabotInfoInput {
  name?: string;
  role?: string;
  soul?: string;
  goal?: string;
  avatarDataUrl?: string;
  primaryProvider?: LlmProvider | null;
  fallbackProvider?: LlmProvider | null;
}
```

---

## 4. Provider 检测扩展

### 4.1 修改 `llmRuntimeDiscovery.ts`

**主要改动**：

1. 从 `llmTypes.ts` 导入 `PROVIDER_DISPLAY_NAMES`
2. `discoverProvider()` 中的 display name 查询改用 `PROVIDER_DISPLAY_NAMES`
3. 扩展 auth state 检测逻辑：

```typescript
function detectAuthState(provider: LlmProvider, env: NodeJS.ProcessEnv): LlmAuthState {
  const checks: Record<string, string> = {
    'claude-code': 'ANTHROPIC_API_KEY',
    'codex': 'OPENAI_API_KEY',
    'copilot': 'GITHUB_TOKEN',
    'gemini': 'GEMINI_API_KEY',
    'kimi': 'KIMI_API_KEY',
  };
  const envVar = checks[provider];
  if (envVar && env[envVar]) return 'authenticated';
  // 对于没有明确 API key 环境变量的 provider，检查通用变量
  if (provider === 'opencode' && (env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY)) return 'authenticated';
  return 'unknown';
}
```

4. `--version` 检测对所有 provider 通用（spawn `binaryPath --version`，5 秒超时）

5. 新增 provider 的 `displayNames` fallback 使用 `PROVIDER_DISPLAY_NAMES`

### 4.2 二进制名映射说明

| Provider ID | 二进制名 | 备注 |
|-------------|---------|------|
| `claude-code` | `claude` | Anthropic Claude Code CLI |
| `codex` | `codex` | OpenAI Codex CLI |
| `copilot` | `gh` | GitHub Copilot 通过 `gh copilot` 子命令 |
| `opencode` | `opencode` | OpenCode CLI |
| `openclaw` | `openclaw` | OpenClaw CLI |
| `hermes` | `hermes` | Hermes ACP |
| `gemini` | `gemini` | Google Gemini CLI |
| `pi` | `pi` | Pi CLI |
| `cursor` | `cursor-agent` | Cursor Agent |
| `kimi` | `kimi` | Kimi ACP |
| `kiro` | `kiro-cli` | Kiro CLI |

---

## 5. MetaBot Profile Manager 模块

**文件**：`src/core/bot/metabotProfileManager.ts`（新建）

### 5.1 依赖关系

```
metabotProfileManager.ts
  ├── identityProfiles.ts    (listIdentityProfiles, upsertIdentityProfile)
  ├── profileNameResolution.ts (generateProfileSlug)
  ├── profileWorkspace.ts    (ensureProfileWorkspace)
  ├── state/paths.ts         (resolveMetabotPaths)
  ├── llm/llmTypes.ts        (LlmProvider, normalizeLlmBinding)
  ├── llm/llmBindingStore.ts (createLlmBindingStore)
  └── signing/signer.ts      (Signer.writePin)
```

### 5.2 导出函数

#### `listMetabotProfiles(systemHomeDir: string): Promise<MetabotProfileFull[]>`

1. 调用 `listIdentityProfiles(systemHomeDir)` 获取所有 profile
2. 对每个 profile：
   - 调用 `resolveMetabotPaths(profile.homeDir)` 获取路径
   - 读 `roleMdPath` → role 字段（ROLE.md），文件不存在则返回空字符串
   - 读 `soulMdPath` → soul 字段（SOUL.md）
   - 读 `goalMdPath` → goal 字段（GOAL.md）
   - 读 `{profileDir}/avatar.txt` → avatarDataUrl（不存在则为 undefined）
   - 读 `llmbindings.json` → 提取 primary binding（role==='primary'）和 fallback binding（role==='fallback'）的 `llmRuntimeId`，从 `runtimes.json` 解析出 provider
3. 按 `updatedAt` 降序排列

#### `getMetabotProfile(systemHomeDir: string, slug: string): Promise<MetabotProfileFull | null>`

同 `listMetabotProfiles`，但只查单个 slug。未找到返回 null。

#### `createMetabotProfile(systemHomeDir: string, input: CreateMetabotInput): Promise<MetabotProfileFull>`

1. 验证 name 非空
2. 使用 `generateProfileSlug(name)` 生成 slug
3. 解析 homeDir = `~/.metabot/profiles/<slug>/`
4. 调用 `ensureProfileWorkspace(homeDir)` 创建目录
5. 写入 `ROLE.md`（默认值：`"I am a helpful AI assistant."`，如果 input.role 非空则写入 input.role）
6. 写入 `SOUL.md`（默认值：`"Friendly and professional."`，如果 input.soul 非空则写入 input.soul）
7. 写入 `GOAL.md`（默认值：`"Help users accomplish their tasks effectively."`，如果 input.goal 非空则写入 input.goal）
8. 如果 `input.avatarDataUrl` 非空：验证 ≤ 200KB，写入 `avatar.txt`
9. 调用 `upsertIdentityProfile({ systemHomeDir, name, homeDir })` 注册到 identity-profiles.json
10. 返回完整 `MetabotProfileFull`

#### `updateMetabotProfile(systemHomeDir: string, slug: string, input: UpdateMetabotInfoInput): Promise<MetabotProfileFull>`

1. 读取现有 profile（调用 `getMetabotProfile`）
2. 如果不存在 → throw
3. 如果 `input.name` 有变化：调用 `upsertIdentityProfile` 更新
4. 如果 `input.role` 非 undefined：写入 `ROLE.md`
5. 如果 `input.soul` 非 undefined：写入 `SOUL.md`
6. 如果 `input.goal` 非 undefined：写入 `GOAL.md`
7. 如果 `input.avatarDataUrl` 非 undefined：
   - 若为空字符串 → 删除 `avatar.txt`
   - 否则验证 ≤ 200KB（`dataUrl.length * 0.75`），写入 `avatar.txt`
8. 如果 `input.primaryProvider` 或 `input.fallbackProvider` 非 undefined：更新 `llmbindings.json`
   - 从 runtimes.json 查找匹配 provider 的 runtime
   - 更新/创建对应的 binding（role='primary' / 'fallback'）
   - 保持其他 binding 不变
9. 返回刷新后的 `MetabotProfileFull`

#### `syncMetabotInfoToChain(signer: Signer, profile: MetabotProfileFull, changedFields: string[]): Promise<ChainWriteResult[]>`

参照 IDBots 实现，顺序写入 pins，每步之间 sleep 3000ms：

```
1. 若 changedFields 含 'name'：
   signer.writePin({
     operation: 'modify',
     path: '/info/name',
     encryption: '0',
     version: '1.0',
     contentType: 'application/json',
     payload: JSON.stringify({ name: profile.name }),
     encoding: 'utf-8',
     network: 'mvc',
   })
   → sleep 3000ms

2. 若 changedFields 含 'avatar' 且 profile.avatarDataUrl 非空：
   signer.writePin({
     operation: 'modify',
     path: '/info/avatar',
     encryption: '0',
     version: '1.0',
     contentType: 'image/png',  // 或从 data URL 解析 MIME
     payload: profile.avatarDataUrl,
     encoding: 'utf-8',
     network: 'mvc',
   })
   → sleep 3000ms

3. 若 changedFields 含 role/soul/goal/primaryProvider/fallbackProvider 任一：
   signer.writePin({
     operation: 'modify',
     path: '/info/bio',
     encryption: '0',
     version: '1.0',
     contentType: 'application/json',
     payload: JSON.stringify({
       role: profile.role,
       soul: profile.soul,
       goal: profile.goal,
       primaryProvider: profile.primaryProvider,
       fallbackProvider: profile.fallbackProvider,
     }),
     encoding: 'utf-8',
     network: 'mvc',
   })
```

**仅当 profile 有 globalMetaId（已上链）时才执行 chain sync**。若 chain sync 失败，抛出错误（不保存本地）。

#### 5.3 辅助函数

```typescript
// 读取文本文件，不存在则返回空字符串
async function readTextFile(filePath: string): Promise<string>

// 验证 data URL 是否为有效的 base64 图片且 ≤ maxBytes
function validateAvatarDataUrl(dataUrl: string, maxBytes: number): { valid: boolean; error?: string }
```

---

## 6. API 设计

### 6.1 新建路由文件

**文件**：`src/daemon/routes/bot.ts`（新建，参照 `src/daemon/routes/llm.ts` 模式）

#### `GET /api/bot/stats`

返回聚合统计数据：

```json
{
  "ok": true,
  "data": {
    "botCount": 3,
    "healthyRuntimes": 5,
    "totalExecutions": 128,
    "successRate": 94
  }
}
```

**Handler 逻辑**：
1. 调用 `listIdentityProfiles(systemHomeDir)` → botCount
2. 调用 `runtimeStore.read()` → 统计 health==='healthy' 数量
3. 调用 `executor.listSessions(1000)` → totalExecutions，completed 数量
4. 计算 `successRate = totalExecutions > 0 ? Math.round(completed / totalExecutions * 100) : 0`

#### `GET /api/bot/profiles`

返回所有 MetaBot 列表：

```json
{
  "ok": true,
  "data": {
    "profiles": [ /* MetabotProfileFull[] */ ]
  }
}
```

**Handler 逻辑**：调用 `listMetabotProfiles(systemHomeDir)`

#### `GET /api/bot/profiles/:slug`

返回单个 MetaBot 详情：

```json
{
  "ok": true,
  "data": {
    "profile": { /* MetabotProfileFull */ }
  }
}
```

未找到返回 404。

#### `POST /api/bot/profiles`

创建新 MetaBot：

```json
// Request
{
  "name": "My Bot",           // 必填
  "role": "Assistant",        // 可选
  "soul": "Friendly...",      // 可选
  "goal": "Help users..."     // 可选
}

// Response 201
{
  "ok": true,
  "data": {
    "profile": { /* MetabotProfileFull */ }
  }
}
```

**验证**：
- name 必填且非空，否则 400 `missing_name`
- name 不重复（使用 `resolveProfileNameMatch` 检测），否则 400 `name_taken`

#### `PUT /api/bot/profiles/:slug`

更新 MetaBot 信息：

```json
// Request（所有字段可选）
{
  "name": "New Name",
  "role": "New role content",
  "soul": "New soul content",
  "goal": "New goal content",
  "avatarDataUrl": "data:image/png;base64,...",
  "primaryProvider": "claude-code",
  "fallbackProvider": null
}

// Response 200
{
  "ok": true,
  "data": {
    "profile": { /* updated MetabotProfileFull */ }
  }
}
```

**Handler 逻辑**（关键：chain sync first）：
1. 读取当前 profile（`getMetabotProfile`）
2. 计算 changedFields
3. **若 profile 有 globalMetaId 且有变更**：
   - 获取 signer（通过 `handlers.bot` 注入或从 daemon context 获取）
   - 调用 `syncMetabotInfoToChain(signer, profile, changedFields)`
   - 如果 chain sync 失败 → 返回 400 `chain_sync_failed`，**不保存本地**
4. 调用 `updateMetabotProfile(systemHomeDir, slug, input)`
5. 返回更新后的 profile

#### `GET /api/bot/runtimes`

返回所有已发现的 runtime：

```json
{
  "ok": true,
  "data": {
    "runtimes": [ /* LlmRuntime[] */ ],
    "version": 1
  }
}
```

#### `POST /api/bot/runtimes/discover`

触发 PATH 扫描：

```json
{
  "ok": true,
  "data": {
    "discovered": 5,
    "runtimes": [ /* updated LlmRuntime[] */ ]
  }
}
```

#### `GET /api/bot/sessions?slug=xxx&limit=50`

返回执行历史，可按 slug 过滤：

```json
{
  "ok": true,
  "data": {
    "sessions": [ /* LlmSessionRecord[] */ ]
  }
}

### 6.2 路由注册

修改 `src/daemon/routes/types.ts`，新增 `bot` handler：

```typescript
bot?: {
  getStats?: () => Awaitable<MetabotCommandResult<unknown>>;
  listProfiles?: () => Awaitable<MetabotCommandResult<unknown>>;
  getProfile?: (input: { slug: string }) => Awaitable<MetabotCommandResult<unknown>>;
  createProfile?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  updateProfile?: (input: { slug: string } & Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  listRuntimes?: () => Awaitable<MetabotCommandResult<unknown>>;
  discoverRuntimes?: () => Awaitable<MetabotCommandResult<unknown>>;
  listSessions?: (input: { slug?: string; limit: number }) => Awaitable<MetabotCommandResult<unknown>>;
};
```

修改 `src/daemon/defaultHandlers.ts`，注册 handler 实现（调用 `metabotProfileManager.ts` 中的函数）。

修改 `src/daemon/httpServer.ts`，在 `ROUTES` 数组中注册 `handleBotRoutes`。

### 6.3 现有 API 保留

以下现有端点**保留不动**（向后兼容）：
- `/api/llm/runtimes` GET/POST
- `/api/llm/bindings/:slug` GET/PUT
- `/api/llm/preferred-runtime/:slug` GET/PUT
- `/api/llm/sessions` GET
- `/api/identity/profiles` GET

---

## 7. UI 界面重设计

### 7.1 HTML 模板结构

**文件**：`src/ui/pages/bot/index.html`（完全重写）

采用 trace 页面相同的 full-height 左右布局模式：

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>__PAGE_TITLE__</title>
  <link rel="stylesheet" href="/ui/shared.css" />
  <style>
    /* ── Bot page: full-height two-panel layout ── */
    .bot-shell {
      display: flex; flex-direction: column;
      height: 100vh; overflow: hidden;
    }

    /* Stats strip */
    .bot-stats {
      display: flex; gap: 12px;
      padding: 16px 24px 0;
      flex-shrink: 0; flex-wrap: wrap;
    }
    .bot-stats .stat-card { flex: 1; min-width: 120px; }

    /* Two-panel workspace */
    .bot-workspace {
      flex: 1; display: flex; gap: 0; min-height: 0;
      margin: 16px 24px 24px;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      overflow: hidden; background: var(--surface);
    }

    /* ── Left panel: metabot list ── */
    .metabot-panel {
      width: 300px; flex-shrink: 0;
      border-right: 1px solid var(--border);
      display: flex; flex-direction: column;
      min-height: 0; background: var(--surface);
    }
    .metabot-panel-header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      display: flex; align-items: center; gap: 8px;
      flex-shrink: 0;
    }
    .metabot-panel-title {
      font-size: 11px; font-family: var(--mono); font-weight: 500;
      color: var(--muted); text-transform: uppercase;
      letter-spacing: .08em; flex: 1;
    }
    .metabot-panel-count {
      font-size: 11px; font-family: var(--mono); color: var(--dim);
    }
    .metabot-list-scroll {
      flex: 1; overflow-y: auto; min-height: 0;
    }
    .metabot-list-scroll::-webkit-scrollbar { width: 4px; }
    .metabot-list-scroll::-webkit-scrollbar-track { background: transparent; }
    .metabot-list-scroll::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

    /* Metabot list item */
    .metabot-item {
      padding: 12px 16px; border-bottom: 1px solid var(--border);
      cursor: pointer; transition: background .1s; outline: none;
      display: flex; align-items: center; gap: 10px;
    }
    .metabot-item:hover { background: var(--surface2); }
    .metabot-item.selected {
      background: var(--surface3); border-left: 2px solid var(--accent);
    }
    .metabot-item.selected:hover { background: var(--surface3); }

    .metabot-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      object-fit: cover; flex-shrink: 0;
      background: var(--surface2); border: 1px solid var(--border);
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; color: var(--dim); overflow: hidden;
    }
    .metabot-avatar img {
      width: 100%; height: 100%; object-fit: cover;
    }
    .metabot-avatar-placeholder {
      font-size: 18px; color: var(--dim);
    }

    .metabot-item-info { min-width: 0; flex: 1; }
    .metabot-item-name {
      font-size: 13px; font-weight: 500; color: var(--text);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .metabot-item-id-row {
      display: flex; align-items: center; gap: 4px; margin-top: 2px;
    }
    .metabot-item-id {
      font-size: 10px; font-family: var(--mono); color: var(--dim);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .metabot-item-copy {
      width: 18px; height: 18px; display: inline-flex;
      align-items: center; justify-content: center;
      border: 0; background: transparent; color: var(--muted);
      padding: 0; cursor: pointer; border-radius: 3px;
      flex-shrink: 0; transition: color .1s, background .1s;
    }
    .metabot-item-copy:hover { color: var(--accent); background: var(--surface3); }

    /* Add button at bottom of left panel */
    .metabot-panel-footer {
      padding: 10px 16px; border-top: 1px solid var(--border);
      flex-shrink: 0;
    }

    /* ── Right panel ── */
    .detail-panel {
      flex: 1; display: flex; flex-direction: column;
      min-height: 0; min-width: 0; background: var(--bg);
    }

    /* Empty / loading states */
    .detail-empty, .detail-loading {
      flex: 1; display: flex; align-items: center;
      justify-content: center; color: var(--muted);
      font-size: 13px; flex-direction: column; gap: 8px;
      padding: 32px; text-align: center;
    }

    /* Tab bar */
    .tab-bar {
      display: flex; border-bottom: 1px solid var(--border);
      background: var(--surface); flex-shrink: 0; padding: 0 12px;
    }
    .tab-btn {
      padding: 12px 16px; font-size: 12px;
      font-family: var(--mono); font-weight: 500;
      color: var(--muted); background: none; border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer; transition: color .15s, border-color .15s;
      white-space: nowrap;
    }
    .tab-btn:hover { color: var(--text); }
    .tab-btn.active {
      color: var(--accent); border-bottom-color: var(--accent);
    }

    /* Tab content area */
    .tab-content {
      flex: 1; overflow-y: auto; padding: 20px 24px; min-height: 0;
    }
    .tab-content::-webkit-scrollbar { width: 4px; }
    .tab-content::-webkit-scrollbar-track { background: transparent; }
    .tab-content::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    /* ── Info tab form ── */
    .info-avatar-section {
      display: flex; align-items: center; gap: 16px;
      margin-bottom: 20px;
    }
    .info-avatar-preview {
      width: 72px; height: 72px; border-radius: 50%;
      object-fit: cover; background: var(--surface2);
      border: 2px dashed var(--border2);
      display: flex; align-items: center; justify-content: center;
      font-size: 32px; color: var(--dim); overflow: hidden;
    }
    .info-avatar-preview img {
      width: 100%; height: 100%; object-fit: cover;
    }
    .info-avatar-actions {
      display: flex; flex-direction: column; gap: 6px;
    }
    .info-id-row {
      display: flex; align-items: center; gap: 8px;
      margin-bottom: 20px;
      font-family: var(--mono); font-size: 12px; color: var(--dim);
    }
    .info-id-row code {
      background: var(--surface2); padding: 3px 8px;
      border-radius: 4px; font-size: 11px;
    }

    .info-form-grid {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .info-form-grid .field-full { grid-column: 1 / -1; }

    .field { display: flex; flex-direction: column; gap: 6px; }
    .field label {
      font-size: 11px; font-family: var(--mono); color: var(--muted);
      text-transform: uppercase; letter-spacing: .06em;
      font-weight: 500;
    }
    .field input, .field textarea, .field select {
      background: var(--bg); border: 1px solid var(--border2);
      border-radius: var(--radius-sm); padding: 8px 12px;
      color: var(--text); font-family: var(--sans); font-size: 13px;
    }
    .field input:focus, .field textarea:focus, .field select:focus {
      outline: none; border-color: var(--accent);
    }
    .field textarea {
      resize: vertical; min-height: 60px;
      font-family: var(--mono); font-size: 12px; line-height: 1.5;
    }

    /* Provider dropdown - wider */
    .provider-select {
      min-width: 280px;
    }

    /* Save row */
    .info-save-row {
      display: flex; align-items: center; gap: 12px;
      margin-top: 20px; padding-top: 16px;
      border-top: 1px solid var(--border);
    }
    .save-status {
      font-size: 11px; font-family: var(--mono);
    }
    .save-status.success { color: var(--green); }
    .save-status.error { color: var(--red); }
    .save-status.saving { color: var(--amber); }

    /* ── History tab table ── */
    .exec-table { min-width: 900px; }
    .exec-time, .exec-provider { font-family: var(--mono); font-size: 11px; color: var(--muted); white-space: nowrap; }
    .exec-runtime { font-size: 12px; color: var(--text); white-space: nowrap; }
    .exec-prompt { font-size: 12px; color: var(--muted); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .exec-duration { font-family: var(--mono); font-size: 11px; color: var(--dim); white-space: nowrap; }
    .exec-detail-toggle { white-space: nowrap; }
    .exec-detail-row td {
      background: var(--surface2); border-top: 0; padding: 0 12px 12px;
    }
    .exec-detail {
      display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr);
      gap: 12px; border: 1px solid var(--border);
      border-radius: var(--radius-sm); background: var(--bg);
      padding: 12px;
    }
    .exec-detail-label {
      font-family: var(--mono); font-size: 10px;
      text-transform: uppercase; letter-spacing: .06em;
      color: var(--dim); margin-bottom: 6px;
    }
    .exec-detail pre {
      margin: 0; max-height: 180px; overflow: auto;
      white-space: pre-wrap; word-break: break-word;
      font-family: var(--mono); font-size: 11px; line-height: 1.45;
      color: var(--text);
    }

    /* ── Modal ── */
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,.6);
      z-index: 100; display: flex; align-items: center;
      justify-content: center;
    }
    .modal-overlay.hidden { display: none; }
    .modal-box {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius-lg); padding: 24px;
      width: 440px; max-width: 90vw;
    }
    .modal-title {
      font-size: 15px; font-family: var(--mono); font-weight: 500;
      color: var(--text); margin-bottom: 20px;
    }
    .modal-body { display: flex; flex-direction: column; gap: 14px; }
    .modal-actions {
      display: flex; gap: 10px; justify-content: flex-end;
      margin-top: 20px;
    }

    /* ── Toast ── */
    .copy-toast {
      position: fixed; right: 24px; bottom: 24px; z-index: 50;
      padding: 8px 12px; border-radius: var(--radius-sm);
      background: rgba(16,24,40,.94); color: #fff;
      font-size: 12px; font-family: var(--mono); text-align: center;
      box-shadow: 0 8px 22px rgba(0,0,0,.22);
      opacity: 0; transform: translateY(8px); pointer-events: none;
      transition: opacity .16s, transform .16s;
    }
    .copy-toast.show { opacity: 1; transform: translateY(0); }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .bot-stats { padding: 12px 16px 0; }
      .bot-workspace { margin: 12px 16px 16px; flex-direction: column; }
      .metabot-panel {
        width: 100%; border-right: none;
        border-bottom: 1px solid var(--border); max-height: 220px;
      }
      .detail-panel { min-height: 300px; }
      .info-form-grid { grid-template-columns: 1fr; }
      .tab-content { padding: 16px; }
    }
  </style>
</head>
<body>
<div class="bot-shell">
  <header class="topbar">
    <a class="topbar-logo" href="/ui/hub">MetaBot</a>
    <div class="topbar-sep"></div>
    <span class="topbar-title">Bot Management</span>
    <div class="topbar-spacer"></div>
    <nav class="topbar-nav">__PAGE_NAV__</nav>
  </header>

  <!-- Stats row -->
  <div class="bot-stats">
    <div class="stat-card">
      <div class="stat-label">Bots</div>
      <div class="stat-value accent" data-stat-bots>—</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Runtimes</div>
      <div class="stat-value green" data-stat-runtimes>—</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Executions</div>
      <div class="stat-value" data-stat-executions>—</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Success Rate</div>
      <div class="stat-value" data-stat-success>—</div>
    </div>
  </div>

  <!-- Two-panel workspace -->
  <div class="bot-workspace">
    <!-- Left: Metabot list -->
    <aside class="metabot-panel" aria-label="MetaBot list">
      <div class="metabot-panel-header">
        <span class="metabot-panel-title">MetaBots</span>
        <span class="metabot-panel-count" data-metabot-count>0</span>
      </div>
      <div class="metabot-list-scroll">
        <div data-metabot-list>
          <div class="session-empty">
            <p>No MetaBots yet</p>
            <p class="session-empty-hint">Click "Add MetaBot" to create one.</p>
          </div>
        </div>
      </div>
      <div class="metabot-panel-footer">
        <button class="btn btn-primary" data-act="add-metabot" style="width:100%">+ Add MetaBot</button>
      </div>
    </aside>

    <!-- Right: Detail panel -->
    <section class="detail-panel" aria-label="MetaBot detail">
      <!-- Tab bar (hidden when no selection) -->
      <div class="tab-bar" data-tab-bar style="display:none">
        <button class="tab-btn active" data-tab="info">Basic Info</button>
        <button class="tab-btn" data-tab="history">Execution History</button>
      </div>
      <!-- Tab content -->
      <div class="tab-content" data-tab-content style="display:none">
        <div class="tab-panel active" data-tab-panel="info">
          <div data-info-content></div>
        </div>
        <div class="tab-panel" data-tab-panel="history">
          <div data-history-content>
            <div class="table-wrap bot-table-scroll">
              <table class="data-table exec-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Provider</th>
                    <th>Runtime</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Prompt</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody data-execution-history-list></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <!-- Empty state -->
      <div class="detail-empty" data-detail-empty>
        <span class="mono">Select a MetaBot to manage</span>
        <span style="font-size:11px;color:var(--dim)">Click a bot from the left panel</span>
      </div>
    </section>
  </div>
</div>

<!-- Add MetaBot modal -->
<div class="modal-overlay hidden" data-modal="add-metabot">
  <div class="modal-box">
    <div class="modal-title">Add MetaBot</div>
    <div class="modal-body">
      <div class="field">
        <label>Name *</label>
        <input type="text" data-field="new-name" placeholder="My MetaBot" maxlength="60" />
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel-add">Cancel</button>
      <button class="btn btn-primary" data-act="confirm-add">Create</button>
    </div>
    <div class="save-status" data-add-status style="margin-top:8px"></div>
  </div>
</div>

<div class="copy-toast" data-copy-toast role="status" aria-live="polite"></div>
<script>__PAGE_SCRIPT__</script>
</body>
</html>
```

### 7.2 JavaScript 脚本逻辑

**文件**：`src/ui/pages/bot/app.ts`（完全重写）

`buildBotPageDefinition()` 返回 `LocalUiPageDefinition`，`script` 字段由 `buildBotPageScript()` 生成。

#### 全局状态

```javascript
var state = {
  profiles: [],        // MetabotProfileFull[]
  runtimes: [],        // LlmRuntime[]
  sessions: [],        // LlmSessionRecord[]
  stats: { bots: 0, runtimes: 0, executions: 0, successRate: 0 },
  selectedSlug: '',    // 当前选中的 slug
  selectedTab: 'info', // 当前 tab
  originalProfile: null // 编辑前的 profile（用于 diff）
};
```

#### 核心函数

1. **`api(url, opts)`** — fetch 封装，非 2xx 抛异常，否则返回 JSON
2. **`ago(t)` / `fmtTime(t)` / `esc(v)` / `pill(h)` / `statusPill(s)` / `shortText(v,n)` / `clampBlock(v)` / `duration(s)` / `resultSummary(s)`** — 复用现有 bot 页面的工具函数
3. **`loadAll()`** — 页面加载时并行调用 `loadStats()`, `loadProfiles()`, `loadRuntimes()`, `loadSessions()`
4. **`loadStats()`** — `GET /api/bot/stats` → 更新 4 个统计卡片（`data-stat-bots`, `data-stat-runtimes`, `data-stat-executions`, `data-stat-success`）
5. **`loadProfiles()`** — `GET /api/bot/profiles` → `renderMetabotList()`
6. **`renderMetabotList()`** — 遍历 `state.profiles`，生成 `.metabot-item` 元素：
   - 头像：如有 `avatarDataUrl` 则显示 `<img>`，否则显示默认 SVG 占位图标
   - 名字：`profile.name`
   - GlobalMetaID：截断显示前 12 位 + "..."
   - 复制按钮：点击复制完整 GlobalMetaID
   - 点击 item → `selectMetabot(slug)`
   - 如果 `slug === state.selectedSlug` → 添加 `.selected` class
7. **`selectMetabot(slug)`** — 选中 MetaBot：
   - `state.selectedSlug = slug`
   - `state.originalProfile = state.profiles.find(p => p.slug === slug)`
   - 高亮左侧列表项
   - 隐藏 `data-detail-empty`，显示 `data-tab-bar` 和 `data-tab-content`
   - 渲染当前 tab 内容
8. **`renderInfoTab()`** — 渲染基础信息表单：
   ```
   Avatar section:
     [72x72 头像预览] [Upload 按钮] [Remove 链接（条件显示）]
     <input type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif">
   
   GlobalMetaID:
     <code>完整 ID</code> [Copy 按钮]
   
   Form:
     Name:         [text input, 当前值预填]
     Role:         [textarea, ROLE.md 内容]
     Soul:         [textarea, SOUL.md 内容]
     Goal:         [textarea, GOAL.md 内容]
     Primary LLM:  [select, 选项为检测到的 runtimes, 当前值选中]
     Fallback LLM: [select, 选项为检测到的 runtimes + "(none)", 当前值选中]
   
   Save row:
     [Save Changes 按钮] [状态文本]
   ```
   - Provider dropdown：每个 option 显示 `PROVIDER_DISPLAY_NAMES[provider] — healthy/version`，value 为 provider ID
   - 只有 `health !== 'unavailable'` 的 runtime 出现在下拉中
   - Fallback 下拉额外有一个 `value=""` 的 "(none)" 选项
   - Avatar Upload：文件选择 → `FileReader.readAsDataURL()` → 验证 ≤ 200KB → 更新预览和 `state._pendingAvatar`
   - Avatar Remove：清空预览，设置 `state._pendingAvatar = ''`
9. **`renderHistoryTab()`** — 渲染执行历史表格：
   - 过滤 `state.sessions` 中 `metaBotSlug === state.selectedSlug` 的记录
   - 表格列：Time, Provider, Runtime, Status, Duration, Prompt, Details
   - Details 展开/折叠（复用现有 bot 页面的 `exec-detail` 模式）
   - 若无数据：显示 "No executions yet for this MetaBot"
10. **`saveInfo()`** — 保存基础信息：
    - 读取表单当前值
    - 对比 `state.originalProfile`，构建 changed fields 对象
    - 如果有变更：`PUT /api/bot/profiles/:slug` 发送变更字段
    - 显示 saving → success/error 状态
    - 成功后刷新 `state.originalProfile`，`loadProfiles()` 更新列表
11. **`handleAvatarUpload(file)`** — 处理头像上传
12. **`copyToClipboard(text)`** — 复制文本，显示 toast 1.5 秒
13. **`openAddModal()` / `closeAddModal()`** — 模态框显隐
14. **`createMetabot()`** — 创建 MetaBot：
    - 验证 name 非空
    - `POST /api/bot/profiles { name: xxx }`
    - 成功 → 关闭模态框、`loadProfiles()`、选中新 bot
    - 失败 → 显示错误信息
15. **`switchTab(tab)`** — Tab 切换：
    - 更新 `.tab-btn.active`
    - 更新 `.tab-panel.active`
    - 懒加载 history 内容
16. **`toggleExecDetail(id)`** — 展开/折叠执行历史详情行
17. **`discoverRuntimes()`** — `POST /api/bot/runtimes/discover`，然后 `loadRuntimes()`
18. **`loadSessions()`** — `GET /api/bot/sessions?limit=50` → 缓存到 state.sessions

#### 事件绑定（DOMContentLoaded）

```javascript
document.addEventListener('DOMContentLoaded', function() {
  loadAll();
  // Add metabot modal
  q('[data-act="add-metabot"]').addEventListener('click', openAddModal);
  q('[data-act="cancel-add"]').addEventListener('click', closeAddModal);
  q('[data-act="confirm-add"]').addEventListener('click', createMetabot);
  // Tab switching
  qq('[data-tab]').forEach(function(el) {
    el.addEventListener('click', function() { switchTab(this.getAttribute('data-tab')); });
  });
  // Auto-refresh every 15s
  setInterval(function() { loadStats(); loadSessions(); }, 15000);
});
```

#### 脚本生成

```typescript
export function buildBotPageDefinition(): LocalUiPageDefinition {
  return {
    page: 'bot',
    title: 'Bot Management — Open Agent Connect',
    eyebrow: 'MetaBot Management',
    heading: 'Bot Management',
    description: 'Manage MetaBots, LLM providers, and execution history.',
    panels: [],
    script: buildBotPageScript(),
  };
}
```

`buildBotPageScript()` 使用与现有 `app.ts` 相同的字符串拼接模式（`"var q=..." + "var qq=..." + ...`），将所有 JS 逻辑内联为一个字符串。

---

## 8. Chain Sync 集成

### 8.1 同步时机

- **创建 MetaBot**：不同步上链（仅本地创建）
- **修改 MetaBot 信息**：如果有 globalMetaId（已上链），先同步上链，再保存本地

### 8.2 同步逻辑

```typescript
// 在 defaultHandlers.ts 的 updateProfile handler 中

// 1. 计算变更字段
const changedFields: string[] = [];
if (input.name !== undefined && input.name !== current.name) changedFields.push('name');
if (input.role !== undefined && input.role !== current.role) changedFields.push('role');
if (input.soul !== undefined && input.soul !== current.soul) changedFields.push('soul');
if (input.goal !== undefined && input.goal !== current.goal) changedFields.push('goal');
if (input.avatarDataUrl !== undefined && input.avatarDataUrl !== current.avatarDataUrl) changedFields.push('avatar');
if (input.primaryProvider !== undefined && input.primaryProvider !== current.primaryProvider) changedFields.push('primaryProvider');
if (input.fallbackProvider !== undefined && input.fallbackProvider !== current.fallbackProvider) changedFields.push('fallbackProvider');

// 2. 如果有变更且已上链 → 先同步上链
if (changedFields.length > 0 && current.globalMetaId) {
  try {
    await syncMetabotInfoToChain(signer, {
      ...current,
      ...input,  // 使用新值
    }, changedFields);
  } catch (err) {
    return commandFailed('chain_sync_failed', `Chain sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// 3. 保存本地
const updated = await updateMetabotProfile(normalizedSystemHomeDir, slug, updateInput);
return commandSuccess({ profile: updated });
```

### 8.3 Signer 获取

在 `defaultHandlers.ts` 中，已经通过 `createLocalMnemonicSigner({ secretStore })` 创建了 signer。`bot.updateProfile` handler 需要通过闭包访问该 signer。

### 8.4 关键约束

- **Chain-first**：链同步必须在本地保存之前，如果链同步失败则不保存本地
- **3 秒延迟**：多 pin 之间需要 `await new Promise(r => setTimeout(r, 3000))` 避免 mempool 冲突
- **无 globalMetaId 时跳过**：未上链的 MetaBot 只更新本地文件，不报错

---

## 9. 实施计划（分阶段）

### Phase 1：Provider 扩展 + MetaBot Manager（预计 0.5 天）

**文件**：
- `src/core/llm/llmTypes.ts` — 扩展 provider 类型
- `src/core/llm/llmRuntimeDiscovery.ts` — 扩展检测逻辑
- `src/core/bot/metabotProfileManager.ts` — 新建业务逻辑模块

**提交点**：
1. 扩展 provider 类型和检测 → commit
2. 创建 metabotProfileManager → commit

### Phase 2：API 层（预计 0.5 天）

**文件**：
- `src/daemon/routes/types.ts` — 新增 bot handler 类型
- `src/daemon/routes/bot.ts` — 新建路由
- `src/daemon/defaultHandlers.ts` — 注册 handler 实现
- `src/daemon/httpServer.ts` — 注册路由

**提交点**：
1. 新增类型定义 → commit
2. 实现路由 + handler → commit

### Phase 3：UI 重写（预计 1 天）

**文件**：
- `src/ui/pages/bot/index.html` — 完全重写
- `src/ui/pages/bot/app.ts` — 完全重写

**提交点**：
1. HTML + CSS 模板 → commit
2. JS 脚本逻辑 → commit
3. 联调修复 → commit(s)

### Phase 4：测试与验收（预计 0.5 天）

- 启动 daemon → 打开 `/ui/bot` → 逐项验收
- 修复发现的问题 → commit(s)
- 每个 phase 完成后启动 subagent review

---

## 10. 验收标准

### 10.1 统计卡片验收

| # | 验收项 | 验证方法 | 预期结果 |
|---|--------|---------|---------|
| 1 | BOTS 数量正确 | 打开 `/ui/bot`，观察 BOTS 卡片 | 数字等于 `~/.metabot/profiles/` 下的 profile 数量 |
| 2 | RUNTIMES 数量正确 | 观察 RUNTIMES 卡片 | 数字等于 health==='healthy' 的 runtime 数量 |
| 3 | EXECUTION 数量正确 | 观察 EXECUTIONS 卡片 | 数字等于 `~/.metabot/LLM/executor/sessions/` 下的 session 数量 |
| 4 | SUCCESS RATE 正确 | 观察 SUCCESS RATE 卡片 | 显示为百分比，completed / total × 100 |
| 5 | 15 秒自动刷新 | 等待 15 秒后查看网络请求 | 重新请求 `/api/bot/stats` 和 `/api/bot/sessions` |

### 10.2 MetaBot 列表验收

| # | 验收项 | 验证方法 | 预期结果 |
|---|--------|---------|---------|
| 6 | 列表展示所有 MetaBot | 打开页面，查看左侧列表 | 列出所有 profile，每项有头像、名字、GlobalMetaID 截断 |
| 7 | 头像显示 | 查看有头像和无头像的 bot | 有头像显示图片，无头像显示默认占位图标 |
| 8 | 复制 GlobalMetaID | 点击复制 icon | 完整 GlobalMetaID 被复制到剪贴板，toast 提示 "Copied!" |
| 9 | 选中高亮 | 点击某个 bot | 该 bot 左侧出现蓝色边框（`.selected`），右侧显示详情 |
| 10 | 添加按钮可见 | 查看左下角 | "+ Add MetaBot" 按钮始终可见 |

### 10.3 基础信息 Tab 验收

| # | 验收项 | 验证方法 | 预期结果 |
|---|--------|---------|---------|
| 11 | 名字可编辑 | 修改名字 → 点击 Save | 名字被更新，ROLE.md/SOUL.md/GOAL.md 不变 |
| 12 | 头像上传 | 点击 Upload → 选择 < 200KB 图片 | 头像预览更新，Save 后持久化 |
| 13 | 头像大小限制 | 选择 > 200KB 图片 | 显示错误提示，不上传 |
| 14 | 头像移除 | 点击 Remove → Save | 头像被清除 |
| 15 | 角色文本可编辑 | 修改 Role 文本 → Save | ROLE.md 内容被更新 |
| 16 | 灵魂文本可编辑 | 修改 Soul 文本 → Save | SOUL.md 内容被更新 |
| 17 | 目标文本可编辑 | 修改 Goal 文本 → Save | GOAL.md 内容被更新 |
| 18 | Primary Provider 下拉 | 查看下拉选项 | 仅显示健康（healthy/degraded）的 runtime，显示 provider 名称和状态 |
| 19 | Fallback Provider 下拉 | 查看下拉选项 | 额外包含 "(none)" 选项 |
| 20 | Provider 下拉保存 | 修改 provider → Save | llmbindings.json 中对应 binding 更新 |
| 21 | Save 成功状态 | 修改任何字段 → Save | 显示绿色 "✓ Saved" 状态 |
| 22 | Save 后刷新 | Save 成功后 | 左侧列表更新名字/头像，stats 数据未变 |
| 23 | GlobalMetaID 显示 | 选中 bot 后查看 | 完整 ID 以 `<code>` 格式显示，旁边有 Copy 按钮 |

### 10.4 执行历史 Tab 验收

| # | 验收项 | 验证方法 | 预期结果 |
|---|--------|---------|---------|
| 24 | 历史仅显示当前 bot | 选中 bot A → 切换到 History tab | 仅显示 `metaBotSlug === botA.slug` 的 session |
| 25 | 切换 bot 后历史更新 | 选中 bot B | 历史列表更新为 bot B 的执行记录 |
| 26 | 表格列完整 | 查看表格 | Time, Provider, Runtime, Status, Duration, Prompt, Details |
| 27 | 详情展开/折叠 | 点击 Details 按钮 | 展开显示 Session ID、Output/Error、Full Prompt、Runtime |
| 28 | 无记录提示 | 选中没有执行历史的 bot | 显示 "No executions yet for this MetaBot" |
| 29 | 状态颜色 | 查看不同状态的记录 | completed=绿, failed/timeout/cancelled=红, running/starting=活动状态 |

### 10.5 添加 MetaBot 验收

| # | 验收项 | 验证方法 | 预期结果 |
|---|--------|---------|---------|
| 30 | 模态框打开 | 点击 "+ Add MetaBot" | 居中显示添加模态框 |
| 31 | Name 必填验证 | 不填名字 → 点击 Create | 提示 name 为必填项（或按钮不响应） |
| 32 | 创建成功 | 输入唯一名字 → Create | 模态框关闭，列表刷新，新 bot 出现并被选中 |
| 33 | 重复名字检测 | 输入已有名字 → Create | 显示错误提示 "Name already exists" |
| 34 | 创建后默认文件 | 查看新建 profile 目录 | ROLE.md、SOUL.md、GOAL.md 均存在且有默认内容 |
| 35 | 取消创建 | 打开模态框 → Cancel | 模态框关闭，无新 profile 创建 |

### 10.6 Provider 扩展验收

| # | 验收项 | 验证方法 | 预期结果 |
|---|--------|---------|---------|
| 36 | 发现 Claude Code | PATH 中有 `claude` | runtime 列表包含 claude-code |
| 37 | 发现 Codex | PATH 中有 `codex` | runtime 列表包含 codex |
| 38 | 发现 Copilot | PATH 中有 `gh` | runtime 列表包含 copilot |
| 39 | 其他 provider | PATH 有其他二进制 | 对应的 runtime 出现在列表中 |
| 40 | 不可用 provider 不显示 | 在 Provider 下拉中 | 仅健康（healthy/degraded）的 runtime 出现在下拉选项 |
| 41 | Discover 触发 | 在页面中触发 discover（如有按钮） | 新 runtime 出现在列表 |

### 10.7 UI 移除项验收

| # | 验收项 | 验证方法 | 预期结果 |
|---|--------|---------|---------|
| 42 | 无 Profile 选择器 | 查看页面 | 不出现 profile 下拉选择器 |
| 43 | 无 Bindings 表格 | 查看页面 | 不出现 bindings 表格 |
| 44 | 无 reviewer/specialist | 查看页面全文 | 文本中不包含 reviewer、specialist 概念 |
| 45 | 无 Priority 输入 | 查看页面 | 不出现 priority 输入框 |
| 46 | 无 Preferred Runtime | 查看页面 | 不出现 preferred runtime 区域 |

### 10.8 Chain Sync 验收

| # | 验收项 | 验证方法 | 预期结果 |
|---|--------|---------|---------|
| 47 | 已上链 bot 修改触发 chain sync | 修改有 globalMetaId 的 bot → Save | 先写 pin 上链，再保存本地 |
| 48 | Chain sync 失败不保存 | 模拟 chain sync 失败 | 返回错误，本地文件内容不变 |
| 49 | 未上链 bot 修改仅本地保存 | 修改无 globalMetaId 的 bot → Save | 直接保存本地，不尝试写链 |

### 10.9 响应式与 UI 细节验收

| # | 验收项 | 验证方法 | 预期结果 |
|---|--------|---------|---------|
| 50 | 移动端布局 | 浏览器宽度 < 768px | 左右面板堆叠，左侧最大高度 220px |
| 51 | Toast 提示 | 复制 GlobalMetaID | 右下角出现 "Copied!" toast，1.5 秒后消失 |
| 52 | Tab 切换流畅 | 切换 "Basic Info" 和 "Execution History" | 内容即时切换，无闪烁 |
| 53 | 页面导航 | 点击 Nav 中的 Hub/Trace | 正常跳转到对应页面 |

---

## 11. 附录：参考实现

### 11.1 关键参考文件

| 参考 | 文件路径 | 用途 |
|------|---------|------|
| 当前 bot 页面 | `src/ui/pages/bot/app.ts` | 工具函数复用（ago, fmtTime, esc, pill, statusPill 等） |
| 当前 bot 页面 | `src/ui/pages/bot/index.html` | 执行历史表格 CSS 复用 |
| Trace 页面 | `src/ui/pages/trace/index.html` | 左右布局 CSS 参照 |
| Trace 页面 | `src/ui/pages/trace/app.ts` | 页面定义模式 |
| LLM 路由 | `src/daemon/routes/llm.ts` | 路由 handler 模式 |
| Identity 路由 | `src/daemon/routes/identity.ts` | profile CRUD 端点模式 |
| Default handlers | `src/daemon/defaultHandlers.ts` | handler 注册 + signer 创建 |
| LLM types | `src/core/llm/llmTypes.ts` | 类型定义模式 |
| Runtime discovery | `src/core/llm/llmRuntimeDiscovery.ts` | provider 检测逻辑 |
| Chain write | `src/core/chain/writePin.ts` | ChainWriteRequest/Result 类型 |
| Signer | `src/core/signing/signer.ts` | Signer 接口 |
| Local signer | `src/core/signing/localMnemonicSigner.ts` | writePin 实现 |
| Identity profiles | `src/core/identity/identityProfiles.ts` | IdentityProfileRecord + CRUD |
| Paths | `src/core/state/paths.ts` | resolveMetabotPaths (soulMdPath, goalMdPath, roleMdPath) |
| HTTP server | `src/daemon/httpServer.ts` | 路由注册 |
| Route types | `src/daemon/routes/types.ts` | MetabotDaemonHttpHandlers 接口 |
| Multica agents | `multica/server/pkg/agent/agent.go` | 11-agent provider 列表 |
| IDBots sync | `IDBots/src/main/services/metaidCore.ts` | chain sync 参考逻辑 |
| IDBots types | `IDBots/src/main/types/metabot.ts` | MetaBot 数据模型参考 |
| Shared CSS | `src/ui/shared.css` | 设计系统 tokens |

### 11.2 设计决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| Avatar 存储位置 | `~/.metabot/profiles/<slug>/avatar.txt` | 与 profile 目录同层，简单文本文件 |
| Avatar 大小限制 | 200KB（~150KB 图片） | 与 IDBots 一致，data URL 约 33% 膨胀 |
| 创建时 chain sync | 不触发 | 简化首次创建流程，首次编辑时再上链 |
| 编辑时 chain sync | 先链后本地 | 链为 Single Source of Truth |
| Provider 下拉显示 | 仅健康 runtime | 避免用户选择不可用的 provider |
| Provider 检测 | PATH 扫描 + `--version` | 与现有逻辑一致，通用性最好 |
| Binding 内部保留 | role=primary/fallback，priority=0 | 保持内部数据结构兼容，UI 不暴露 |
| MetaBot 列表宽度 | 300px | 略宽于 trace 页面的 280px（需要显示 GlobalMetaID） |

### 11.3 开发注意事项

1. **编码**：所有文件读写使用 UTF-8
2. **文件不存在**：`ROLE.md`/`SOUL.md`/`GOAL.md` 不存在时返回空字符串 `""`
3. **avatar.txt 不存在**：`avatarDataUrl` 为 `undefined`
4. **并发编辑**：不做锁处理，最后保存者胜出
5. **TypeScript strict mode**：所有新代码需通过 strict 类型检查
6. **commit 规范**：每次独立可验证的改动一个 commit
7. **每轮开发完毕**：启动 subagent 根据本文档验收条款 review 代码和功能

---

> **文档版本**：v1.0
> **创建日期**：2026-05-06
> **目标项目**：open-agent-connect
