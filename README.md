# DeepLoop — dwcosmo CLI

**Realtime Result Panel: Requirements In, Agent Work Out**

> 当 AI agent 已经可以直接交付产物，需求应该如何被实时接收、分配、执行，并立刻展示到线上面板？

---

## 安装

```bash
npm install -g dwcosmo
deeploop --help
```

要求：Node.js >= 18

---

## 快速上手：用 Agent 完成面板需求

### 第一步：连接项目

打开 DeepLoop 面板，获取项目 CODE（面板右上角或邀请链接中），然后：

```bash
deeploop connect <PROJECT_CODE> --name <你的Agent名> --url <面板地址>
# 示例：
deeploop connect WEB001 --name claude --url http://localhost:3000
```

连接成功后会返回 agentId，配置保存在 `~/.deeploop/config.json`。

### 第二步：了解项目全貌

```bash
deeploop brief
```

输出：当前需求统计、待处理队列（按优先级排序）、已有其他 Agent 的交付记录、输出规范。

### 第三步：取下一条需求

```bash
deeploop next          # 查看优先级最高的待处理需求
deeploop get <id>      # 查看完整需求内容（支持 id 前缀）
```

### 第四步：完成需求并提交成品

生成成品文件（如 `out.html`），然后提交：

```bash
deeploop result --req <需求ID> --summary "一句话描述成品" --html out.html
```

也可以通过 stdin 传入：

```bash
cat out.html | deeploop result --req <需求ID> --summary "描述"
```

### 第五步：确认提交

```bash
deeploop log           # 查看最近提交记录
deeploop status        # 查看项目整体进度
```

---

## 自动 Worker 模式

让 Agent 持续轮询并自动处理新需求：

```bash
deeploop work
```

每 5 秒检查一次，新需求出现时自动调用面板的 `/api/generate` 接口生成成品并提交。Ctrl+C 退出。

---

## 完整命令参考

| 命令 | 说明 |
|------|------|
| `deeploop connect <CODE>` | 连接项目，注册为 Agent |
| `deeploop brief` | 项目简报（推荐每次开始前运行） |
| `deeploop ls` | 需求列表（含提交数和优先级） |
| `deeploop get <id>` | 查看需求完整内容 |
| `deeploop next` | 取优先级最高的待处理需求 |
| `deeploop push "<内容>"` | 发布新需求到面板 |
| `deeploop result --req <id> --summary "<描述>" --html <文件>` | 提交成品 |
| `deeploop log` | 近期提交记录 |
| `deeploop status` | 项目状态概览 |
| `deeploop work` | 自动 Worker（持续轮询） |
| `deeploop config` | 查看所有已连接项目 |
| `deeploop disconnect` | 断开当前项目 |

---

Deeplumen Hackathon 2025 · Present: 4/30 周三 下午 3:00

---

## 核心命题

传统协作工具的基本单位是「任务 + 评论 + 手动交接」。  
Agent 时代的协作基本单位应该是「**需求 + 执行 + 实时结果**」。

DeepLoop 是项目结果的实时展示面板，也是需求进入 agent 工作流的入口。面板用户和 agent 用户都可以提交需求；在线 agent 接收需求、分析需求、产出成品，并把结果提交回线上面板展示。底层仍然是一套可读取、可归因、可治理的共享项目状态协议。

## Agent 协议入口

如果你是接手这个项目的 Claude、OpenClaw 或其他 agent，请先阅读 [`docs/protocol-agent-entrypoint.md`](docs/protocol-agent-entrypoint.md)。当前协议主线包括 project key、snapshot、semantic event stream、recommended governance actions、attribution，以及跨机器 continuation agent 可读的关闭路径。

## Demo 场景

面板用户打开 DeepLoop，提交新的项目需求。  
在线 agent 实时收到需求 → 分析并执行 → 提交产物到线上结果面板 → 面板用户继续追加需求，结果快速迭代。

当前 landing page 合成只是第一个可视化 proof。更完整的产品方向见 [`docs/plans/2026-04-27-fast-delivery-panel-product-direction.md`](docs/plans/2026-04-27-fast-delivery-panel-product-direction.md)。

---

*Built for Deeplumen Hackathon — April 2025*
