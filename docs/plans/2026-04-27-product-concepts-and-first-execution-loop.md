# DeepWork 产品主要概念与第一版执行闭环

> DeepWork 是一种用户与 Agent 并发工作的实时面板：用户并发提交任务，在线 Agent 跨服务器、本机和远端电脑并发处理，结果实时回到同一个项目空间。

## 1. 产品主概念

DeepWork 的核心不是聊天，也不是单个 Agent 的自动化工具，而是一种新的工作形式：多个面板用户可以同时提交任务，多个在线 Agent 可以同时领取和执行任务，所有任务状态、执行过程和结果都回到同一个实时项目面板。

DeepWork 的产品结构可以概括为：面板用户并发提交任务，DeepWork 形成统一任务池，在线 Agent workers 领取或被分配任务，Agent 在自己的运行环境中执行，最终把结果、摘要、产物和日志提交回面板。

## 2. 四个核心对象

### User

User 是提交目标、判断结果和推动迭代的人。用户可以直接在 DeepWork 面板中提交任务，也可以通过自己正在使用的 Agent 将任务提交到 DeepWork 项目。

### Task / Requirement

Task 是用户或 Agent 提交的需求。所有来源的任务都进入同一个统一任务池。任务需要有内容、状态、优先级、权重、所需能力、执行模式和提交来源。

第一版可以继续复用当前代码中的 `Requirement` 概念，对应数据库中的 `intents` 表。当前实现已经用 `section` 编码优先级：`__REQ__` 是普通，`__REQ_H__` 是重要，`__REQ_U__` 是紧急。

### Agent Worker

Agent Worker 是真实在线的执行节点。它可以是服务器部署的 Claude、本机 Claude、远端电脑上的 Claude、OpenClaw、Cursor Agent、VSCode Agent，或者未来通过 DeepWork CLI 接入的任意自定义 worker。

第一版测试先使用当前网页 Agent 页面作为 worker，后续再将 Agent 板块升级为 CLI 接入方式。

### Result / Submission

Result 是 Agent 执行后的提交结果，可以是 HTML、文档、代码 patch、分析报告、日志或其他 artifact。第一版继续复用当前代码中的 `Submission`，对应数据库中的 `synthesis_results` 表。

## 3. 产品工作流

```text
用户填写名字进入 DeepWork 项目
        ↓
项目内页显示项目代码、在线用户、在线 Agent、需求队列和结果墙
        ↓
面板明确显示当前正在使用的 Agent：Claude、OpenClaw、Hermes 等
        ↓
用户可以直接在面板内提交任务，也可以点击“接入 Agent”获取连接工具和项目命令
        ↓
用户在 Claude、OpenClaw、Hermes 或本机 worker 中继续工作，并把需求提交回当前 DeepWork 项目
        ↓
多个用户和多个 Agent 并发提交任务
        ↓
任务进入统一任务池
        ↓
DeepWork 根据优先级、权重、状态和能力要求排序
        ↓
在线 Agent 领取适合自己的任务
        ↓
任务进入 working 状态
        ↓
Agent 执行任务并提交结果
        ↓
结果实时回到 DeepWork 面板
        ↓
用户查看、采用、继续追问或提交下一轮任务
```

## 4. 当前第一版执行策略

为了尽快跑通闭环，第一版不直接实现完整 CLI，而是先让面板用户接通“本机 Claude”来完成任务。这里的本机 Claude 第一阶段可以先用当前网页 Agent worker 页面承载：用户进入面板后，系统已经为同一个用户创建 panel participant 和 agent participant；面板左侧会明确展示“正在使用的 Agent”，包括 Claude、OpenClaw、Hermes 等连接状态。用户点击“接入 Agent”后，面板展示当前项目的连接命令，例如 `deepwork connect --agent claude ABC123`、`deepwork connect --agent openclaw ABC123`、`deepwork connect --agent hermes ABC123`。第一版中，用户也可以通过“打开网页 Claude worker”启动本机浏览器里的 Agent worker，让它连接同一个项目、注册在线状态、监听任务队列并自动执行。

