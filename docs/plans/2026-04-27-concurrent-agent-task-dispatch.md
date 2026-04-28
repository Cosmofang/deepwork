# DeepWork 并发任务与在线 Agent 调度

> 面板用户提交并发任务，DeepWork 将任务交给当前在线的真实 Agent workers 处理，例如服务器部署的 Claude、本机 Claude、远端电脑上的 Claude、OpenClaw、Cursor Agent 或其他可接入的执行节点。

## 核心定位

DeepWork 在这个工作流中不是单一 Agent，也不是普通聊天界面，而是任务面板、项目状态协议、调度中心和实时结果墙。面板用户负责提出需求和判断结果；DeepWork 负责接收需求、维护队列、记录状态、匹配在线 Agent、展示进展和保存结果；在线 Agent workers 负责领取任务、执行任务并提交结果。

这个设计的重点是：任务不绑定某一个聊天窗口，也不绑定某一台机器。只要 Agent 能通过 project key 或 API 连接到同一个 DeepWork 项目，它就可以读取任务、声明能力、领取任务、提交产物，并让其他用户和 Agent 看到同一份项目状态。

## 整体工作流草图

```text
面板用户提交任务
        ↓
任务进入 DeepWork Unified Task Queue
        ↓
DeepWork 记录任务状态、优先级、所需能力、执行模式
        ↓
在线 Agent Pool 持续注册状态和能力
        ↓
空闲 Agent 拉取或领取适合自己的任务
        ↓
DeepWork 将任务标记为 claimed / working
        ↓
Agent 在服务器、本机或远端电脑上执行任务
        ↓
Agent 提交 summary / artifact / patch / result
        ↓
DeepWork 写入结果并实时展示到面板
        ↓
面板用户查看、采用、继续追问或提交下一条任务
```

更具体的结构如下：

```text
                         DeepWork Project Room
┌────────────────────────────────────────────────────────────┐
│                                                            │
│  面板用户提交任务                                           │
│                                                            │
│  “帮我把首页改成展示在线用户和任务队列”                      │
│                                                            │
└─────────────────────────────┬──────────────────────────────┘
                              │
                              ▼

┌────────────────────────────────────────────────────────────┐
│                    Unified Task Queue                       │
│                                                            │
│  Task #1                                                    │
│  - content: 修改首页，显示在线用户和任务队列                  │
│  - status: queued                                           │
│  - priority: high                                           │
│  - execution_mode: single / parallel                        │
│  - required_capability: code_edit                           │
│                                                            │
└─────────────────────────────┬──────────────────────────────┘
                              │
                              ▼

┌────────────────────────────────────────────────────────────┐
│                    Online Agent Pool                        │
│                                                            │
│  Claude Server Worker                                      │
│  - status: idle                                             │
│  - capability: generate_html, docs, analysis                │
│  - location: server                                         │
│                                                            │
│  Local Claude                                               │
│  - status: idle                                             │
│  - capability: repo_access, code_edit, test_run             │
│  - location: user laptop                                    │
│                                                            │
│  Remote Claude / OpenClaw                                   │
│  - status: working                                          │
│  - capability: browser_test, research, review               │
│  - location: remote computer                                │
│                                                            │
└─────────────────────────────┬──────────────────────────────┘
                              │
                              ▼

┌────────────────────────────────────────────────────────────┐
│                    Claim / Dispatch                         │
│                                                            │
│  空闲 Agent 读取任务队列，或 DeepWork 主动分配任务             │
│                                                            │
│  Task #1 → Local Claude                                     │
│                                                            │
│  Task status = claimed / working                            │
│  Agent status = working                                     │
│                                                            │
└─────────────────────────────┬──────────────────────────────┘
                              │
                              ▼

┌────────────────────────────────────────────────────────────┐
│                    Agent Execution                          │
│                                                            │
│  Local Claude 读取项目                                      │
│  修改代码                                                   │
│  运行检查                                                   │
│  生成 summary / diff / artifact                             │
│                                                            │
└─────────────────────────────┬──────────────────────────────┘
                              │
                              ▼

┌────────────────────────────────────────────────────────────┐
│                    Result Submission                        │
│                                                            │
│  Agent 提交结果回 DeepWork                                  │
│                                                            │
│  - task_id                                                  │
│  - agent_id                                                 │
│  - result_type: code_patch / html / doc / analysis           │
│  - summary                                                  │
│  - artifact                                                 │
│  - status: submitted                                        │
│                                                            │
└─────────────────────────────┬──────────────────────────────┘
                              │
                              ▼

┌────────────────────────────────────────────────────────────┐
│                    Realtime Result Panel                    │
│                                                            │
│  面板用户看到：                                              │
│                                                            │
│  Task #1 已由 Local Claude 完成                              │
│  查看结果 / 采用 / 继续修改 / 分配给另一个 Agent               │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## 在线 Agent 类型

第一类是服务器 Claude。它部署在服务器或后台 worker 环境里，适合处理不需要访问用户本机文件的任务，例如生成页面、写文案、总结需求、生成方案、做轻量分析。它可以长期在线，适合作为默认兜底执行者。

第二类是本机 Claude。它运行在用户电脑上，能够访问本地项目文件，适合处理代码修改、运行测试、读取 repo、创建真实文件等任务。本机 Claude 是 DeepWork 连接真实工作目录的关键执行节点。

第三类是远端 Claude、OpenClaw 或其他 Agent。它们可以运行在另一台开发机、云主机、同事电脑或远端自动化环境中。它们通过 project key、workspace API 或任务 API 连接同一个 DeepWork 项目，读取任务并提交结果。

## Agent Worker 注册模型

每个 Agent 上线后，都应该向 DeepWork 注册自己的身份、位置、状态和能力。

```ts
type AgentWorker = {
  id: string;
  name: string;
  kind: 'claude' | 'openclaw' | 'cursor' | 'vscode' | 'custom';
  location: 'server' | 'local' | 'remote';
  status: 'idle' | 'working' | 'offline' | 'paused';
  capabilities: string[];
  current_task_id?: string;
  last_seen_at: string;
};
```

示例：

```json
{
  "id": "agent_local_claude_001",
  "name": "本机 Claude",
  "kind": "claude",
  "location": "local",
  "status": "idle",
  "capabilities": ["repo_access", "code_edit", "test_run", "doc_write"],
  "last_seen_at": "2026-04-27T10:30:00Z"
}
```

## Task 模型

每个任务需要声明内容、状态、优先级、权重、执行模式和所需能力。

```ts
type Task = {
  id: string;
  project_id: string;
  content: string;
  status: 'queued' | 'claimed' | 'working' | 'submitted' | 'resolved' | 'failed' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  weight: number;
  execution_mode: 'single' | 'parallel';
  required_capabilities: string[];
  claimed_by?: string;
  created_by: string;
  created_by_type: 'human' | 'agent' | 'system';
  source: 'panel' | 'agent' | 'api';
  created_at: string;
  updated_at: string;
};
```

示例：

```json
{
  "id": "task_123",
  "project_id": "ABC123",
  "content": "把首页改成显示在线用户和任务队列",
  "status": "queued",
  "priority": "high",
  "weight": 90,
  "execution_mode": "single",
  "required_capabilities": ["repo_access", "code_edit"],
  "created_by": "user_001",
  "created_by_type": "human",
  "source": "panel",
  "created_at": "2026-04-27T10:30:00Z",
  "updated_at": "2026-04-27T10:30:00Z"
}
```

## 调度原则

如果任务需要 `code_edit` 和 `repo_access`，DeepWork 应优先分配给本机 Claude 或有 repo 权限的远端 Agent。如果任务只是生成页面、写文案、总结需求或轻量分析，可以分配给服务器 Claude。如果任务是开放式方案探索，可以使用 `parallel` 模式，让多个 Agent 同时提交不同方案。如果任务是代码修改、文件写入或需要避免冲突的操作，默认使用 `single` 模式，让一个 Agent claim 后锁定任务。

任务排序的第一版可以使用简单规则：Agent 只处理 `queued` 的任务，优先处理 `weight` 最高的任务；如果权重相同，优先处理 `created_at` 更早的任务；任务被 claim 后进入 `claimed` 或 `working` 状态，默认不再被其他 Agent 领取。

## Pull Mode 与 Push Mode

第一版建议优先使用 Pull Mode。Agent 上线后定期请求下一个适合自己的任务，DeepWork 根据任务权重、任务状态、Agent 能力和 Agent 当前状态返回候选任务。Pull Mode 更适合本机 Claude 和远端电脑上的 Claude，因为这些执行节点可能不稳定在线，也可能在不同网络环境下运行。

```text
Agent 上线
  ↓
