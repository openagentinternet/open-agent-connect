# Master Service 发布与发现设计说明

**日期：** 2026-04-17

## 1. 文档目标

本文档是基于总纲文档 [2026-04-17-metaweb-ask-master-design.zh-CN.md](/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/superpowers/specs/2026-04-17-metaweb-ask-master-design.zh-CN.md) 的第一份子模块细化 spec。

本文档只解决两个问题：

- 如何发布 `master-service`
- 如何发现 `master-service`

本文档**不处理**：

- `simplemsg` 下的 `master_request / master_response`
- `Master Invocation Engine`
- 自动/半自动触发
- Ask Master 的上下文打包
- Ask Master 的 trace 细节

这份 spec 的设计目标是：

- 尽量复用现有 `skill-service` 的底层技术框架
- 但在产品语义、协议路径、字段模型、CLI 命令上与 `skill-service` 分开
- 让 V1 可以用尽量轻的方式先跑通官方与半官方 `master-service` 的发布与发现

---

## 2. 设计原则

### 2.1 独立协议族

`master-service` 必须是独立协议族，而不是挂在 `skill-service` 下面靠 metadata 区分。

也就是说：

- `skill-service` 继续服务原有远端技能目录
- `master-service` 单独承载 Master 的发布与发现

### 2.2 复用底层框架

应尽量复用现有 `skill-service` 这套技术骨架：

- 链上 pin 写入方式
- 本地 state store
- daemon publish handler
- network directory list handler
- provider presence / online 状态判定
- 本地 CLI 组织方式
- UI/console 后续可共用的展现骨架

### 2.3 产品入口独立

虽然底层可复用，但入口必须独立：

- `metabot services publish` 不应该兼容发布 `master-service`
- `metabot network services` 不应该继续作为 Master 列表的主入口

应有单独命令族：

```bash
metabot master publish --payload-file master-service.json
metabot master list
```

### 2.4 V1 先走模板发布

V1 为了快速可用，不要求先做复杂发布台。

应优先支持：

- JSON 模板
- CLI 发布
- 本地 Agent / skill 协助填写与提交

---

## 3. 与 skill-service 的关系

### 3.1 可直接借鉴的部分

当前仓库中，`skill-service` 已具备如下可直接借鉴的框架：

- `src/core/services/publishService.ts`
  - service draft 归一化
  - payload / record 生成
- `src/core/services/servicePublishChain.ts`
  - 链上发布请求构造
  - pin 写入后的 record 回填
- `src/core/discovery/chainServiceDirectory.ts`
  - 链上目录项解析
  - create / modify / revoke 语义归并
- `src/core/discovery/chainDirectoryReader.ts`
  - 目录分页读取
  - fallback 逻辑
  - onlineOnly 装饰
- `src/core/discovery/chainHeartbeatDirectory.ts`
  - 基于 heartbeat 的在线判定
- `src/cli/commands/services.ts`
  - payload-file 模式的 publish CLI 组织
- `src/daemon/routes/services.ts`
  - daemon 侧 publish 路由入口
- `src/daemon/defaultHandlers.ts`
  - 运行时 `services.publish` 与 `network.listServices`

### 3.2 不能直接沿用的部分

以下内容不应直接复用，而应在 `master-service` 中独立：

- 协议路径 `/protocols/skill-service`
- `providerSkill` 作为主标识
- 普通技能服务的目录字段集合
- `metabot services publish`
- `metabot network services`

### 3.3 设计策略

推荐策略是：

- 复制 `skill-service` 的发布/发现框架模式
- 提取可以共用的工具函数或抽象层
- 让 `master-service` 拥有自己的：
  - protocol path
  - payload schema
  - CLI
  - discovery parser

---

## 4. 协议路径

建议新增独立协议路径：

```text
/protocols/master-service
```

V1 下：

- 所有 `master-service` 的链上发布都写入该路径
- discovery 目录只从该路径读取

这意味着：

- `skill-service` 和 `master-service` 在链上天然分流
- 列表层面不需要再靠混合目录后二次过滤来区分

---

## 5. 发布模型

### 5.1 发布对象

`master-service` 代表一个可被 Ask Master 机制发现、匹配和调用的 Master 能力声明。

它不是 skill 的简单映射，而是一个高层协作角色。

### 5.2 最小发布字段

V1 建议最小字段如下：

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

### 5.3 字段语义

建议字段语义如下：

- `serviceName`
  - 链上稳定服务名
- `displayName`
  - 面向用户显示名称
- `description`
  - 简要说明这个 Master 擅长什么
