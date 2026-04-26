# DeepWork 协议文档入口

> 最后更新：2026-04-26（Cycle 53）

DeepWork 的 landing page 协作 demo 只是 wedge。当前项目真正要验证的是一层可被人类、Claude、OpenClaw 与其他 agent 共同读取的项目状态协议：谁参与了、表达了什么意图、合成出了什么、冲突在哪里、哪些 patch 待审查、下一步治理动作应该如何关闭。

---

## 推荐读取顺序

1. **本文件**：读协议最小闭环与快速操作参考，覆盖常见 agent 操作。
2. `work-log.md`：从最新轮次往下读，获得最近协议决策、已验证事项和未验证风险。
3. `src/types/deepwork-protocol.ts`：读协议的 canonical TypeScript surface，包括 project key、semantic event、snapshot、recommended action、governance policy。
4. `src/lib/room-state.ts`：读 snapshot 归约逻辑，重点看 semantic events 如何变成 `unresolvedConflicts`、`proposedPatches`、`recommendedNextActions`。
5. `src/app/api/workspace/route.ts`：读 agent-readable reader API，了解 Machine B 如何读取 shared state。
6. `src/app/api/workspace/events/route.ts`：读外部 agent writer API，了解哪些事件可由外部写入、哪些事件需要治理或合成路径触发。
7. `src/app/api/synthesize/route.ts`：读 synthesis path，确认自然语言意图如何生成 artifact、attribution、conflict events。

**参考文档（仅在需要详细内容时读取）：**

- `docs/protocol-event-contract.md`：完整事件形状规范、writer 行为、snapshot 含义。仅在构造非常规事件或调试 reader 时查阅。
- `docs/protocol-dual-machine-test.md`：双机器协议验证步骤，含完整 step-by-step 测试计划。
- `docs/protocol-readiness-checkpoint.md`：历史 checkpoint 记录，描述已实现能力与已解决缺口。

---

## 当前协议最小闭环

**Reader 闭环**：`GET /api/workspace?roomId=ROOM` 返回 `snapshot`、`projectKey`、`recentEvents` 和 `actionCapabilities`。这个响应足够让另一台机器上的 agent 不读聊天记录，也能知道当前共享项目状态、下一步建议，以及每个 `suggestedAction` 对应的可执行/需审查边界。

**Writer 闭环**：外部 agent 通过 `POST /api/workspace/events` 写入非破坏性 semantic event，例如 `patch.proposed`、`conflict.detected`、`decision.accepted`、`summary.updated`。writer 会自动补稳定 `id`；当 `conflict.detected` 没有 `conflictId` 时，会使用事件 `id` 作为默认可关闭身份。

**Governance 闭环**：snapshot 中的 `recommendedNextActions` 不只是 UI 文案，而是 agent-readable planning surface。每个 action 包含 `priority`、`eventTypes`、`linkedEventIds`、`closeWith` 和 `governancePolicy`。例如 open conflict 通过 `decision.accepted.decisionId` 关闭；proposed patch 通过 `patch.applied.linkedEventIds` 或 `patchId` 关闭。

---

## 快速操作参考

这一节覆盖 agent 最常见的三个操作，读完本节即可直接执行，不需要先读完所有文档。

### A. 记录一个冲突（`conflict.detected`）

```bash
curl -s -X POST "http://localhost:3000/api/workspace/events" \
  -H "Content-Type: application/json" \
  -d '{
    "roomId": "YOUR_ROOM_ID",
    "event": {
      "type": "conflict.detected",
      "summary": "设计师和文案在首屏文案上有冲突",
      "sections": ["hero"],
      "actorIds": []
    }
  }'
```

写入后，`GET /api/workspace?roomId=YOUR_ROOM_ID` 的响应中 `snapshot.unresolvedConflicts` 会出现该冲突，`snapshot.recommendedNextActions` 会出现优先级 P0 的 `resolve-open-conflicts` action。

### B. 关闭一个冲突（`decision.accepted`）

先拿到 conflict id：
```bash
CONFLICT_ID=$(curl -s "http://localhost:3000/api/workspace?roomId=YOUR_ROOM_ID" \
  | jq -r '.snapshot.unresolvedConflicts[0].id')
```

再写入决策：
```bash
curl -s -X POST "http://localhost:3000/api/workspace/events" \
  -H "Content-Type: application/json" \
  -d "{
    \"roomId\": \"YOUR_ROOM_ID\",
    \"event\": {
      \"type\": \"decision.accepted\",
      \"summary\": \"首屏文案冲突解决：采用文案版本\",
      \"decisionId\": \"$CONFLICT_ID\",
      \"title\": \"首屏文案决策\",
      \"value\": \"采用文案版本，设计师调整排版适配\"
    }
  }"
```

