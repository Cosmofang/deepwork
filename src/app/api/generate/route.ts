import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'child_process';
import { createClient, getSupabaseServerConfigStatus } from '@/lib/supabase-server';

export const maxDuration = 300;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
});

// Map UI model choice to actual Claude model id. Sonnet stays the default.
const MODEL_MAP = {
  haiku:  'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-7',
} as const;
type ModelChoice = keyof typeof MODEL_MAP;

// Strip the leading panel markers and return both their values.
// Markers are written by the panel as 「（模型: xxx）」 and 「（基于 vN）」 in
// either order; both are removed from the content actually shown to the model.
function parseRequirementMeta(rawContent: string): {
  content: string;
  modelId: string;
  basedOnVersion: number | null;
} {
  let content = rawContent;
  let modelId: string = MODEL_MAP.sonnet;
  let basedOnVersion: number | null = null;

  // Up to two iterations — there are at most two markers, in any order.
  for (let i = 0; i < 2; i++) {
    const modelMatch = content.match(/^\s*（模型:\s*(haiku|sonnet|opus)）/);
    if (modelMatch) {
      modelId = MODEL_MAP[modelMatch[1] as ModelChoice];
      content = content.slice(modelMatch[0].length);
      continue;
    }
    const baseMatch = content.match(/^\s*（基于\s*v(\d+)）/);
    if (baseMatch) {
      basedOnVersion = parseInt(baseMatch[1], 10);
      content = content.slice(baseMatch[0].length);
      continue;
    }
    break;
  }

  return { content: content.trimStart(), modelId, basedOnVersion };
}

const HTML_SPEC = `
## HTML 生成规范

### 技术要求（严格遵守）
- 生成完整的 <!DOCTYPE html> HTML 文件，**不使用任何外部 CSS/JS 框架或 CDN**
- 所有样式写在 <head> 内的 <style> 标签，使用标准 CSS + CSS 自定义属性管理颜色/间距
- 所有交互 JS 写在 </body> 前的 <script> 标签，**不得有任何外部 <script src> 或 <link rel="stylesheet">**

### 视觉风格 — 现代 SaaS 深色旗舰风（类 Linear / Vercel / Loom）
- 背景：#080808（近黑）为基底；Hero 用多色 radial-gradient 做氛围光晕
- 主文字：#ffffff；次文字：rgba(255,255,255,0.55)；弱文字：rgba(255,255,255,0.28)
- 主强调色：#a855f7（紫）；辅色：#3b82f6（蓝）、#22c55e（绿）
- 字体：-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif
- 字号层级：Hero 标题 56–72px、section 标题 36–44px、正文 16–18px、标签 12–13px
- 布局：CSS Grid + Flexbox；section padding-block 最少 100px；最大宽度 1100px，水平居中
- 卡片：background rgba(255,255,255,0.03)；border 1px solid rgba(255,255,255,0.08)；border-radius 16px；backdrop-filter blur(8px)
- 主按钮：background #fff；color #000；padding 13px 30px；border-radius 10px；font-weight 600

### 动画与交互（必须实现）

**① Hero 动态光晕背景**（纯 CSS）：
@keyframes drift1/drift2 让两个 radial-gradient 光球缓慢漂移

**② Scroll-reveal 淡入上移**：
.reveal{opacity:0;transform:translateY(28px);transition:...} → IntersectionObserver 进入视口时 add('visible')

**③ 数字计数动画**：
data-count 属性 + 进入视口时 0→目标值，800ms easeOutQuad

**④ 卡片微交互**：
feature-card:hover translateY(-6px)；Hero CTA 按钮呼吸动画 pulse

### 结构要求
- 标准区块顺序：Header（含 Nav）→ Hero → 价值主张 → 功能亮点 → 社交证明 → 定价 → FAQ → CTA → Footer
- 文案全部用中文；产品名称从需求中提取
- 数字统计元素加 data-count 属性
- <footer> 含版权、链接、品牌色底栏`;

type GenerateOutput = { html: string; summary: string; thinking?: string };

