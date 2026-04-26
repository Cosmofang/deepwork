# DeepWork Demo Quickstart

**目标**：从零环境到跑通完整演示路径，控制在 15 分钟以内。  
**演示日**：2026/04/30 周三 15:00  
**完整演示剧本**：见 [`docs/demo-script.md`](demo-script.md)

---

## 1. 环境配置（3 分钟）

```bash
# 1. 克隆并安装依赖
git clone git@github.com:Cosmofang/deepwork.git
cd deepwork
npm install

# 2. 配置环境变量
cp .env.local.example .env.local
# 编辑 .env.local，填入真实值：
#   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
#   SUPABASE_SERVICE_ROLE_KEY=eyJ...
#   ANTHROPIC_API_KEY=sk-ant-...

# 3. 启动开发服务器
npm run dev
# → 访问 http://localhost:3000
```

> **Vercel 部署**：如使用 Vercel，在 Project Settings → Environment Variables 中填入同样四个变量，`npm run dev` 跳过。

---

## 2. Supabase 表检查（1 分钟）

在 Supabase Dashboard → SQL Editor 执行，确认五张表存在：

```sql
select table_name from information_schema.tables
where table_schema = 'public'
order by table_name;
-- 期望：intents, participants, room_sections, rooms, synthesis_results
```

如果缺表，参考仓库根目录 `supabase/schema.sql` 与 `supabase/migrations/` 目录（或联系数据库负责人）。

---

## 3. 构建验证（可选，2 分钟）

```bash
npm run build
# 期望：✓ Compiled successfully，12 条路由，无 TypeScript 错误
```

---

## 4. 演示前核对清单

| 项目 | 检查方式 | 期望结果 |
|------|---------|---------|
| 服务启动 | 访问 `http://localhost:3000` | 首页正常加载 |
| 房间生成 | 点「生成房间码」 | 6 位大写码出现 |
| 加入房间 | 输入码 + 选角色 + 进入 | 进入意图输入页 |
| 实时在线数 | 第二标签页加入同一房间 | Header 显示「2 人在线」 |
| 意图提交 | 输入文字点「提交意图」 | 意图出现在中间栏（带角色颜色） |
| 一键填充 | 点「示例意图」 | 自动填充预设内容 |
| 合成触发 | 主持人点「开始合成」 | 全员看到合成遮罩 |
| 合成结果 | 等待约 30–90 秒 | 跳转到 `/room/{id}/result` |
| 归因高亮 | 结果页默认状态 | 各 section 带颜色边框 + 角色 badge |
| 合成失败提示 | 断开 Anthropic 网络后合成 | 所有参与者看到「合成失败，请重试」（红色提示） |
| 继续迭代 | 结果页点「继续迭代」 | 回到意图输入，可再提交 |

---

## 5. 关键演示路径（Golden Path）

```
主持人生成房间码
  → 5 人用不同角色加入
  → 每人点「示例意图」一键填充（或手动输入 2–3 条）
  → 主持人点「开始合成」
  → 等待合成（约 60s）
  → 自动跳转结果页
  → 讲解归因高亮：哪个 section 是谁的意图决定的
  → 回到意图输入，某人修改一条意图，再次合成
  → 对比两轮结果的变化
```

---

## 6. 故障排查

### 环境变量未配置

如果加入房间、填充 demo、提交意图、合成或读取 live workspace 时返回 `Supabase server environment is not configured` / `Anthropic API key is not configured`，说明本地 `.env.local` 还没有填真实服务配置。先从 `.env.local.example` 复制并填入 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 与 `ANTHROPIC_API_KEY`。没有这些配置时，页面静态加载和 TypeScript 检查可以通过，但无法完成真实多人 demo 或 Claude 合成。

### 合成失败（页面弹出红色提示）