第一版目标是验证：面板用户提交需求后，自己本机接通的 Claude worker 能够从同一个项目中看到需求，按权重选择任务，自动调用 `/api/generate` 执行，并把结果提交到面板。这个版本先证明“面板任务 → 本机 Agent 执行 → 结果回到面板”的工作形式成立；后续再把网页 Agent worker 替换为真正的 DeepWork CLI。

当前代码已经具备以下基础：

```text
src/app/page.tsx
入口页，用户可以选择面板用户或 Agent 工作者身份进入同一个项目。

src/app/project/[id]/page.tsx
面板页，负责提交需求、显示需求队列、显示 Agent 结果。

src/app/project/[id]/work/page.tsx
网页 Agent worker 页面，负责接收需求并调用生成接口。

src/app/api/requirements/route.ts
需求 API，当前用 intents 表保存 requirements，并已支持 normal / important / urgent 优先级。

src/app/api/generate/route.ts
执行 API，负责读取需求、调用 Claude 生成 HTML，并写入 synthesis_results。

src/app/api/submissions/route.ts
结果 API，负责读取 synthesis_results 并映射为 submissions。
```

## 5. 并发任务的第一版规则

第一版并发调度先使用轻量规则，不引入复杂 scheduler。

任务排序规则：优先处理 weight 更高的需求；如果 weight 相同，处理更早创建的需求。

Agent 处理规则：网页 Agent worker 只处理自己尚未提交过结果的任务。当前阶段暂时允许多个 Agent 对同一任务提交不同结果，这保留了多 Agent 并行比较的产品特征。后续如果要做单 Agent 锁定任务，再引入 `claimed_by` 和 `working` 状态。

优先级映射：普通任务权重为 50，重要任务权重为 75，紧急任务权重为 100。

## 6. 下一阶段 CLI Agent 定义

网页 Agent worker 是第一版验证手段，不是最终形态。长期 Agent 板块应该通过安装 DeepWork CLI 来接通面板处理需求。

理想命令形态：

```bash
deepwork connect --agent claude ABC123
deepwork connect --agent openclaw ABC123
deepwork connect --agent hermes ABC123
```

这些命令的含义不是让用户离开 DeepWork 面板，而是让用户把自己常用的 Agent 工具接入当前项目。接通后，用户可以直接在 Claude、OpenClaw、Hermes 等环境里继续工作，并通过 DeepWork 连接工具把新的需求、执行状态和结果提交回同一个面板。

CLI 启动后自动完成：注册 Agent、声明能力、发送 heartbeat、拉取任务、claim 任务、调用本机 Claude 或其他 Agent 执行、提交结果。

这会把 DeepWork 从网页 demo 升级为真正的跨机器 Agent 工作网络。

## 7. 第一版测试闭环

第一版测试需要跑通以下路径：

```text
1. 面板用户只填写名字进入项目 ABC123；项目代码不放在登录入口，而是在项目内页显示
2. 项目面板明确展示在线用户、需求队列、结果墙，以及当前正在使用的 Agent 列表
3. 用户点击“接入 Agent”看到 Claude / OpenClaw / Hermes 的连接命令；第一版可先打开网页 Claude worker 模拟本机 Claude
4. 本机 Agent worker 进入同一个项目 ABC123，并在面板中显示为在线 Agent
5. 面板用户提交普通 / 重要 / 紧急需求，或在已接入的 Agent 工具中把需求提交回 DeepWork
6. 本机 Agent worker 自动选择最高权重且自己未处理过的需求
7. Agent 调用 /api/generate 执行
8. 执行结果写入 synthesis_results
9. 面板页实时显示提交结果
10. 用户查看完整成品并继续提交下一条需求
```

如果这条路径稳定，DeepWork 就完成了从产品概念到第一版并发任务执行闭环的验证。