// ── Per-project serial queue ─────────────────────────────────────────────
// Same-project generate requests run one-at-a-time so two concurrent jobs
// can't both base their work on the same "current page" and clobber each
// other (the lost-update problem). Different projects don't block each other.
//
// State is kept on globalThis so it survives Next.js hot-reload in dev. Each
// entry's value is the in-flight job's promise; new arrivals chain onto it.
// Stale entries self-cleanup once they're no longer the queue head.
const PROJECT_GENERATE_LOCKS: Map<string, Promise<void>> = (() => {
  const g = globalThis as { __deeploop_generate_locks?: Map<string, Promise<void>> };
  if (!g.__deeploop_generate_locks) g.__deeploop_generate_locks = new Map();
  return g.__deeploop_generate_locks;
})();

async function acquireProjectLock(projectId: string): Promise<() => void> {
  const previous = PROJECT_GENERATE_LOCKS.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const myLock = new Promise<void>(resolve => { release = resolve; });
  PROJECT_GENERATE_LOCKS.set(projectId, myLock);
  // Wait for the previous in-flight job to finish (ignore its errors —
  // we still want our turn even if the previous one threw).
  await previous.catch(() => undefined);
  return () => {
    release();
    // If no one queued behind us, drop the entry to keep the map small.
    if (PROJECT_GENERATE_LOCKS.get(projectId) === myLock) {
      PROJECT_GENERATE_LOCKS.delete(projectId);
    }
  };
}

