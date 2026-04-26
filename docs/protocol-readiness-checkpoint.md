# DeepWork Protocol Readiness Checkpoint

更新时间：2026-04-26（Cycle 53）

> **读取提示**：本文件是历史 checkpoint 记录，描述已实现能力与已解决缺口。如果你是 continuation agent，优先读取 `docs/protocol-agent-entrypoint.md`，它包含当前状态、快速操作参考和最小治理闭环脚本。

---

## 当前判断

DeepWork 已经不只是一个落地页协作 Demo。当前代码里已经出现了一个可被人类和代理共同读取的协作状态层：`.deepwork/project.json` 作为 project key，`.deepwork/rooms/{roomId}/snapshot.json` 作为房间快照，`.deepwork/rooms/{roomId}/events.ndjson` 作为语义事件流，`/api/workspace` 作为代理读取入口，`/api/workspace/events` 作为受限写入入口。

---

## 已实现的协议能力

### Project key

`src/types/deepwork-protocol.ts` 定义了 `DeepWorkProjectKey`。实际写入路径在 `src/lib/room-state.ts` 和 `src/app/api/workspace/events/route.ts` 中。它包含协议版本、项目 ID、当前房间、当前快照路径、事件路径、实时 channel、支持的事件类型、输出文件和权限。

### Snapshot

`DeepWorkSnapshot` 已经把房间状态提升为 agent-readable 结构。它包含 actors、sections、recentIntents、decisions、proposedPatches、latestArtifacts、unresolvedConflicts、recommendedNextActions。

### Semantic event stream

`DeepWorkSemanticEvent` 已覆盖 actor.joined、intent.created、section.created、synthesis.started、synthesis.completed、artifact.updated、patch.proposed、patch.applied、decision.accepted、conflict.detected、summary.updated。

`events.ndjson` 的选择很适合跨机器和跨代理协作：追加友好、可 diff、可恢复、可被命令行和 LLM 同时读取。

### Governance hooks

当前已实现两个重要治理约束。第一，`/api/workspace/events` 只允许外部代理写入非破坏性事件，不允许直接触发 synthesis.started / synthesis.completed。第二，`recommendedNextActions` 会把 proposed patches、unresolved conflicts、stale synthesis 转成明确的下一步建议，并附带 governancePolicy。

---

## 已解决的缺口（历史记录）

以下缺口在早期版本中存在，截至 Cycle 53 均已修复：

### ✅ 冲突事件结构一致性（Cycle 44）

此前 `src/app/api/synthesize/route.ts` 在记录 unresolved conflicts 时，`conflict.detected` 事件缺少 `sections` 和 `actorIds` 字段。已修复：synthesis writer 写出的 `conflict.detected` 包含 `sections: []` 和 `actorIds: []`，与外部 writer 契约保持一致。

### ✅ 协议文档缺口（Cycle 45）

协议主要存在于 TypeScript 类型里，没有 agent-readable 文档入口。已修复：`docs/protocol-agent-entrypoint.md` 是当前 agent 读取顺序入口，`docs/protocol-event-contract.md` 是完整事件契约，`docs/protocol-dual-machine-test.md` 是双机器测试计划。

### ✅ NDJSON reader 容错（Cycle 49）

workspace reader 在遇到单条恶性 NDJSON 行时会中断整个解析。已修复：reader 对每行独立 try/catch，跳过无法解析的行并继续返回可解析的 recent events。

### ✅ patchId 作为 patch 关闭别名（Cycle 50）

`patch.proposed` 的 `patchId` 字段未被 writer validation 和 snapshot reader 识别为合法 closure 标识。已修复：TypeScript 类型、events writer validation、snapshot reader buildDeepWorkSnapshot 均支持 `patchId` 作为关闭别名，与 `linkedEventIds`、`linkedIntents`、`decisionId` 并列。

### ✅ review_patch 示例 payload 与 reader closure 语义对齐（Cycle 51）

`review_patch` capability 示例 payload 只携带 `linkedEventIds`，不携带 `patchId`，与 Cycle 50 新增的 patchId alias 不一致。已修复：patch.applied 示例同时携带 `patchId` 与 `linkedEventIds`（使用相同占位值），覆盖两种关闭路径，continuation agent 复制任一字段均可关闭 proposal。

### ✅ catch 块不写入 failure event（Cycle 52）

`src/app/api/synthesize/route.ts` 主 `catch` 块（处理 90s AbortError 超时等所有非 JSON 解析失败）未调用 `recordSynthesisFailure`，导致 `synthesis.started` 孤立在 `events.ndjson` 中无对应 failure/completion 事件。已修复：catch 块现在 `catch (err) { await recordSynthesisFailure(...) }` 将错误信息写入协议日志，snapshot reader 可区分「合成进行中」与「合成失败已恢复」。

### ✅ 文档扫描成本（Cycle 53，本轮）

三份协议文档（event-contract、dual-machine-test、readiness-checkpoint）有重叠内容，continuation agent 需要扫描多文件才能知道下一步操作。已修复：`docs/protocol-agent-entrypoint.md` 更新为自包含快速参考，包含最常见的三种操作（conflict.detected、decision.accepted、patch.proposed→patch.applied）的完整 curl 示例，以及最小治理闭环验证脚本，agent 读完入口文件即可执行常见操作，不需要先扫描 event-contract 或 dual-machine-test。

---

## 当前仍存在的限制（需关注）

### ⚠️ governance index 不持久

当前 workspace reader 只归约最近 100 条可解析 semantic events。超过 100 条后，older proposed patches 和 conflicts 可能消失，不再出现在 recommendedNextActions 中。对 hackathon demo 足够，但长期不是 durable governance。

### ⚠️ `.deepwork/` 文件是本地单机落盘

真正的双机器测试需要共享的 HTTP endpoint（同一 Supabase）。本地 `.deepwork/` 文件只对运行服务的机器可见，不是跨机器 canonical source。

### ⚠️ 合成后端不暴露进度

合成 90s 超时期间，前端只能显示 spinner，无法知道 Claude 处理进度。如果 Anthropic API 出现中间断连（非超时），用户会等到超时才看到错误。这对 demo 影响：需要稳定网络或切换为更快模型（`claude-sonnet-4-6`）进行快速测速。

---

## 建议的下一步产品表达

Demo 现场可以这样讲：DeepWork 表面上是在多人协作生成 landing page，但真正展示的是一个 agent-era collaboration layer。每个人提交的不是评论，而是结构化意图；AI 不是直接覆盖产物，而是产生可归因的合成；另一个代理不是读取聊天记录，而是读取 project key、snapshot 和 event stream；任何 patch、冲突、决策都能被事件化并治理。
