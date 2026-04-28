## 后续记录规则

用户要求：以后只要用户在 DeepWork 开发过程中提到"问题"、错误、致命错误、误解、边界不清或工作流跑偏，都需要把问题写进本文档，并同时写入解决方案或正确工作方式，方便另一个 Agent 读取后继续处理。

记录格式建议：每个问题新增一个二级标题，包含"问题现象"、"正确理解"、"解决方案"、"给其他 Agent 的指令"。如果问题已经存在，则更新原有章节，不要重复写散乱记录。

---

## ✅ 已解决：Agent 误把 DeepWork 面板当成目标项目

### 问题现象

`deepwork connect WEB001 --name openclaw --url http://localhost:3000` 中，OpenClaw 把 `--url http://localhost:3000` 误解为"要修改的目标代码库"，开始分析 DeepWork 面板自身的 `page.tsx`，而不是用户指定的业务项目（如 `lumioi-website/index.html`）。

### 正确理解

`--url` 只是 DeepWork 面板/API 地址，Agent 用它同步需求和结果。实际工作目录由用户明确提供，与 DeepWork 仓库无关。

### 解决方案（已实施）

1. **CLI**：`deepwork connect` 成功后输出明确警告（`src/cli/index.ts` 第 201-202 行）：
   ```
   注意：deepwork connect 只把当前 Agent 接入任务面板。
   Agent 应在目标项目目录中工作，用 deepwork push/result/work 同步需求和结果；不要把面板服务所在的 DeepWork 仓库当成要修改的目标项目。
   ```
2. **面板弹窗**：AgentConnectModal 的 CLI 和 API 两个标签均已加入红色警示框，提示 Agent 不要修改 DeepWork 面板自身。

### 给其他 Agent 的指令

接入面板后：不要把 `--url` 指向的地址当成要改的目标项目；用户提到的业务路径/HTML/素材才是目标上下文；没有目标路径时先询问，不要默认修改 DeepWork 仓库。

---

## ✅ 已解决：面板显示 Agent 已接入但任务一直等待提交

### 问题现象

面板显示 openclaw 已在线（`CLI Agent`），需求提交后右侧始终显示"等待 Agent 提交成品…"，进度条按生成时序推进，但实际上没有 worker 在运行，用户误以为已经在自动处理。

### 正确理解

`deepwork connect` 只注册了 Agent 身份，不会自动开始处理任务。真正执行需要：运行 `deepwork work`；手动 `deepwork result`；或打开网页 worker `/project/WEB001/work`。

### 解决方案（已实施）

1. **面板 generating 区块**：当有 Agent 在线但无 `agent_ping` 活动且已等待 >30 秒时，显示黄色提示框：
   > ⚠️ Agent 已接入，但还没有 worker 在运行。请在 OpenClaw / Claude Code 中执行：`deepwork work`

2. **Agent 接入弹窗**：`deepwork work` 说明改为"启动自动处理；不运行它任务不会自动交付"。

3. **Multica 备援**：45 秒内仍无 agent 活动时，自动触发 `/api/multica-fallback` 生成 HTML，结果写入 `synthesis_results`，面板通过 Realtime 实时更新。

### 给其他 Agent 的指令

面板卡在"等待 Agent 提交成品"时，不要先判断数据库故障。先检查：`deepwork status` → `deepwork next` → `deepwork work`。只运行了 `deepwork connect` 是不够的。

---

## ✅ 已解决：日间模式下接入 Agent 弹窗文字看不清

### 问题现象

日间模式下，AgentConnectModal 弹窗背景使用 `var(--c-overlay)` = `rgba(0,0,0,0.03)`，近乎透明。与深色遮罩（`rgba(0,0,0,0.75)`）叠加后，弹窗内容背景显得偏暗，但文字颜色是日间浅灰（`var(--c-text-4)` = `#475569`），对比度不足，警示框文字和步骤说明均难以辨认。

### 解决方案（已实施）

