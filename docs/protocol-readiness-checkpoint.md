# DeepWork Protocol Readiness Checkpoint

更新时间：2026-04-26

## 当前判断

DeepWork 已经不只是一个落地页协作 Demo。当前代码里已经出现了一个可被人类和代理共同读取的协作状态层：`.deepwork/project.json` 作为 project key，`.deepwork/rooms/{roomId}/snapshot.json` 作为房间快照，`.deepwork/rooms/{roomId}/events.ndjson` 作为语义事件流，`/api/workspace` 作为代理读取入口，`/api/workspace/events` 作为受限写入入口。

这说明产品方向可以从「多人提交意图，AI 生成 HTML」继续扩展为「共享项目状态 + 意图协议 + 可治理合成」。Landing page demo 应被保留为 wedge：它让观众在 3 分钟内看到意图收集、状态同步、合成、归因和下一步行动建议，但底层协议要表达得更清楚。

## 已实现的协议能力

### Project key

`src/types/deepwork-protocol.ts` 定义了 `DeepWorkProjectKey`。实际写入路径在 `src/lib/room-state.ts` 和 `src/app/api/workspace/events/route.ts` 中。它包含协议版本、项目 ID、当前房间、当前快照路径、事件路径、实时 channel、支持的事件类型、输出文件和权限。

这个结构已经足够支持另一台机器或另一个代理先读取 `.deepwork/project.json`，再定位当前 room 的 snapshot 与 events。

### Snapshot

`DeepWorkSnapshot` 已经把房间状态提升为 agent-readable 结构。它包含 actors、sections、recentIntents、decisions、proposedPatches、latestArtifacts、unresolvedConflicts、recommendedNextActions。

这比普通数据库 dump 更接近协议层，因为它回答的是「现在这个项目状态意味着什么」而不只是「数据库里有什么」。

### Semantic event stream

`DeepWorkSemanticEvent` 已覆盖 actor.joined、intent.created、section.created、synthesis.started、synthesis.completed、artifact.updated、patch.proposed、patch.applied、decision.accepted、conflict.detected、summary.updated。

`events.ndjson` 的选择很适合跨机器和跨代理协作：追加友好、可 diff、可恢复、可被命令行和 LLM 同时读取。

### Governance hooks

当前已实现两个重要治理约束。第一，`/api/workspace/events` 只允许外部代理写入非破坏性事件，不允许直接触发 synthesis.started / synthesis.completed。第二，`recommendedNextActions` 会把 proposed patches、unresolved conflicts、stale synthesis 转成明确的下一步建议，并附带 governancePolicy。

这已经把 DeepWork 从「让 AI 自动改」拉回到「AI 可提议，人类/可信 actor 可治理」。

## 发现的风险和缺口

### 冲突事件结构一致性

此前 `src/app/api/synthesize/route.ts` 在记录 unresolved conflicts 时，直接 append `conflict.detected` 到 `events.ndjson`，但事件里没有 `sections` 和 `actorIds`。而 `/api/workspace/events` 对同类型事件的校验要求 `sections` 和 `actorIds` 是字符串数组。

本轮已将 synthesis 路径写出的 `conflict.detected` 补齐为包含 `sections: []` 和 `actorIds: []` 的事件。这样 synthesis writer 与 external writer 的事件形状保持一致：当 Claude 只返回自然语言冲突描述、暂时无法定位具体 section/actor 时，用空数组表达“未知/未归类”，而不是省略字段。

### 协议文档缺失

目前协议主要存在于 TypeScript 类型和 API 注释里，没有一个稳定的人类/代理都能看的文档入口。对于「双机器 Claude/OpenClaw workflow」来说，另一个代理应该能先读一个短文档就知道：读取顺序是什么、哪些事件能写、哪些动作需要人类治理、如何关闭 proposed patch/conflict。

### Git 状态需要清理确认

项目目录是 git 仓库，但当前自动检查尚未做完整 diff 审计。下次运行应把 `git status --short` 和关键 diff 纳入例行检查，避免把历史未提交变更误判为本轮变更。

## 建议的下一步产品表达

Demo 现场可以这样讲：DeepWork 表面上是在多人协作生成 landing page，但真正展示的是一个 agent-era collaboration layer。每个人提交的不是评论，而是结构化意图；AI 不是直接覆盖产物，而是产生可归因的合成；另一个代理不是读取聊天记录，而是读取 project key、snapshot 和 event stream；任何 patch、冲突、决策都能被事件化并治理。

这会比「AI 做网页」更贴近项目目标，也更容易解释为什么 DeepWork 是一个工作模式，而不是一个单点工具。

## 本次改进

本文件把当前协议状态、已实现能力、缺口和下一步表达整理为一个可持续读取的 checkpoint。它可以作为后续每 30 分钟分析时的基准，也可以作为外部代理理解 DeepWork 方向的第一份文档。