- `masterKind`
  - 一级类别，例如：
    - `debug`
    - `architecture`
    - `review`
    - `general`
- `specialties`
  - 更细的能力标签
- `hostModes`
  - 支持的 host 列表
- `modelInfo`
  - 模型/提供方信息
- `style`
  - 输出风格
- `pricingMode`
  - 例如：
    - `free`
    - `fixed`
- `price`
  - 字符串金额
- `currency`
  - 初期与现有框架保持兼容
- `responseMode`
  - V1 推荐默认 `structured`
- `contextPolicy`
  - 推荐上下文层级，例如：
    - `compact`
    - `standard`
    - `full_task`
- `official`
  - 是否官方
- `trustedTier`
  - 信任等级，例如：
    - `official`
    - `trusted`
    - `community`

### 5.4 V1 不建议加入的字段

V1 不建议一上来引入过于复杂的字段，例如：

- 复杂多模型路由规则
- 动态报价规则
- 声誉权重
- 多轮对话策略
- 远端执行权限声明

这些会拖慢第一轮落地。

---

## 6. 发布链路

### 6.1 用户操作方式

V1 推荐的发布链路：

1. 用户或本地 Agent 准备 `master-service.json`
2. 调用：

```bash
metabot master publish --payload-file master-service.json
```

3. CLI 读取文件并做本地校验
4. daemon publish handler 写入链上 `/protocols/master-service`
5. 本地 runtime state 记录已发布 master
6. 返回链上 pin、基础元数据和发布结果

### 6.2 CLI 设计

新增命令：

```bash
metabot master publish --payload-file master-service.json
```

行为应与 `services publish --payload-file ...` 类似：

- 强制 `--payload-file`
- 支持链参数（若仓库已有统一 `--chain` 模式，可复用）
- 输出 machine-readable JSON

### 6.3 daemon 路由

可选实现方式有两种：

#### 方案 A：独立 master 路由

- 新增 `/api/master/publish`
- 新增 master handler

#### 方案 B：通用服务族路由抽象

- 在现有服务发布框架上抽象 family
- `skill-service` 和 `master-service` 分别挂接

从 V1 速度考虑，我更建议：

- **先做独立 `master` 路由**

这样更清楚，也更不容易与旧 `services` 语义混淆。

### 6.4 本地状态持久化

`master-service` 发布成功后，本地应持久化一份 `PublishedMasterRecord`。

其职责类似现有 `PublishedServiceRecord`，但字段应独立。

建议记录：

- `id`
- `sourceMasterPinId`
- `currentPinId`
- `creatorMetabotId`
- `providerGlobalMetaId`
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
- `payloadJson`
- `available`
- `revokedAt`
- `updatedAt`

---

## 7. 发现模型

### 7.1 发现入口

V1 应提供独立发现命令：

```bash
metabot master list
```

它不应复用 `metabot network services` 作为用户主入口。

### 7.2 数据来源

发现应优先读取链上 `/protocols/master-service`。

与 `skill-service` 一样，保留：

- 链上分页读取
- 本地 fallback / seeded overlay 的技术能力
- onlineOnly 过滤能力

### 7.3 在线状态

`master-service` 的在线状态判定，建议继续复用现有 heartbeat 体系：

- 通过 `/protocols/metabot-heartbeat`
- 基于 provider address 最近心跳时间判断

这意味着：

- 发布与在线是两件不同的事
- `master list` 应能展示：
  - 已发布但离线
  - 已发布且在线

### 7.4 目录展示字段

`metabot master list` 建议返回：

- `masterPinId`
- `sourceMasterPinId`
- `providerGlobalMetaId`
- `providerAddress`
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
- `online`
- `updatedAt`

### 7.5 过滤规则

V1 至少支持这些过滤维度：

- `online`
- `host`
- `masterKind`
- `official`

例如：

- 当前 host 只看兼容条目
- Ask Master 的 selector 只看在线条目

CLI 是否一开始直接暴露所有筛选参数可以稍后决定，但运行时内部需要具备这些过滤能力。

---

## 8. 数据结构建议

### 8.1 发布 draft

建议新增：

```ts
interface PublishedMasterDraft {
  serviceName: string;
  displayName: string;
  description: string;
  masterKind: string;
  specialties: string[];
  hostModes: string[];
  modelInfo: Record<string, unknown> | null;
  style: string | null;
  pricingMode: string | null;
  price: string;
  currency: string;
  responseMode: string | null;
  contextPolicy: string | null;
  official: boolean;
  trustedTier: string | null;
}
```

