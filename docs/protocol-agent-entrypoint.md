# DeepWork 协议文档入口

> 最后更新：2026-04-26

DeepWork 的 landing page 协作 demo 只是 wedge。当前项目真正要验证的是一层可被人类、Claude、OpenClaw 与其他 agent 共同读取的项目状态协议：谁参与了、表达了什么意图、合成出了什么、冲突在哪里、哪些 patch 待审查、下一步治理动作应该如何关闭。

## 推荐读取顺序

1. `README.md`：先读产品命题，确认 DeepWork 不是 prompt tool，也不是 generic multi-agent orchestrator，而是“意图 + 合成”的协作模式。
2. `work-log.md`：从最新轮次往下读，获得最近协议决策、已验证事项和未验证风险。
3. `conversation-log.md`：读原始问题拆解、demo 场景、理论地基和早期工程计划。
4. `src/types/deepwork-protocol.ts`：读协议的 canonical TypeScript surface，包括 project key、semantic event、snapshot、recommended action、governance policy。
5. `src/lib/room-state.ts`：读 snapshot 归约逻辑，重点看 semantic events 如何变成 `unresolvedConflicts`、`proposedPatches`、`recommendedNextActions`。
6. `src/app/api/workspace/route.ts`：读 agent-readable reader API，了解 Machine B 如何读取 shared state。
7. `src/app/api/workspace/events/route.ts`：读外部 agent writer API，了解哪些事件可由外部写入、哪些事件需要治理或合成路径触发。
8. `src/app/api/synthesize/route.ts`：读 synthesis path，确认自然语言意图如何生成 artifact、attribution、conflict events。

## 当前协议最小闭环

Reader 闭环是：`GET /api/workspace?roomId=ROOM` 返回 `snapshot`、`projectKey`、`recentEvents`。这个响应应该足够让另一台机器上的 agent 不读聊天记录，也能知道当前共享项目状态与下一步建议。

Writer 闭环是：外部 agent 通过 `POST /api/workspace/events` 写入非破坏性 semantic event，例如 `patch.proposed`、`conflict.detected`、`decision.accepted`、`summary.updated`。writer 会自动补稳定 `id`；当 `conflict.detected` 没有 `conflictId` 时，会使用事件 `id` 作为默认可关闭身份。

Governance 闭环是：snapshot 中的 `recommendedNextActions` 不只是 UI 文案，而是 agent-readable planning surface。每个 action 可以包含 `priority`、`eventTypes`、`linkedEventIds`、`closeWith` 和 `governancePolicy`。例如 open conflict 应通过 `decision.accepted.decisionId` 关闭；proposed patch 可通过 `patch.applied.linkedEventIds` 或 `decision.accepted.decisionId` 关闭。

## 当前已知限制

当前 workspace reader 只归约最近 100 条可解析 semantic events。它足以覆盖 hackathon demo 与短双机器测试，但不是长期 durable governance index。长期应把 open conflict、open patch、accepted decision、applied patch 归约进持久索引，避免长运行房间依赖 recent event window。

当前 `GET /api/workspace` 的 cache-miss 路径已经改为先同步 `.deepwork` 文件，再读取同一份 snapshot 文件生成协议响应，避免 live response 和落盘 snapshot 在同一次请求中使用不同时间点的 Supabase 读取结果。但完整端到端仍依赖 Supabase/Anthropic 环境变量，自动运行只能完成静态与构建验证。

## 下一位 agent 的建议动作

优先运行 `npm run build` 或 `npx tsc --noEmit`，验证最近协议改动没有破坏 Next.js 编译。随后做最小双机器协议测试：先建立一个 room 并生成 `.deepwork` snapshot，再 POST 一个 `conflict.detected`，GET workspace 确认 `resolve-open-conflicts` 出现且带 `closeWith.field: "decisionId"`，最后 POST `decision.accepted` 使用该 conflictId，确认 unresolved conflict 与 P0 action 消失。