1. **弹窗主体背景**：从 `var(--c-overlay)` 改为 `var(--c-surface)`（日间 `#f8f9fa`，深色 `#1a1916`），弹窗在任何模式下均为不透明实色背景。
2. **红色警示框文字**：从 `var(--c-text-4)` 改为固定 `#b91c1c`（深红），日间深色均清晰可读。
3. **蓝色提示框文字**：从 `var(--c-text-4)` 改为固定 `#1d4ed8`（深蓝），同理。

### 给其他 Agent 的指令

如需再调整 AgentConnectModal 样式，查看 `src/app/project/[id]/page.tsx` 约第 199 行的 `AgentConnectModal`。不要改业务逻辑，只调整颜色。修改后请在日间/深色两种模式下分别验证弹窗可读性。

---

## 问题：DeepWork 当前无法启动，next.config.js 与 type: module 冲突

### 问题现象

用户准备完整跑一遍 DeepWork 时，执行 `npm run dev` 后服务没有启动，3000 端口没有监听。日志显示：

```text
> dwcosmo@0.1.0 dev
> next dev

file:///sessions/sweet-funny-allen/mnt/deepwork/next.config.js:4
module.exports = nextConfig
^

ReferenceError: module is not defined in ES module scope
This file is being treated as an ES module because it has a '.js' file extension and package.json contains "type": "module". To treat it as a CommonJS script, rename it to use the '.cjs' file extension.
```

当前 `package.json` 设置了：

```json
"type": "module"
```

但 `next.config.js` 仍然使用 CommonJS 写法：

```js
module.exports = nextConfig
```

因此 Next.js 在 Node 22 / ESM 模式下加载配置失败，导致 DeepWork 面板无法启动，后续面板提需求、Agent 接入、worker 监听都无法继续验证。

### 正确理解

这是启动配置错误，不是 Supabase、Realtime、Agent worker 或需求流转本身的问题。当前第一阻塞点是 Next.js 配置文件模块格式与项目 ESM 设置不一致。

因为项目已经把 `package.json` 设为 `type: module`，`.js` 文件会按 ESM 解析；此时不能再使用 `module.exports`。要么把配置文件改成 ESM export，要么把配置文件重命名为 `.cjs` 继续使用 CommonJS。

### 解决方案

推荐二选一：

```text
方案 A：保留 next.config.js，改成 ESM 写法

/** @type {import('next').NextConfig} */
const nextConfig = {}

export default nextConfig
```

或者：

```text
方案 B：把 next.config.js 改名为 next.config.cjs，保留 module.exports
```

当前项目既然已经为了 CLI 使用 `type: module`，更建议采用方案 A，保持配置文件和项目模块系统一致。

修复后重新执行：

```bash
npm run dev
```

确认出现类似以下日志，并且 3000 端口开始监听：

```text
Ready - started server on 0.0.0.0:3000
```

然后再继续验证：进入 DeepWork 面板、提交需求、检查其他用户是否可见、检查 `deepwork work` 是否能收到面板用户提交的信息。

### 给其他 Agent 的指令

如果你接手运行 DeepWork / DeepLoop，先不要排查业务代码。先修 `next.config.js` 的模块格式问题，否则面板根本无法启动。

检查顺序：

```bash
cat package.json | grep '"type"'
cat next.config.js
npm run dev
```

如果看到 `type: module` + `module.exports`，就把 `next.config.js` 改为 `export default nextConfig`，或重命名为 `next.config.cjs`。修复启动后，再继续监听用户提需求、Agent 接入、worker 接收需求等工作流问题。

### 复测记录（2026-04-28）

再次检查 CLI 和服务跑通情况时，问题仍然存在：

```text
package.json 当前版本是 0.1.2，bin 已改为 deeploop -> dist/cli.js，scripts 里也有 deeploop。
源码 CLI 可运行：npm run deeploop 能正常显示 DeepLoop CLI 帮助。
源码 CLI config 可运行：npm run deeploop -- config 能正常显示配置文件路径和当前项目状态。
但 dist/cli.js 仍显示 DeepWork CLI / deepwork 命令文案，和 package.json 的 deeploop bin 不一致。
npm run dev 仍然失败，3000 端口没有监听，根因仍是 next.config.js 使用 module.exports 与 package.json type: module 冲突。
```

