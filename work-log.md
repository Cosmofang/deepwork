# DeepWork Work Log

自主分析与工作记录。每次循环更新。

---

## 第二十一轮分析 — 2026/04/25

### 本轮扫描结论

延续第二十轮的静态类型改动，本轮执行了三件事：
1. 运行 `npm run build` 确认第二十轮 `DeepWorkRecommendedAction` 类型改动编译通过。
2. 修复语义 bug：`invite-missing-roles` action 中 `affectedSections: missingRoles` 把角色 ID（如 `['designer']`）填入期望 section 名的字段，改为不传该字段（字段应为 section 名，不是 role ID）。
3. 实现合成冲突协议闭环：合成路由之前完全丢弃了 Claude 返回的 `conflictsDetected`，导致协议的 `resolve-open-conflicts` recommended action 永远无法被触发。现在，凡是未被同一轮 `conflictsResolved` 覆盖的冲突，都会以 `conflict.detected` 事件写入 `events.ndjson`，conflictId 格式 `synth-r{round}-c{i}`，下一次 `GET /api/workspace` 即可返回优先级 p0 的治理动作。

### 本轮完成的改动

#### ✅ `affectedSections: missingRoles` 语义 bug 修复

**文件**：`src/lib/room-state.ts`

`invite-missing-roles` action 中删除了 `affectedSections: missingRoles`，因为 `missingRoles` 是角色 ID 数组，而 `affectedSections` 语义上应为 section 名称数组。

#### ✅ 合成→协议冲突闭环

**文件**：`src/app/api/synthesize/route.ts`

- 新增 `fs` 和 `path` 导入
- 在 `synthesis_completed` 和 `artifact.updated` 事件写入之后，对 Claude 返回的 `conflictsDetected` 做过滤：去掉已被 `conflictsResolved` 解决的条目
- 剩余未解决冲突逐条写入 `events.ndjson`（`type: 'conflict.detected'`，conflictId: `synth-r{round}-c{i}`）
- 写入使用 `Promise.all` 并发，不阻塞返回

#### ✅ 构建验证

`npm run build` 通过，所有路由编译正常。

### 为什么这是方向正确的改动

第二十轮把 `recommendedNextActions` 结构化，第二十一轮让这个结构化字段真正可以被触发：合成找到冲突 → 协议记录 `conflict.detected` → 快照返回 `priority: p0` / `suggestedAction: write_event` / `eventTypes: ['decision.accepted']` → Machine B 写 `decision.accepted` → 冲突标记为已解决。这是一个完整的 human-agent 治理循环，正是 DeepWork demo 最需要展示的核心价值。

### 下一步建议

1. Demo 演练（P0，4/29 前）：配置 `.env.local`（Supabase + Anthropic keys），执行端到端演示流程。
2. 双机器 curl 测试：写入 `conflict.detected` → `GET /api/workspace` 验证 `recommendedNextActions[0].priority === 'p0'`。
3. 可考虑在 `docs/protocol-dual-machine-test.md` 添加合成冲突闭环的验证步骤。

---

## 第二十轮分析 — 2026/04/25

### 本轮扫描结论

本轮重点检查了协议层最新状态：`src/types/deepwork-protocol.ts`、`src/lib/room-state.ts`、`src/app/api/workspace/route.ts`、`src/app/api/workspace/events/route.ts`、`docs/protocol-event-contract.md`、`docs/protocol-dual-machine-test.md`。项目已经具备 reader API、writer API、recentEvents、protocol-level snapshot、semantic event contract 和 smarter `recommendedNextActions`。

第十九轮把 `recommendedNextActions` 从静态提示升级成上下文感知提示，但类型仍然是 `string[]`。这对人类可读足够，但对 Machine B 这类外部 agent 不够理想：agent 需要知道优先级、为什么需要做、应该写什么事件、影响哪些 section/file、关联哪些事件，而不是解析自然语言。

### 本轮完成的改动

#### ✅ `recommendedNextActions` 结构化协议化

**文件**：`src/types/deepwork-protocol.ts`、`src/lib/room-state.ts`、`docs/protocol-event-contract.md`

新增：

- `DeepWorkActionPriority = 'p0' | 'p1' | 'p2'`
- `DeepWorkRecommendedAction`
- `DeepWorkSnapshot.recommendedNextActions?: DeepWorkRecommendedAction[]`

每条 recommended action 现在包含：

- `id`：稳定动作标识，例如 `run-first-synthesis`、`review-proposed-patches`
- `priority`：P0/P1/P2，让 agent 区分治理阻塞、可执行下一步和演示完整性建议
- `summary`：人类可读说明
- `reason`：为什么这个动作存在
- `eventTypes`：建议下一步可能写入或触发的协议事件类型
- `suggestedAction`：`write_event` / `run_synthesis` / `invite_actor` / `review_patch`
- `affectedSections`、`affectedFiles`、`linkedEventIds`：让 Machine B 不需要解析 prose 就能定位上下文

现有 6 类动作都已迁移为结构化对象：收集首条意图、首次合成、过期合成后重新合成、review proposed patches、resolve conflicts、invite missing roles。

### 为什么这是方向正确的小改动

DeepWork 的长期目标是让多个 agent/client 围绕同一个 project state 协作。`recommendedNextActions` 如果只是字符串，它更像 UI copy；一旦它变成结构化协议字段，它就成为 agent-readable planning surface。Machine B 可以直接按 `priority` 排序、按 `suggestedAction` 选择动作、按 `eventTypes` 决定写什么事件、按 `linkedEventIds` 追溯依据。这比让 agent 解析英文句子更稳定，也更接近“共享项目状态与意图协议”的产品核心。

### 验证状态

已静态复核新增类型、`buildDeepWorkSnapshot()` 中的 action 生成逻辑、事件类型引用和文档说明。关键点：`conflict.detected` 过滤处已加 TypeScript type guard，避免 union event 上直接访问 `conflictId` / `sections` 的类型风险；`recommendedNextActions` 不再有 `string[]` 类型残留。当前会话尚未成功运行 shell，因此仍需补跑 `npm run build` 或 `npx tsc --noEmit` 做完整 TypeScript 验证。

### 下一步建议

1. 运行 `npm run build` 验证本轮类型改动。
2. 如果通过，提交并 push 本轮结构化 action 改动与 `work-log.md` 更新。
3. 用最小双机器模拟测试确认：写入 `conflict.detected` 后，`GET /api/workspace?roomId=...` 返回的 `snapshot.recommendedNextActions` 包含 `priority: 'p0'`、`suggestedAction: 'write_event'`、`eventTypes: ['decision.accepted']`。
4. 后续可将 `docs/protocol-dual-machine-test.md` 的 convergence checklist 增加对 structured recommended actions 的断言。

_注：本次自动写日志时曾误把第二十轮内容插入多处；已将 `work-log.md` 修复为本轮简洁记录，后续如需完整历史可从 git 历史恢复。_
