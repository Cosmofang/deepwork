import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

// Vercel: allow up to 120s for Claude synthesis (default is 10s)
export const maxDuration = 120;
import { createClient, getSupabaseServerConfigStatus } from '@/lib/supabase-server';
import { syncRoomStateToWorkspace, RoomStateEvent } from '@/lib/room-state';
import { ROLES } from '@/lib/roles';
import { DEFAULT_SECTION, normalizeSectionName } from '@/lib/sections';
import { RoleId } from '@/types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
});

export async function POST(req: NextRequest) {
  const { roomId } = await req.json() as {
    roomId: string;
  };
  const normalizedRoomId = roomId.trim().toUpperCase();

  const configStatus = getSupabaseServerConfigStatus();
  if (!configStatus.ready) {
    return NextResponse.json(
      {
        error: 'Supabase server environment is not configured',
        missing: {
          NEXT_PUBLIC_SUPABASE_URL: !configStatus.hasUrl,
          SUPABASE_SERVICE_ROLE_KEY: !configStatus.hasServiceRoleKey,
        },
        hint: 'Create .env.local from .env.local.example and set real Supabase values before synthesis.',
      },
      { status: 503 }
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error: 'Anthropic API key is not configured',
        missing: { ANTHROPIC_API_KEY: true },
        hint: 'Set ANTHROPIC_API_KEY in .env.local before running synthesis.',
      },
      { status: 503 }
    );
  }

  const supabase = createClient();

  const recordSynthesisFailure = async (summary: string) => {
    await syncRoomStateToWorkspace(normalizedRoomId, {
      type: 'summary.updated',
      section: '合成流程',
      summary,
    }).catch(() => null);
  };

  const { data: lockedRoom, error: lockError } = await supabase
    .from('rooms')
    .update({ status: 'synthesizing' })
    .eq('id', normalizedRoomId)
    .neq('status', 'synthesizing')
    .select('*')
    .maybeSingle();

  if (lockError) {
    return NextResponse.json({ error: lockError.message }, { status: 500 });
  }

  if (!lockedRoom) {
    return NextResponse.json({ error: 'Room is already synthesizing or missing' }, { status: 409 });
  }

  const { data: intents } = await supabase
    .from('intents')
    .select('*, participant:participants(*)')
    .eq('room_id', normalizedRoomId)
    .order('created_at', { ascending: true });

  if (!intents || intents.length === 0) {
    await supabase.from('rooms').update({ status: 'collecting' }).eq('id', normalizedRoomId);
    return NextResponse.json({ error: 'No intents found' }, { status: 400 });
  }

  // Fetch previous synthesis result BEFORE the Anthropic call so we can:
  // 1. Know the current round number (for intent tagging and prompt context)
  // 2. Use previous attribution map to guide incremental synthesis
  // 3. Tag intents submitted after the previous synthesis as "new this round"
  // 4. Extract the <style> block to preserve exact CSS variables across rounds
  const { data: prevResults } = await supabase
    .from('synthesis_results')
    .select('round, created_at, attribution_map, conflicts_resolved, html_content')
    .eq('room_id', normalizedRoomId)
    .order('round', { ascending: false })
    .limit(1);

  const prevResult = prevResults?.[0] ?? null;
  const currentRound = (prevResult?.round ?? 0) + 1;
  const isIteration = currentRound > 1;
  const prevSynthesisAt = prevResult?.created_at ? new Date(prevResult.created_at as string) : null;

  await syncRoomStateToWorkspace(normalizedRoomId, {
    type: 'synthesis_started',
    summary: isIteration ? `开始第 ${currentRound} 轮迭代合成` : '开始合成最新共享结果',
  }).catch(() => null);

  const buildIntentLine = (i: typeof intents[0], isNew: boolean) => {
    const r = ROLES[i.participant?.role as RoleId];
    const section = normalizeSectionName(i.section || DEFAULT_SECTION);
    const tag = isNew ? '【本轮新增】' : '';
    return `${tag}[${r?.label || '未知角色'}][板块: ${section}]: "${i.content}"`;
  };

  const newIntents = prevSynthesisAt
    ? intents.filter(i => new Date(i.created_at as string) > prevSynthesisAt)
    : intents;
  const prevIntents = prevSynthesisAt
    ? intents.filter(i => new Date(i.created_at as string) <= prevSynthesisAt)
    : [];

  const intentLines = [
    ...prevIntents.map(i => buildIntentLine(i, false)),
    ...newIntents.map(i => buildIntentLine(i, true)),
  ].join('\n');

  // Extract the <style> block from previous HTML, capped at 8000 chars.
  // This gives Claude the exact CSS variable names and values from Round 1
  // so Round 2 inherits the same design token system instead of reinventing it.
  const extractStyleBlock = (html: string): string => {
    const start = html.indexOf('<style');
    if (start === -1) return '';
    const end = html.indexOf('</style>', start);
    if (end === -1) return '';
    const block = html.slice(start, end + 8);
    return block.length > 8000 ? block.slice(0, 8000) + '\n/* [截断] */' : block;
  };

  const prevStyleBlock = isIteration && prevResult?.html_content
    ? extractStyleBlock(prevResult.html_content as string)
    : '';

  const iterationContext = isIteration && prevResult
    ? `
## 上一轮合成结论（第 ${currentRound - 1} 轮，请在此基础上迭代）

### 上一轮 CSS 设计令牌（必须直接复用，不得修改变量名）
${prevStyleBlock || '（无法提取，请自行保持与上轮一致的视觉风格）'}

### 上一轮归因摘要
${JSON.stringify(prevResult.attribution_map, null, 2)}

### 上一轮已解决的冲突
${((prevResult.conflicts_resolved as string[]) ?? []).map(c => `- ${c}`).join('\n') || '（无冲突）'}

**迭代要求**：
- 优先处理标注「本轮新增」的意图，这些是本轮迭代的重点
- **必须**直接复用上方 CSS 的 :root 变量定义，不要重新定义或改变变量名
- 若新增意图与已解决冲突有出入，以新意图为准并记录变化
- 上一轮没有被本轮意图涉及的板块可以保留原有内容和样式
`
    : '';

  try {
    // Shared generation spec appended to both R1 and iteration prompts
  const HTML_SPEC = `
## HTML 生成规范

### 技术要求（严格遵守）
- 生成完整的 <!DOCTYPE html> HTML 文件，**不使用任何外部 CSS/JS 框架或 CDN**
- 所有样式写在 <head> 内的 <style> 标签，使用标准 CSS + CSS 自定义属性管理颜色/间距
- 所有交互 JS 写在 </body> 前的 <script> 标签，**不得有任何外部 <script src> 或 <link rel="stylesheet">**（iframe 沙盒中会失效）

### 视觉风格 — 现代 SaaS 深色旗舰风（类 Linear / Vercel / Loom）
- 背景：#080808（近黑）为基底；Hero 用多色 radial-gradient 做氛围光晕
- 主文字：#ffffff；次文字：rgba(255,255,255,0.55)；弱文字：rgba(255,255,255,0.28)
- 主强调色：#a855f7（紫）；辅色：#3b82f6（蓝）、#22c55e（绿）
- 字体：-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif
- 字号层级：Hero 标题 56–72px、section 标题 36–44px、正文 16–18px、标签 12–13px
- 布局：CSS Grid + Flexbox；section padding-block 最少 100px；最大宽度 1100px，水平居中
- 卡片：background rgba(255,255,255,0.03)；border 1px solid rgba(255,255,255,0.08)；border-radius 16px；backdrop-filter blur(8px)
- 主按钮：background #fff；color #000；padding 13px 30px；border-radius 10px；font-weight 600
- 渐变按钮（可选）：background linear-gradient(135deg,#a855f7,#3b82f6)；color #fff；同上尺寸
- **视觉亮点**：Hero 背景必须有动态光晕（CSS @keyframes，见动画规范）

### 动画与交互（写入 </body> 前的 <script>，所有代码用单引号，无外部依赖）
必须实现以下四项：

**① Hero 动态光晕背景**（纯 CSS，写在 <style> 里）：
\`\`\`css
/* 在 hero section 的 ::before 层叠两个模糊光球，用 @keyframes 缓慢漂移 */
@keyframes drift1 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(60px,-40px) scale(1.15)} }
@keyframes drift2 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-50px,30px) scale(0.9)} }
/* 在 .hero-bg::before 和 ::after 里应用 radial-gradient + animation */
\`\`\`

**② Scroll-reveal 淡入上移**（写在 <script> 里）：
\`\`\`js
// CSS: .reveal{opacity:0;transform:translateY(28px);transition:opacity .7s ease,transform .7s ease} .reveal.visible{opacity:1;transform:none}
// JS: IntersectionObserver threshold 0.12，进入视口时 classList.add('visible')
// 为所有 section、.feature-card、.testimonial、.pricing-card 添加 reveal 类
\`\`\`

**③ 数字计数动画**（写在 <script> 里）：
\`\`\`js
// 找出页面中形如 '2,000+'、'80%'、'3x' 的数字元素（带 data-count 属性）
// 进入视口时在 800ms 内从 0 计数到目标值，easeOutQuad
\`\`\`

**④ 卡片微交互**（写在 <style> 里）：
\`\`\`css
.feature-card { transition: transform .2s ease, box-shadow .2s ease; }
.feature-card:hover { transform: translateY(-6px); box-shadow: 0 24px 48px rgba(0,0,0,.4); }
/* Hero CTA 主按钮呼吸动画 */
@keyframes pulse { 0%,100%{box-shadow:0 0 0 0 rgba(168,85,247,.35)} 50%{box-shadow:0 0 0 12px rgba(168,85,247,0)} }
.btn-primary { animation: pulse 2.8s ease-in-out infinite; }
\`\`\`

### 结构要求
- 每个视觉区块是独立的 <section> 标签
- **关键要求**：每个 <section> 必须携带 data-source 属性，值为对该区块贡献最多的角色 ID
  - 合法值：designer | copywriter | developer | product | marketing | employee
  - 示例：<section data-source="designer">
- 标准区块顺序：Header（含 Nav）→ Hero → 价值主张 → 功能亮点 → 社交证明 → 定价 → FAQ → CTA → Footer
- <header> 含 logo/产品名 + 导航链接 + 一个次级 CTA 按钮（如「免费试用」）
- <footer> 含版权、链接、品牌色底栏
- 文案全部用中文；产品名称从意图中提取（若意图多次提及产品名则直接使用，否则可自拟）
- 数字统计元素（如「2,000+ 团队」）加 data-count 属性以触发计数动画

### 「整体」板块意图处理
- 板块标注为「整体」的意图代表对整个页面的全局要求（风格、品牌、可信度）
- 这些意图体现在整体配色、footer 内容、header 设计、视觉语言等多处
- 贡献「整体」意图的角色在 attributionMap 中记录为「整体风格」key，data-source 赋给 <header>

### 冲突处理
- 同一板块存在矛盾意图时，优先找折中方案，记录解决方式

### 归因规则
- attributionMap 每个 key 为区块标题，value 为贡献最多的角色 ID

### 最终自检（填入工具参数前必须执行）
逐一扫描所有 <section>，确认：
1. 每个 <section> 都有 data-source 属性，且值是合法角色 ID
2. attributionMap 的 key 数量与有意义的 <section> 数量大致匹配
3. <script> 块中四项动画均已实现（drift、reveal、countUp、hover/pulse）
若有缺失，**就地修正后再填入工具参数**`;

  const prompt = isIteration
      ? `你是一个多角色协作设计合成师。这是第 ${currentRound} 轮迭代合成，你的任务是在上一轮产物基础上，重点处理本轮新增意图，生成更新后的产品落地页 HTML。
${iterationContext}
## 本轮所有意图（标注了「本轮新增」的是新增加的）
${intentLines}
${HTML_SPEC}`
      : `你是一个多角色协作设计合成师。你的任务是将一个团队的意图合成为一个高质量产品落地页 HTML。

## 团队意图（按板块分组）
${intentLines}
${HTML_SPEC}`;

    type SynthesisOutput = {
      html: string;
      attributionMap: Record<string, string>;
      conflictsDetected: string[];
      conflictsResolved: string[];
    };

    const synthesisTools = [
      {
        name: 'generate_landing_page',
        description: 'Output the synthesized landing page HTML with attribution metadata',
        input_schema: {
          type: 'object' as const,
          properties: {
            html: { type: 'string', description: 'Complete <!DOCTYPE html> landing page with all styles inline' },
            attributionMap: {
              type: 'object',
              description: 'Map of section name to the role ID that contributed most',
              additionalProperties: { type: 'string' },
            },
            conflictsDetected: { type: 'array', items: { type: 'string' }, description: 'List of detected intent conflicts' },
            conflictsResolved: { type: 'array', items: { type: 'string' }, description: 'How each conflict was resolved' },
          },
          required: ['html', 'attributionMap', 'conflictsDetected', 'conflictsResolved'],
        },
      },
    ] as Parameters<typeof anthropic.messages.create>[0]['tools'];

    const timeoutMs = 90_000;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    let message: Awaited<ReturnType<typeof anthropic.messages.create>>;
    try {
      message = await anthropic.messages.create(
        {
          model: 'claude-sonnet-4-6',
          max_tokens: 16000,
          tools: synthesisTools,
          tool_choice: { type: 'tool', name: 'generate_landing_page' },
          messages: [{ role: 'user', content: prompt }],
        },
        { signal: controller.signal }
      );
    } finally {
      clearTimeout(timeoutHandle);
    }

    let output: SynthesisOutput | null = null;

    const toolBlock = message.content.find(b => b.type === 'tool_use');
    if (toolBlock && toolBlock.type === 'tool_use') {
      output = toolBlock.input as SynthesisOutput;
    } else {
      const textBlock = message.content.find(b => b.type === 'text');
      if (textBlock && textBlock.type === 'text') {
        try { output = JSON.parse(textBlock.text) as SynthesisOutput; } catch { /* */ }
      }
    }

    if (!output) {
      await recordSynthesisFailure('合成失败：Claude 返回内容无法解析为有效 JSON，房间已回到 collecting 状态。');
      await supabase.from('rooms').update({ status: 'collecting' }).eq('id', normalizedRoomId);
      return NextResponse.json({ error: 'Invalid response from Claude' }, { status: 500 });
    }

    const { error } = await supabase.from('synthesis_results').insert({
      room_id: normalizedRoomId,
      round: currentRound,
      html_content: output.html,
      attribution_map: output.attributionMap,
      conflicts_resolved: output.conflictsResolved,
    });

    if (error) {
      await supabase.from('rooms').update({ status: 'collecting' }).eq('id', normalizedRoomId);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabase.from('rooms').update({ status: 'done' }).eq('id', normalizedRoomId);

    const round = currentRound;

    // Batch synthesis_completed + artifact.updated + any unresolved conflict events into
    // one syncRoomStateToWorkspace call so loadSnapshot (5 Supabase queries) runs once
    // instead of twice, and conflict events go through toSemanticEventPayload properly.
    const unresolved = (output.conflictsDetected ?? []).filter(
      desc => !(output.conflictsResolved ?? []).some(r => r.includes(desc) || desc.includes(r))
    );
    const postSynthesisEvents: RoomStateEvent[] = [
      {
        type: 'synthesis_completed',
        round,
        summary: `Round ${round} 已完成合成`,
      },
      {
        type: 'artifact.updated',
        artifactType: 'html',
        artifactPath: `.deepwork/rooms/${normalizedRoomId}/latest.html`,
        attributionMap: output.attributionMap,
        summary: `Round ${round} HTML 产物已写入 .deepwork/rooms/${normalizedRoomId}/latest.html`,
      },
      ...unresolved.map((desc, i): RoomStateEvent => ({
        type: 'conflict.detected',
        conflictId: `synth-r${round}-c${i}`,
        sections: [],
        actorIds: [],
        summary: desc,
      })),
    ];
    await syncRoomStateToWorkspace(
      normalizedRoomId,
      postSynthesisEvents[postSynthesisEvents.length - 1],
      postSynthesisEvents.slice(0, -1)
    ).catch(() => null);

    return NextResponse.json({ success: true });
  } catch (err) {
    await recordSynthesisFailure(
      `合成失败：${err instanceof Error ? err.message.slice(0, 200) : '未知错误'}，房间已回到 collecting 状态。`
    );
    await supabase.from('rooms').update({ status: 'collecting' }).eq('id', normalizedRoomId);
    return NextResponse.json({ error: 'Synthesis failed' }, { status: 500 });
  }
}