新增需要注意的问题：CLI 源码和打包产物 `dist/cli.js` 的命名不同步。开发脚本 `npm run deeploop` 使用 `src/cli/index.ts`，显示 DeepLoop；但实际 npm bin 指向 `dist/cli.js`，它仍显示 DeepWork/deepwork，说明改名后没有重新构建或 dist 产物不是最新。发布或全局安装前必须重新生成 dist，确保 `deeploop` 命令、帮助文案、配置目录和 README 保持一致。

---

## 问题：代码 review 发现服务启动、CLI 发布和权限边界仍有风险

### 问题现象

对 `/Users/zezedabaobei/Desktop/cosmocloud/Deeplumen/cosmowork/deepwork` 做代码 review 时发现，当前 TypeScript 静态检查 `npx tsc --noEmit` 可以通过，但 `npm run build` 仍然失败，服务不能启动。除此之外，代码里还有几处会影响真实使用的风险：

```text
1. next.config.js 仍使用 module.exports，和 package.json 的 type: module 冲突，导致 next dev / next build 都失败。
2. package.json 的 bin 指向 dist/cli.js，但 dist/cli.js 仍显示 DeepWork / deepwork 文案，源码 src/cli/index.ts 才是 DeepLoop / deeploop，说明发布产物落后于源码。
3. /api/projects/join 无论 mode 是 panel 还是 agent，都会同时创建 product participant 和 employee participant，导致普通面板用户也被创建成 Agent，左侧 Agent 列表可能出现并不存在的 worker。
4. /api/requirements 的 DELETE 如果不传 participantId 就可以删除任意 requirement；dismiss pending 逻辑也没有校验 projectId / participantId，权限边界过宽。
5. src/lib/supabase-server.ts 在所有服务端 API 中使用 SUPABASE_SERVICE_ROLE_KEY。当前接口没有鉴权，如果本地或部署环境暴露，客户端可以通过 API 间接执行高权限写入/删除。
```

### 正确理解

这些问题不是一个单独 UI bug，而是 DeepLoop 从本地 demo 走向可多人协作时必须补齐的运行与安全边界。当前最优先的 blocker 仍是 `next.config.js`，因为它会直接阻止服务启动和构建。CLI 命名不同步会影响 Agent 按面板命令接入；join 逻辑和 DELETE 权限会影响在线成员/Agent 状态的真实性和数据安全。

### 解决方案

建议按优先级处理：

```text
P0：修 next.config.js
- 如果保留 package.json 的 type: module，就把 next.config.js 改成 export default nextConfig。
- 或者改名为 next.config.cjs 并保留 module.exports。
- 修复后必须跑 npm run dev 和 npm run build。

P0：同步 CLI 发布产物
- 重新构建 dist/cli.js，让实际 bin deeploop 显示 DeepLoop / deeploop。
- 移除或兼容旧 bin/deepwork、deepwork-cli.sh，避免面板命令和发布命令不一致。

P1：修 /api/projects/join 的 mode 语义
- mode=panel 时只创建 product participant。
- mode=agent 时只创建 employee participant，必要时返回 agentId。
- 不要让普通面板用户自动变成 Agent worker，否则会造成“Agent 在线但其实没有 worker”的误导。

P1：收紧 requirements 删除/确认权限
- DELETE 必须携带 projectId，并校验 requirement 属于当前 project。
- 删除普通需求时必须校验 participantId 是创建者，或引入明确 admin/server action。
- pending dismiss 也应有来源校验，不要允许任意 id 被删除。

P1：补 API 鉴权或本地访问边界
- 继续使用 service role 可以，但接口必须验证参与者身份/project membership。
- 至少要防止任意请求伪造 participantId 删除、提交、覆盖结果。
```

### 给其他 Agent 的指令

如果你接手修复，不要只看 TypeScript 是否通过。当前 `tsc --noEmit` 通过不代表项目可运行；必须用 `npm run dev` / `npm run build` 验证 Next 配置。修复时先处理启动 blocker，再处理 CLI dist 同步，最后处理 join/requirements 的权限和语义边界。

验收标准：