### 8.2 发布 record

建议新增：

```ts
interface PublishedMasterRecord {
  id: string;
  sourceMasterPinId: string;
  currentPinId: string;
  creatorMetabotId: number;
  providerGlobalMetaId: string;
  serviceName: string;
  displayName: string;
  description: string;
  masterKind: string;
  specialties: string[];
  hostModes: string[];
  modelInfo: string | null;
  style: string | null;
  pricingMode: string | null;
  price: string;
  currency: string;
  responseMode: string | null;
  contextPolicy: string | null;
  official: 0 | 1;
  trustedTier: string | null;
  payloadJson: string;
  available: 0 | 1;
  revokedAt: number | null;
  updatedAt: number;
}
```

### 8.3 目录项

链上目录返回后，建议解析成：

```ts
interface ChainMasterDirectoryItem {
  masterPinId: string;
  sourceMasterPinId: string;
  chainPinIds: string[];
  providerGlobalMetaId: string;
  providerMetaId: string;
  providerAddress: string;
  serviceName: string;
  displayName: string;
  description: string;
  masterKind: string;
  specialties: string[];
  hostModes: string[];
  modelInfo: Record<string, unknown> | null;
  style: string | null;
  pricingMode: string | null;
  price: string;
  currency: string;
  responseMode: string | null;
  contextPolicy: string | null;
  official: boolean;
  trustedTier: string | null;
  available: boolean;
  online: boolean;
  updatedAt: number;
}
```

---

## 9. 与 skill-service 的实现关系

### 9.1 推荐做法

在实现层面，我建议采用：

- `publishService` / `servicePublishChain` 的思路平移一份 `publishMaster` / `masterPublishChain`
- `chainServiceDirectory` 的思路平移一份 `chainMasterDirectory`
- CLI 新增独立 `master.ts`
- daemon 新增独立 `routes/master.ts`

### 9.2 不推荐做法

不推荐：

- 直接在现有 `skill-service` payload 里塞 `masterKind`
- 再靠 `network services` 做二次过滤

因为这样会在产品语义与代码结构上继续混淆两套系统。

---

## 10. V1 发布 JSON 模板

建议仓库直接提供一个模板文件，例如：

```text
templates/master-service/debug-master.template.json
```

这样用户或本地 Agent 可以：

- 拷贝模板
- 填写字段
- 直接 publish

V1 推荐至少提供：

- Debug Master 模板
- Architecture Master 模板
- Review Master 模板

### 10.1 模板要求

模板要做到：

- 字段少
- 说明清楚
- 默认值合理
- 不鼓励营销话术
- 易被本地 Agent 自动生成或补全

---

## 11. 测试与验收

根据总纲约定，这个模块后续实现时应遵守：

- 模块尽量解耦
- 测试驱动开发
- 完成后必须由精通测试的 subagent 做 review 与验收

### 11.1 单元测试建议

至少覆盖：

- `master-service` draft 校验
- 发布 payload 生成
- 发布链上 path 正确为 `/protocols/master-service`
- 发布后 record 正确回填 `currentPinId / sourceMasterPinId`
- 目录页解析
- `create / modify / revoke` 归并
- 在线状态过滤
- host / masterKind / official 过滤

### 11.2 CLI 测试建议

至少覆盖：

- `metabot master publish --payload-file ...`
- `metabot master list`
- payload 缺字段时失败
- 发布成功后本地 list 可见
- onlineOnly 下离线 master 被过滤

### 11.3 集成测试建议

至少覆盖：

- 本地 provider 发布一个 `master-service`
- caller 侧通过 `master list` 发现它
- 与 `skill-service` 并存时，两个目录互不污染

---

## 12. V1 范围

这一模块的 V1 应做到：

- 独立 `/protocols/master-service`
- 独立发布 payload schema
- 独立本地 record
- 独立 `master publish`
- 独立 `master list`
- 可复用当前 heartbeat 在线判定
- 可通过 JSON 模板轻量发布

这一模块的 V1 暂不强求：

- 完整发布 UI
- 高级筛选器 UI
- 复杂信任图谱
- 自动推荐排序算法

---

## 13. 实现建议总结

一句话总结：

> `master-service` 的发布与发现，在技术实现上应当尽量平移并抽象现有 `skill-service` 的链上发布、目录读取和在线状态框架，但必须在协议路径、字段模型、CLI 入口和产品语义上独立出来，V1 先通过 JSON 模板 + `metabot master publish/list` 跑通一条最轻量、可测试、可演进的闭环。