// intents table is requirements, synthesis_results table is submissions
// attribution_map stores: { agent_id, agent_name, requirement_id, summary, role_description }

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    projectId?: string;
    requirementId?: string; // = intent.id
    agentId?: string;       // = participant.id
  };

  const projectId = body.projectId?.trim().toUpperCase();
  const requirementId = body.requirementId?.trim();
  const agentId = body.agentId?.trim();

  if (!projectId || !requirementId || !agentId) {
    return NextResponse.json({ error: 'projectId, requirementId, agentId required' }, { status: 400 });
  }

  const configStatus = getSupabaseServerConfigStatus();
  if (!configStatus.ready) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_BASE_URL) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 });
  }

  // Wait for any in-flight generate for this project to finish before we
  // start ours. Lock is per-project, so different projects still run in
  // parallel. The release callback must be invoked in every exit path.
  console.log(`[generate] queueing for project ${projectId} (active locks: ${PROJECT_GENERATE_LOCKS.size})`);
  const releaseLock = await acquireProjectLock(projectId);
  console.log(`[generate] starting work for project ${projectId} requirement ${requirementId.slice(0, 8)}`);

  try {
  const supabase = createClient();

  // Fetch requirement (from intents)
  const { data: intent } = await supabase
    .from('intents')
    .select('*')
    .eq('id', requirementId)
    .eq('room_id', projectId)
    .maybeSingle();

  if (!intent) {
    return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });
  }

  // Check duplicate: look in synthesis_results.attribution_map for this agent+requirement
  const { data: allResults } = await supabase
    .from('synthesis_results')
    .select('id, attribution_map')
    .eq('room_id', projectId);

  const alreadySubmitted = (allResults ?? []).find((r: Record<string, unknown>) => {
    const meta = (r.attribution_map ?? {}) as Record<string, string>;
    return meta.agent_id === agentId && meta.requirement_id === requirementId;
  });

  if (alreadySubmitted) {
    return NextResponse.json({ error: 'Already submitted for this requirement', submissionId: alreadySubmitted.id }, { status: 409 });
  }

  // Parse markers up front so we know whether the user pinned a base version
  // (「（基于 vN）」) and which model to use. The marker is a 1-indexed
  // ordinal — v1 is the oldest submission, vN is the latest at write time.
  const { content: cleanContent, modelId, basedOnVersion } = parseRequirementMeta(intent.content as string);

  // Resolve currentHtml against the marker.
  //   - With marker: pull all versions sorted ascending, take the (N-1)th.
  //     If the index is out of range, fall through to "latest" instead of
  //     erroring — the user's selection might point at a version that's been
  //     deleted, in which case latest is the safest fallback.
  //   - Without marker: just take the latest as before.
  let currentHtml: string | null = null;
  let basedOnInfo: string | null = null;
  if (basedOnVersion !== null) {
    const { data: ascending } = await supabase
      .from('synthesis_results')
      .select('id, html_content, created_at')
      .eq('room_id', projectId)
      .order('created_at', { ascending: true });
    const list = (ascending ?? []) as Array<{ id: string; html_content: string; created_at: string }>;
    const idx = basedOnVersion - 1;
    if (idx >= 0 && idx < list.length) {
      currentHtml = list[idx].html_content;
      basedOnInfo = `v${basedOnVersion}`;
      console.log(`[generate] using base v${basedOnVersion} (id=${list[idx].id.slice(0, 8)}) for requirement ${requirementId.slice(0, 8)}`);
    } else {
      console.warn(`[generate] base marker v${basedOnVersion} out of range (have ${list.length} versions), falling back to latest`);
    }
  }
  if (currentHtml === null) {
    const { data: latestVersion } = await supabase
      .from('synthesis_results')
      .select('html_content')
      .eq('room_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    currentHtml = (latestVersion?.html_content as string) ?? null;
  }

  // Fetch agent name from participants
  const { data: participant } = await supabase
    .from('participants')
    .select('name')
    .eq('id', agentId)
    .maybeSingle();

  const rawName = (participant?.name as string) ?? 'Agent';
  // name may contain role_description encoded as "Name｜RoleDesc"
  const nameParts = rawName.split('｜');
  const agentName = nameParts[0] ?? rawName;
  const roleDescription = nameParts[1] ?? '';

  // The base-version label tells the model which version it's iterating on,
  // so the prompt can refer to it explicitly and the model doesn't accidentally
  // mix up "latest" vs "user-selected base".
  const baseLabel = basedOnInfo ? `用户指定的基础版本（${basedOnInfo}）` : '当前最新版本';
  const iterativeSection = currentHtml
    ? `\n\n## ${baseLabel}（在此基础上迭代修改）\n用户已经明确选择了上面这个版本作为修改起点。请在以下现有 HTML 的基础上进行修改，只改动与新需求相关的部分，保留其他已有内容：\n<current_html>\n${currentHtml}\n</current_html>`
    : '';

  const prompt = currentHtml
    ? `你是一名顶级的产品设计师和前端工程师。请在现有页面的基础上迭代改进，完成以下新需求。

## 新需求
${cleanContent}
${iterativeSection}

${HTML_SPEC}`
    : `你是一名顶级的产品设计师和前端工程师。这是项目的第一个版本，请根据需求从零生成一个高质量的产品落地页 HTML。

## 需求
${cleanContent}

${HTML_SPEC}`;

  const timeoutMs = 540_000; // 9 min safety net
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  const useCliMode = !!process.env.ANTHROPIC_BASE_URL; // proxy only accepts Claude Code clients (CLI)
  let output: GenerateOutput | null = null;

  try {
    if (useCliMode) {
      const cliPrompt = prompt + `

---

请将生成结果以如下格式输出。标签内只放 JSON，标签外不要任何文字：

<generate_output>
{
  "html": "<完整的 <!DOCTYPE html> 文档>",
  "summary": "一句话描述生成了什么",
  "thinking": "在生成 HTML 之前的思考过程：你是怎么理解这条需求的？做了哪些关键决策（比如布局、配色、结构调整）？为什么这么改？面向面板用户用中文写 3-6 句即可，不要重复 summary。"
}
</generate_output>`;

      output = await new Promise<GenerateOutput>((resolve, reject) => {
        if (controller.signal.aborted) {
          reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }));
          return;
        }

        const proc = spawn('claude', ['-p', cliPrompt, '--model', modelId, '--output-format', 'json'], { stdio: ['ignore', 'pipe', 'pipe'] });
        const onAbort = () => proc.kill('SIGTERM');
        controller.signal.addEventListener('abort', onAbort);

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

        proc.on('error', (err: NodeJS.ErrnoException) => {
          controller.signal.removeEventListener('abort', onAbort);
          reject(new Error(err.code === 'ENOENT' ? 'claude CLI 未找到，请确认 claude 已安装且在 PATH 中' : err.message));
        });

        proc.on('close', (code: number | null) => {
          controller.signal.removeEventListener('abort', onAbort);
          if (controller.signal.aborted) {
            reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }));
            return;
          }
          if (code !== 0) {
            reject(new Error(stderr.slice(0, 300) || `claude CLI exit ${code}`));
            return;
          }
          // --output-format json wraps output in {"result": "...", "type": "result", ...}
          let text = stdout;
          try {
            const envelope = JSON.parse(stdout) as Record<string, unknown>;
            if (typeof envelope.result === 'string') text = envelope.result;
          } catch { /* stdout is plain text, continue */ }
          // strip residual ANSI codes
          text = text.replace(/\x1B\[[0-9;]*[mGKHFJ]/g, '').replace(/\r/g, '');
          const match = text.match(/<generate_output>\s*([\s\S]*?)\s*<\/generate_output>/);
          const jsonStr = match ? match[1] : text.match(/\{[\s\S]*"html"[\s\S]*\}/)?.[0];
          if (!jsonStr) { reject(new Error('CLI 输出中未找到有效 JSON')); return; }
          try {
            resolve(JSON.parse(jsonStr) as GenerateOutput);
          } catch {
            reject(new Error('CLI 输出 JSON 解析失败'));
          }
        });
      });
    } else {
      const tools = [
        {
          name: 'generate_page',
          description: 'Output the generated landing page HTML',
          input_schema: {
            type: 'object' as const,
            properties: {
              html: { type: 'string', description: 'Complete <!DOCTYPE html> landing page' },
              summary: { type: 'string', description: '一句话描述这个落地页的核心内容' },
              thinking: { type: 'string', description: '在生成 HTML 之前的思考过程：你是怎么理解这条需求的？做了哪些关键决策（比如布局、配色、结构调整）？为什么这么改？面向面板用户用中文写 3-6 句即可，不要重复 summary。' },
            },
            required: ['html', 'summary', 'thinking'],
          },
        },
      ] as Parameters<typeof anthropic.messages.create>[0]['tools'];

      const message = await anthropic.messages.create(
        {
          model: modelId,
          max_tokens: 16000,
          tools,
          tool_choice: { type: 'tool', name: 'generate_page' },
          messages: [{ role: 'user', content: prompt }],
        },
        { signal: controller.signal }
      );

      const toolBlock = message.content.find(b => b.type === 'tool_use');
      if (toolBlock?.type === 'tool_use') {
        output = toolBlock.input as GenerateOutput;
      }
    }
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!output?.html) {
    return NextResponse.json({ error: 'Generation failed: no HTML output' }, { status: 500 });
  }

  // Insert into synthesis_results with attribution_map metadata
  console.log('[generate] inserting submission for', { projectId, requirementId, agentId, hasHtml: !!output.html });
  const { data: result, error: insertError } = await supabase
    .from('synthesis_results')
    .insert({
      room_id: projectId,
      round: 1,
      html_content: output.html,
      attribution_map: {
        agent_id: agentId,
        agent_name: agentName,
        role_description: roleDescription,
        requirement_id: requirementId,
        summary: output.summary ?? '',
        thinking: output.thinking ?? '',
      },
      conflicts_resolved: null,
    })
    .select()
    .single();

  console.log('[generate] insert result:', { insertError: insertError?.message, resultId: result?.id });
  if (insertError || !result) {
    return NextResponse.json({ error: insertError?.message ?? 'Submission insert failed' }, { status: 500 });
  }

  const submission = {
    id: result.id as string,
    project_id: result.room_id as string,
    requirement_id: requirementId,
    agent_id: agentId,
    html_content: result.html_content as string,
    summary: output.summary ?? '',
    created_at: result.created_at as string,
    agent: { id: agentId, name: agentName, role_description: roleDescription, status: 'idle' },
  };

  return NextResponse.json({ submission });
  } finally {
    // Always release, including on early returns inside the try block. Errors
    // bubble up; the next queued request still gets a turn.
    console.log(`[generate] releasing lock for project ${projectId}`);
    releaseLock();
  }
}
