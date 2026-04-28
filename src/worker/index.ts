/**
 * DeepLoop Agent SDK Worker
 * 独立运行，订阅 Supabase realtime，自动处理新需求并生成 HTML 提交结果
 *
 * 运行：npm run worker
 * 环境变量（自动从 .env.local 加载）：
 *   WORKER_PROJECT  — 监听的项目 ID，如 "24BOSS"（必填）
 *   WORKER_NAME     — Worker 显示名称（默认 "SDK Worker"）
 *   WORKSPACE_DIR   — 文件读取根目录（默认当前目录）
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ── Load .env.local ──────────────────────────────────────────────────────────

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

// ── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL         = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_KEY         = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANTHROPIC_API_KEY    = process.env.ANTHROPIC_API_KEY ?? '';
const ANTHROPIC_BASE_URL   = process.env.ANTHROPIC_BASE_URL;
const WORKER_PROJECT       = process.env.WORKER_PROJECT?.trim().toUpperCase() ?? '';
const WORKER_NAME          = process.env.WORKER_NAME?.trim() || 'SDK Worker';
const WORKSPACE_DIR        = process.env.WORKSPACE_DIR?.trim() || process.cwd();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[worker] 缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error('[worker] 缺少 ANTHROPIC_API_KEY');
  process.exit(1);
}
if (!WORKER_PROJECT) {
  console.error('[worker] 缺少 WORKER_PROJECT，示例: WORKER_PROJECT=24BOSS npm run worker');
  process.exit(1);
}

// When ANTHROPIC_BASE_URL is set, the proxy only accepts Claude Code CLI clients.
// Use CLI mode (spawn `claude`) instead of SDK direct calls.
const USE_CLI_MODE = !!ANTHROPIC_BASE_URL;

const anthropic = USE_CLI_MODE ? null : new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Prompt spec ───────────────────────────────────────────────────────────────

const HTML_SPEC = `
## HTML 生成规范

### 技术要求（严格遵守）
- 生成完整的 <!DOCTYPE html> HTML 文件，不使用任何外部 CSS/JS 框架或 CDN
- 所有样式写在 <head> 内的 <style> 标签，使用标准 CSS + CSS 自定义属性管理颜色/间距
- 所有交互 JS 写在 </body> 前的 <script> 标签，不得有任何外部 <script src> 或 <link rel="stylesheet">

### 视觉风格 — 现代 SaaS 深色旗舰风（类 Linear / Vercel / Loom）
- 背景：#080808（近黑）；Hero 用多色 radial-gradient 做氛围光晕
- 主文字：#ffffff；次文字：rgba(255,255,255,0.55)；弱文字：rgba(255,255,255,0.28)
- 主强调色：#a855f7（紫）；辅色：#3b82f6（蓝）、#22c55e（绿）
- 字体：-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif
- 字号：Hero 标题 56–72px、section 标题 36–44px、正文 16–18px
- 卡片：background rgba(255,255,255,0.03)；border 1px solid rgba(255,255,255,0.08)；border-radius 16px
- 主按钮：background #fff；color #000；padding 13px 30px；border-radius 10px；font-weight 600

### 动画（必须实现）
① Hero 动态光晕背景（纯 CSS @keyframes）
② Scroll-reveal 淡入上移（IntersectionObserver）
③ 数字计数动画（data-count + easeOutQuad）
④ 卡片微交互 hover translateY(-6px)

### 结构
- Header → Hero → 价值主张 → 功能亮点 → 社交证明 → 定价 → FAQ → CTA → Footer
- 文案全部用中文；产品名称从需求中提取`;

// ── Tools ────────────────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_files',
    description: 'List files in the workspace directory to understand project structure',
    input_schema: {
      type: 'object' as const,
      properties: {
        dir: { type: 'string', description: 'Directory path relative to workspace root (default ".")' },
      },
    },
  },
  {
    name: 'read_file',
    description: 'Read a file from the workspace to understand context (e.g. existing designs, configs)',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path relative to workspace root' },
      },
      required: ['path'],
    },
  },
  {
    name: 'submit_html',
    description: 'Submit the completed HTML page as the final output. Call this exactly ONCE when your HTML is fully ready.',
    input_schema: {
      type: 'object' as const,
      properties: {
        html:    { type: 'string', description: 'Complete <!DOCTYPE html> page content' },
        summary: { type: 'string', description: '一句话描述这个页面的核心内容（中文）' },
      },
      required: ['html', 'summary'],
    },
  },
];

// ── Tool execution ────────────────────────────────────────────────────────────

type SubmitResult = { html: string; summary: string };

function runListFiles(input: Record<string, unknown>): string {
  try {
    const rel = (input.dir as string) || '.';
    const abs = path.resolve(WORKSPACE_DIR, rel);
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    return entries.map(e => (e.isDirectory() ? 'd' : 'f') + ' ' + e.name).join('\n') || '(empty)';
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

function runReadFile(input: Record<string, unknown>): string {
  try {
    const abs = path.resolve(WORKSPACE_DIR, input.path as string);
    const content = fs.readFileSync(abs, 'utf-8');
    return content.length > 12000 ? content.slice(0, 12000) + '\n...(truncated)' : content;
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

// ── Participant registration ───────────────────────────────────────────────────

async function ensureParticipant(projectId: string): Promise<string> {
  const botName = `[sdk] ${WORKER_NAME}`;

  await supabase.from('rooms').upsert({ id: projectId, status: 'collecting' }, { onConflict: 'id' });

  const { data: existing } = await supabase
    .from('participants')
    .select('id')
    .eq('room_id', projectId)
    .eq('name', botName)
    .maybeSingle();

  if (existing?.id) return existing.id as string;

  const { data: created, error } = await supabase
    .from('participants')
    .insert({ room_id: projectId, name: botName, role: 'employee', color: '#a855f7' })
    .select('id')
    .single();

  if (error?.code === '23505') {
    const { data: refetched } = await supabase
      .from('participants').select('id').eq('room_id', projectId).eq('name', botName).maybeSingle();
    if (refetched?.id) return refetched.id as string;
  }

  if (!created?.id) throw new Error(`创建 participant 失败: ${error?.message}`);
  return created.id as string;
}

// ── Dedup check ───────────────────────────────────────────────────────────────

async function isProcessed(intentId: string, participantId: string): Promise<boolean> {
  const { data } = await supabase
    .from('synthesis_results')
    .select('id')
    .filter('attribution_map->>requirement_id', 'eq', intentId)
    .filter('attribution_map->>agent_id', 'eq', participantId)
    .maybeSingle();
  return !!data?.id;
}

// ── CLI generation (proxy mode) ───────────────────────────────────────────────

function generateViaCLI(content: string): Promise<SubmitResult> {
  const prompt = `你是一名顶级的产品设计师和前端工程师。根据以下需求，生成一个高质量的产品落地页 HTML。

## 需求
${content}

${HTML_SPEC}

请将生成结果以如下格式输出。标签内只放 JSON，标签外不要任何文字：

<generate_output>
{
  "html": "<完整的 <!DOCTYPE html> 文档>",
  "summary": "一句话描述生成了什么"
}
</generate_output>`;

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', prompt, '--model', 'claude-sonnet-4-6', '--output-format', 'json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      reject(new Error(err.code === 'ENOENT' ? 'claude CLI 未找到' : err.message));
    });

    proc.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(new Error(stderr.slice(0, 400) || `claude CLI exit ${code}`));
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
      const jsonStr = match?.[1] ?? text.match(/\{[\s\S]*"html"[\s\S]*\}/)?.[0];
      if (!jsonStr) { reject(new Error('CLI 输出中未找到有效 JSON')); return; }
      try {
        resolve(JSON.parse(jsonStr) as SubmitResult);
      } catch {
        reject(new Error('CLI 输出 JSON 解析失败'));
      }
    });
  });
}

// ── Agentic generation loop (SDK direct mode) ─────────────────────────────────

async function generateViaSDK(content: string): Promise<SubmitResult | null> {
  const prompt = `你是一名顶级的产品设计师和前端工程师。根据以下需求，生成一个高质量的产品落地页 HTML。

## 需求
${content}

${HTML_SPEC}

生成完成后，调用 submit_html 工具提交结果。`;

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];
  let submitted: SubmitResult | null = null;
  let round = 0;

  while (round < 10 && !submitted) {
    round++;

    const response = await anthropic!.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      tools: TOOLS,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    if (toolUses.length === 0) break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolUses) {
      const input = block.input as Record<string, unknown>;
      let result: string;

      if (block.name === 'list_files') {
        result = runListFiles(input);
        console.log(`[worker]   list_files: ${(input.dir as string) || '.'}`);
      } else if (block.name === 'read_file') {
        result = runReadFile(input);
        console.log(`[worker]   read_file: ${input.path as string} (${result.length} chars)`);
      } else if (block.name === 'submit_html') {
        submitted = { html: input.html as string, summary: input.summary as string };
        result = '已提交';
        console.log(`[worker]   submit_html: ${submitted.html.length} chars`);
      } else {
        result = `未知工具: ${block.name}`;
      }

      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
    }

    if (!submitted) {
      messages.push({ role: 'user', content: toolResults });
    }
  }

  return submitted;
}

// ── processRequirement ────────────────────────────────────────────────────────

async function processRequirement(
  intentId: string,
  content: string,
  projectId: string,
  participantId: string,
): Promise<void> {
  console.log(`[worker] → intent ${intentId.slice(0, 8)} "${content.slice(0, 80)}" [${USE_CLI_MODE ? 'cli' : 'sdk'}]`);

  let submitted: SubmitResult | null = null;
  try {
    if (USE_CLI_MODE) {
      submitted = await generateViaCLI(content);
    } else {
      submitted = await generateViaSDK(content);
    }
  } catch (err) {
    console.error(`[worker] ✗ 生成失败 ${intentId.slice(0, 8)}: ${(err as Error).message}`);
    return;
  }

  if (!submitted) {
    console.warn(`[worker] ✗ intent ${intentId.slice(0, 8)} — 未产生输出`);
    return;
  }

  console.log(`[worker]   html=${submitted.html.length}chars summary="${submitted.summary}"`);

  const { data: row, error } = await supabase
    .from('synthesis_results')
    .insert({
      room_id: projectId,
      round: 1,
      html_content: submitted.html,
      attribution_map: {
        agent_id: participantId,
        agent_name: WORKER_NAME,
        role_description: 'Agent SDK Worker',
        requirement_id: intentId,
        summary: submitted.summary,
      },
      conflicts_resolved: null,
    })
    .select('id')
    .single();

  if (error) {
    console.error(`[worker] ✗ DB 写入失败 ${intentId.slice(0, 8)}: ${error.message}`);
  } else {
    console.log(`[worker] ✓ 提交完成 submissionId=${row.id} intentId=${intentId.slice(0, 8)}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[worker] 启动 project=${WORKER_PROJECT} name="${WORKER_NAME}" workspace=${WORKSPACE_DIR}`);

  const participantId = await ensureParticipant(WORKER_PROJECT);
  console.log(`[worker] participant=${participantId}`);

  // 处理启动前已存在的未处理需求
  const { data: backlog } = await supabase
    .from('intents')
    .select('id, content')
    .eq('room_id', WORKER_PROJECT)
    .in('section', ['__REQ__', '__REQ_H__', '__REQ_U__'])
    .order('created_at', { ascending: true });

  let backlogCount = 0;
  for (const intent of (backlog ?? []) as Array<{ id: string; content: string }>) {
    if (await isProcessed(intent.id, participantId)) continue;
    backlogCount++;
    await processRequirement(intent.id, intent.content, WORKER_PROJECT, participantId);
  }
  if (backlogCount === 0) console.log('[worker] 无待处理积压需求');

  // 订阅新需求
  const channel = supabase
    .channel(`worker:${WORKER_PROJECT}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'intents',
        filter: `room_id=eq.${WORKER_PROJECT}`,
      },
      async (payload) => {
        const intent = payload.new as { id: string; content: string; section: string };
        if (!['__REQ__', '__REQ_H__', '__REQ_U__'].includes(intent.section)) return;
        if (await isProcessed(intent.id, participantId)) return;
        await processRequirement(intent.id, intent.content, WORKER_PROJECT, participantId);
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`[worker] ✓ realtime 已连接，监听 ${WORKER_PROJECT} 新需求…`);
      } else {
        console.log(`[worker] realtime 状态: ${status}`);
      }
    });

  const shutdown = async () => {
    console.log('\n[worker] 正在关闭…');
    await channel.unsubscribe();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[worker] 致命错误:', err);
  process.exit(1);
});