写入后，刷新 `GET /api/workspace` 确认 `snapshot.unresolvedConflicts` 中该冲突消失，`resolve-open-conflicts` action 消失或 count 减少。

### C. 提出一个 patch（`patch.proposed`）和关闭它

**提出**（至少包含 `patchId` 或 `linkedEventIds` 或 `affectedSections` 之一）：
```bash
curl -s -X POST "http://localhost:3000/api/workspace/events" \
  -H "Content-Type: application/json" \
  -d '{
    "roomId": "YOUR_ROOM_ID",
    "event": {
      "type": "patch.proposed",
      "summary": "修改首页主标题以体现协议层定位",
      "patchId": "hero-headline-v2",
      "affectedSections": ["hero"],
      "affectedFiles": ["src/app/page.tsx"],
      "reason": "定位变更：DeepWork 是共享项目状态协议，不只是 landing page 生成工具",
      "status": "proposed"
    }
  }'
```

写入后，`snapshot.proposedPatches` 出现该 patch，`review-proposed-patches` P1 action 出现。

**关闭**（`patchId` 与 `linkedEventIds` 同时携带，冗余确保 reader 识别）：
```bash
curl -s -X POST "http://localhost:3000/api/workspace/events" \
  -H "Content-Type: application/json" \
  -d '{
    "roomId": "YOUR_ROOM_ID",
    "event": {
      "type": "patch.applied",
      "summary": "首页主标题 patch 已应用",
      "patchId": "hero-headline-v2",
      "linkedEventIds": ["hero-headline-v2"],
      "affectedFiles": ["src/app/page.tsx"],
      "status": "applied"
    }
  }'
```

写入后，`snapshot.proposedPatches` 中该 patch 消失。

---

## 最小治理闭环验证（完整 curl 脚本）

这是 `docs/demo-quickstart.md` Section 7b 的提炼版，可以直接复制执行：

```bash
BASE="http://localhost:3000"
ROOM="YOUR_ROOM_ID"

# 1. 读取当前快照，确认 writer endpoint 正常
curl -s "$BASE/api/workspace?roomId=$ROOM" | jq '.snapshot.recommendedNextActions[0]'

# 2. 写入 conflict.detected
curl -s -X POST "$BASE/api/workspace/events" \
  -H "Content-Type: application/json" \
  -d '{"roomId":"'$ROOM'","event":{"type":"conflict.detected","summary":"设计师和文案在首屏文案上有冲突","sections":["hero"],"actorIds":[]}}'

# 3. 确认 P0 action 出现，获取 conflict id
CONFLICT_ID=$(curl -s "$BASE/api/workspace?roomId=$ROOM" | jq -r '.snapshot.unresolvedConflicts[0].id')
echo "Conflict ID: $CONFLICT_ID"

# 4. 写入 decision.accepted 关闭冲突
curl -s -X POST "$BASE/api/workspace/events" \
  -H "Content-Type: application/json" \
  -d '{"roomId":"'$ROOM'","event":{"type":"decision.accepted","summary":"首屏文案冲突解决","decisionId":"'$CONFLICT_ID'","title":"首屏文案决策","value":"采用文案版本，设计师调整排版"}}'

# 5. 验证冲突已消失
curl -s "$BASE/api/workspace?roomId=$ROOM" | jq '.snapshot.unresolvedConflicts'
# 期望：[] 或不包含刚才关闭的 conflict id
```

---

## 当前已知限制

- 当前 workspace reader 只归约最近 100 条可解析 semantic events。它足以覆盖 hackathon demo 与短双机器测试，但不是长期 durable governance index。长期应把 open conflict、open patch、accepted decision、applied patch 归约进持久索引，避免长运行房间依赖 recent event window。
- 当前 `.deepwork/` 文件是本地落盘，不是跨机器共享 canonical source。真正双机器测试应使用同一 HTTP endpoint（共享 Supabase）。
- 合成超时为 90 秒（AbortController），失败后 `events.ndjson` 会写入 `summary.updated` failure event，房间状态重置为 `collecting`。

---

## 下一位 agent 的建议动作

1. 运行 `npm run build` 或 `npx tsc --noEmit`，验证最近协议改动没有破坏 Next.js 编译。
2. 执行上方「最小治理闭环验证」脚本，用真实 room id 走一遍 conflict→P0 action→decision 的完整闭环。
3. 可选：执行 patch.proposed→snapshot.proposedPatches→patch.applied 闭环，确认 `review-proposed-patches` action 正确消失。
4. 参考 `docs/demo-quickstart.md` 核对清单，确认完整 demo 路径（synthesis、归因显示、继续迭代）在真实环境下正常。