1. 检查 `ANTHROPIC_API_KEY` 是否填写正确
2. 检查网络是否能访问 `api.anthropic.com`
3. 检查 Claude claude-opus-4-7 是否在该 API key 的权限范围内
4. 合成超时限制为 90 秒；如网络慢，可在 `.env.local` 临时换用 `claude-sonnet-4-6` 测速（在 `src/app/api/synthesize/route.ts` 中修改 `model` 字段）

### Supabase Realtime 不更新

1. 确认 Supabase 项目的 Realtime 功能已启用（Dashboard → Database → Replication）
2. `rooms`、`participants`、`intents`、`synthesis_results` 四张表需加入 realtime publication：
   ```sql
   alter publication supabase_realtime add table rooms, participants, intents, synthesis_results;
   ```

### 本地 `.deepwork/` 文件夹不生成

- 首次合成或加入房间后会自动创建
- 如目录权限问题，检查 `process.cwd()` 对应目录是否可写

### 归因高亮不显示

- 结果页默认已开启「归因常亮」
- 如仍未显示，检查合成输出的 HTML 是否包含 `data-source` 属性（用浏览器开发者工具检查 iframe 内容）

---

## 7. Agent 协议入口（如需双机器测试）

完整协议测试步骤见 [`docs/protocol-dual-machine-test.md`](protocol-dual-machine-test.md)。

### 7a. 从 actionCapabilities 提取示例 payload（无需读文档）

`GET /api/workspace` 的响应中包含 `actionCapabilities`，其中每个 capability 带有 `examplePayloads`，让 agent 直接构造合法请求：

```bash
BASE="http://localhost:3000"
ROOM="YOUR_ROOM_ID"

# 查看 write_event 的所有示例 payload
curl -s "$BASE/api/workspace?roomId=$ROOM" \
  | jq '.actionCapabilities[] | select(.suggestedAction=="write_event") | .examplePayloads[] | {eventType, description}'

# 获取 conflict.detected 的完整示例 body
curl -s "$BASE/api/workspace?roomId=$ROOM" \
  | jq '.actionCapabilities[] | select(.suggestedAction=="write_event") | .examplePayloads[] | select(.eventType=="conflict.detected") | .body'
```

### 7b. 最小治理闭环验证

```bash
BASE="http://localhost:3000"
ROOM="YOUR_ROOM_ID"

# 1. 读取协议快照，查看推荐动作与 actionCapabilities
curl -s "$BASE/api/workspace?roomId=$ROOM" | jq '.snapshot.recommendedNextActions[0], .actionCapabilities[0].suggestedAction'

# 2. 写入 conflict.detected
curl -s -X POST "$BASE/api/workspace/events" \
  -H "Content-Type: application/json" \
  -d '{"roomId":"'$ROOM'","event":{"type":"conflict.detected","summary":"设计师和文案在首屏文案上有冲突","sections":["hero"],"actorIds":[]}}'

# 3. 确认 P0 action 出现，复制 conflict id
CONFLICT_ID=$(curl -s "$BASE/api/workspace?roomId=$ROOM" | jq -r '.snapshot.unresolvedConflicts[0].id')
curl -s "$BASE/api/workspace?roomId=$ROOM" | jq '.snapshot.unresolvedConflicts, .snapshot.recommendedNextActions[] | select(.priority=="p0")'

# 4. 写入 decision.accepted 关闭冲突（decisionId 对应上面的 conflict id）
curl -s -X POST "$BASE/api/workspace/events" \
  -H "Content-Type: application/json" \
  -d '{"roomId":"'$ROOM'","event":{"type":"decision.accepted","summary":"首屏文案冲突解决","decisionId":"'$CONFLICT_ID'","title":"首屏文案冲突解决","value":"采用文案版本，设计师调整排版"}}'

# 5. 确认冲突已从 unresolvedConflicts 中消失
curl -s "$BASE/api/workspace?roomId=$ROOM" | jq '.snapshot.unresolvedConflicts'
```

---

*最后更新：Cycle 45 — 2026/04/26*