POST /api/agents/register
  ↓
定期 POST /api/agents/heartbeat
  ↓
GET /api/tasks/next?agentId=xxx
  ↓
POST /api/tasks/claim
  ↓
Agent 执行任务
  ↓
POST /api/tasks/submit
```

Push Mode 可以作为后续增强。服务器部署的 Claude 或长期在线 worker 可以通过 websocket、queue 或 webhook 接收 DeepWork 主动分配的任务。

## 最小 API 设计

```text
POST /api/agents/register
Agent 注册上线，声明身份、位置和能力。

POST /api/agents/heartbeat
Agent 定期更新状态、当前任务和 last_seen_at。

POST /api/tasks
面板用户、Agent 或系统提交任务。

GET /api/tasks/next?agentId=xxx
Agent 获取当前最适合自己的下一个任务。

POST /api/tasks/claim
Agent 领取任务。DeepWork 需要保证领取是原子操作，避免多个 Agent 同时 claim 同一 single 任务。

POST /api/tasks/submit
Agent 提交结果，包括 summary、artifact、patch、html 或 analysis。
```

## 与当前代码的关系

当前 DeepWork 代码已经有雏形：`participants` 可以继续承载用户和 Agent 注册；`intents` 可以暂时作为 requirements/tasks；`synthesis_results` 可以暂时作为 submissions/results；`attribution_map` 已经能记录 `agent_id`、`agent_name`、`requirement_id`、`summary` 等信息。

下一步不是立刻重建所有数据表，而是先把当前模型升级为任务队列语义：给 requirement 增加状态、权重、执行模式、claimed_by 和 required_capabilities；让 Agent worker 不再简单处理第一条未处理需求，而是通过 claim 机制领取最高权重且适合自己的 queued task；面板实时显示在线 Agent、任务队列、任务状态和提交结果。

## 最小可行闭环

```text
1. 面板用户提交任务
   ↓
2. task status = queued
   ↓
3. Agent worker 上线并声明能力
   ↓
4. Agent 调用 /api/tasks/next
   ↓
5. DeepWork 返回最高权重且能力匹配的 queued task
   ↓
6. Agent 调用 /api/tasks/claim
   ↓
7. task status = working, claimed_by = agent_id
   ↓
8. Agent 执行任务
   ↓
9. Agent 调用 /api/tasks/submit
   ↓
10. 面板实时显示结果
```

这个闭环成立后，DeepWork 就从页面生成 demo 进入真正的多 Agent 工作调度面板阶段。后续的版本树、分支结果、采纳决策、冲突合并都应该建立在这个并发任务调度基础之上。
