import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'child_process';
import { createClient, getSupabaseServerConfigStatus } from '@/lib/supabase-server';

export const maxDuration = 130;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
});

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

type GenerateOutput = { html: string; summary: string };

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    projectId?: string;
    requirementId?: string;
    agentId?: string;
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

  const supabase = createClient();

  const { data: requirement } = await supabase
    .from('requirements')
    .select('*')
    .eq('id', requirementId)
    .eq('project_id', projectId)
    .maybeSingle();

  if (!requirement) {
    return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });
  }

  // Check if this agent already submitted for this requirement
  const { data: existing } = await supabase
    .from('submissions')
    .select('id')
    .eq('requirement_id', requirementId)
    .eq('agent_id', agentId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: 'Already submitted for this requirement', submissionId: existing.id }, { status: 409 });
  }

  // Mark agent as working
  await supabase.from('agents').update({ status: 'working', last_seen_at: new Date().toISOString() }).eq('id', agentId);

  const prompt = `你是一名顶级的产品设计师和前端工程师。根据以下项目需求，独立生成一个高质量的产品落地页 HTML。

## 需求
${requirement.content}

${HTML_SPEC}`;

  const timeoutMs = 105_000;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  const useCliMode = !!process.env.ANTHROPIC_BASE_URL;
  let output: GenerateOutput | null = null;

  try {
    if (useCliMode) {
      const cliPrompt = prompt + `

---

请将生成结果以如下格式输出。标签内只放 JSON，标签外不要任何文字：

<generate_output>
{
  "html": "<完整的 <!DOCTYPE html> 文档>",
  "summary": "一句话描述生成了什么"
}
</generate_output>`;

      output = await new Promise<GenerateOutput>((resolve, reject) => {
        if (controller.signal.aborted) {
          reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }));
          return;
        }

        const proc = spawn('claude', ['-p', cliPrompt], { stdio: ['ignore', 'pipe', 'pipe'] });
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
          const match = stdout.match(/<generate_output>\s*([\s\S]*?)\s*<\/generate_output>/);
          const jsonStr = match ? match[1] : stdout.match(/\{[\s\S]*\}/)?.[0];
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
            },
            required: ['html', 'summary'],
          },
        },
      ] as Parameters<typeof anthropic.messages.create>[0]['tools'];

      const message = await anthropic.messages.create(
        {
          model: 'claude-opus-4-7',
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

  // Reset agent status
  await supabase.from('agents').update({ status: 'idle', last_seen_at: new Date().toISOString() }).eq('id', agentId);

  if (!output?.html) {
    return NextResponse.json({ error: 'Generation failed: no HTML output' }, { status: 500 });
  }

  const { data: submission, error: insertError } = await supabase
    .from('submissions')
    .insert({
      project_id: projectId,
      requirement_id: requirementId,
      agent_id: agentId,
      html_content: output.html,
      summary: output.summary ?? '',
    })
    .select()
    .single();

  if (insertError || !submission) {
    return NextResponse.json({ error: insertError?.message ?? 'Submission insert failed' }, { status: 500 });
  }

  return NextResponse.json({ submission });
}