```text
1. npm run dev 能启动，3000 端口可访问。
2. npm run build 能通过。
3. npx tsc --noEmit 能通过。
4. deeploop 实际 bin 和源码帮助文案一致。
5. 面板用户进入项目不会被错误显示为 CLI Agent。
6. 普通用户不能删除别人的需求，也不能跨 project 删除需求。
```

---

## 参考：需求数据流（面板提交 → Agent 拿到）

回答 "面板用户提交的需求是从哪里获取" 的完整链路。所有需求只存在一个地方：Supabase Postgres `intents` 表。

### 表结构（`intents`）

| 字段 | 含义 |
|------|------|
| `id` | 需求 UUID |
| `room_id` | 项目代号，例如 `WEB001`（projectCode 直接当 room id 用） |
| `participant_id` | 提交人，对应 `participants.id`（mode='panel' 那条） |
| `content` | 需求文本 |
| `section` | 编码槽，同时表达类型和优先级：`__REQ__` 普通、`__REQ_H__` 重要、`__REQ_U__` 紧急、`__REQ_PENDING__` 待确认（AI 建议未发布） |
| `created_at` | 时间戳，weight 相同的需求按 `created_at` 升序消费 |

### 提交流程（写入）

```
[面板用户]                                           [Supabase Postgres]
   │                                                       │
   │  POST /api/requirements                               │
   │  body = { projectId, content, participantId,          │
   │           priority }                                  │
   ├──────────────────────────────────────────────►        │
   │  src/app/api/requirements/route.ts (POST)             │
   │   ├── verifyParticipant(projectId, participantId)     │
   │   └── INSERT INTO intents                             │
   │       (room_id, participant_id, section=__REQ_*__,    │
   │        content)                                       │
   │                                                       ●
   │                                                  (Postgres 触发
   │                                                   Realtime 广播)
```

### 拿需求的三条路径（任一启动都能干活）

| Worker 类型 | 协议 | 入口 |
|-------------|------|------|
| **CLI `deeploop work`** | HTTP 轮询（每 5 秒） | `GET /api/requirements?projectId=X` → `src/app/api/requirements/route.ts` (GET) → `SELECT * FROM intents WHERE room_id=X AND section IN (REQ_*, PENDING)` |
| **网页 worker** (`/project/[id]/work`) | Supabase Realtime 订阅 | `postgres_changes` on `public.intents`，filter `event=INSERT, room_id=eq.${projectId}`，再按 `section ∈ REQ_SECTIONS` 过滤 |
| **SDK worker** (`src/worker/index.ts`，独立 Node 进程) | 启动查积压 + Realtime 订阅 | 启动时 `SELECT * FROM intents WHERE room_id=X AND section IN (...)` 直读积压；之后订阅 postgres_changes |

### 面板页自己也读同一张表

面板页 `/project/[id]/page.tsx` 渲染右侧 feed：

- **初始加载**：`GET /api/requirements?projectId=X`
- **实时增量**：订阅 Supabase Realtime postgres_changes on `intents`（和 worker 用的是同一个事件流，只是过滤逻辑不同）

### 关键点

- Panel 不是直接把需求"发给"某个 Agent，而是把需求写入共享数据库 `intents` 表。
- 所有 worker 从同一张表拉取，三种协议（HTTP poll / Realtime push / 直查 DB）任选其一。
- `room_id` 就是项目隔离边界，`section` 同时编码"是不是需求 / 优先级是什么"。
- `__REQ_PENDING__` 是 AI 建议但用户还没确认的需求，普通 worker 不应该消费这一类（要先 PATCH 升级到 `__REQ_*__`）。

### 给其他 Agent 的指令

要排查 "需求为什么没被处理" 时，按这个顺序查：

1. `intents` 表里有没有这条记录？`room_id`、`section` 对不对？
2. 有没有 worker 在跑？`deeploop status` / 网页 work 页 / SDK worker 进程都算。
3. worker 用的协议是哪条？HTTP poll 间隔 5s，Realtime 是即时推送但要看 Supabase Realtime 配置是否开了 `intents` 表的 publication。
4. 不要假设面板上的"处理中..."是真的在处理——当前那个状态只是按时间窗口猜的，不是真信号。真信号要订阅 `dw-activity-${projectId}` 频道的 `agent_ping` event（面板目前还没订阅）。

