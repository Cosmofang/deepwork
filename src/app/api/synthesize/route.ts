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
    const prompt = isIteration
      ? `你是一个多角色协作设计合成师。这是第 ${currentRound} 轮迭代合成，你的任务是在上一轮产物基础上，重点处理本轮新增意图，生成更新后的产品落地页 HTML。
${iterationContext}
## 本轮所有意图（标注了「本轮新增」的是新增加的）
${intentLines}

## HTML 生成规范

### 技术要求（严格遵守）
- 生成完整的 <!DOCTYPE html> HTML 文件，**不使用任何外部 CSS/JS 框架或 CDN**
- 所有样式必须写在 <head> 内的 <style> 标签中，使用标准 CSS
- 不得有任何外部 <script src> 或 <link rel="stylesheet">（会在 iframe 沙盒中失效）
- 使用 CSS 自定义属性（变量）管理颜色/间距，便于维护

### 视觉风格
- 背景：#0a0a0a 或 #111111（深色）
- 文字：主色 #ffffff，次色 rgba(255,255,255,0.6)，弱色 rgba(255,255,255,0.3)
- 强调色：#a855f7（紫）、#3b82f6（蓝）、#22c55e（绿）可用于按钮/高亮
- 字体：font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
- 使用 CSS Grid 和 Flexbox 布局，不用浮动
- 卡片：border: 1px solid rgba(255,255,255,0.1)，背景 rgba(255,255,255,0.04)，圆角 12px
- 按钮（主要）：background: #ffffff; color: #000; padding: 12px 28px; border-radius: 8px
- 足够的 padding 和 section 间距（section padding: 80px 0 最少）

### 结构要求
- 每个视觉区块是独立的 <section> 标签
- **关键要求**：每个 <section> 必须携带 data-source 属性，值为对该区块贡献最多的角色 ID
  - 合法值：designer | copywriter | developer | product | marketing | employee
  - 示例：<section data-source="designer" style="...">
- 区块顺序：Hero → 价值主张 → 功能亮点 → 社交证明 → 定价 → FAQ → CTA
- 页面需有 <header>（含导航/logo）和 <footer>（含版权信息）
- 文案全部用中文

### 「整体」板块意图处理
- 板块标注为「整体」的意图代表对**整个页面**的全局要求（如整体风格、品牌调性、整体可信度等）
- 这些意图**不对应某个特定 section**，而应体现在页面的多处：整体配色、footer 信息、header 设计、视觉语言等
- 贡献「整体」意图的角色在 attributionMap 中可记录为「整体风格」key，data-source 可赋给 <header> 或 <footer>

### 冲突处理
- 若同一板块存在矛盾意图，优先找折中方案，记录解决方式

### 归因规则
- attributionMap 中每个 key 为区块标题（如「首屏 Hero」），value 为贡献最多的角色 ID

### 最终自检（输出 HTML 前必须执行）
完成 HTML 生成后，逐一扫描所有 <section> 标签，确认：
1. 每个 <section> 都有 data-source 属性
2. 属性值是以下 6 个合法角色 ID 之一：designer | copywriter | developer | product | marketing | employee
3. attributionMap 的 key 数量与页面中有意义的 <section> 数量大致匹配
若发现任何缺失或非法值，**就地修正后再填入 generate_landing_page 工具参数** — 不得省略此步骤`
      : `你是一个多角色协作设计合成师。你的任务是将一个团队的意图合成为一个高质量产品落地页 HTML。

## 团队意图（按板块分组）
${intentLines}

## HTML 生成规范

### 技术要求（严格遵守）
- 生成完整的 <!DOCTYPE html> HTML 文件，**不使用任何外部 CSS/JS 框架或 CDN**
- 所有样式必须写在 <head> 内的 <style> 标签中，使用标准 CSS
- 不得有任何外部 <script src> 或 <link rel="stylesheet">（会在 iframe 沙盒中失效）
- 使用 CSS 自定义属性（变量）管理颜色/间距，便于维护

### 视觉风格
- 背景：#0a0a0a 或 #111111（深色）
- 文字：主色 #ffffff，次色 rgba(255,255,255,0.6)，弱色 rgba(255,255,255,0.3)
- 强调色：#a855f7（紫）、#3b82f6（蓝）、#22c55e（绿）可用于按钮/高亮
- 字体：font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
- 使用 CSS Grid 和 Flexbox 布局，不用浮动
- 卡片：border: 1px solid rgba(255,255,255,0.1)，背景 rgba(255,255,255,0.04)，圆角 12px
- 按钮（主要）：background: #ffffff; color: #000; padding: 12px 28px; border-radius: 8px
- 足够的 padding 和 section 间距（section padding: 80px 0 最少）

### 结构要求
- 每个视觉区块是独立的 <section> 标签
- **关键要求**：每个 <section> 必须携带 data-source 属性，值为对该区块贡献最多的角色 ID
  - 合法值：designer | copywriter | developer | product | marketing | employee
  - 示例：<section data-source="designer" style="...">
- 区块顺序：Hero → 价值主张 → 功能亮点 → 社交证明 → 定价 → FAQ → CTA
- 页面需有 <header>（含导航/logo）和 <footer>（含版权信息）
- 文案全部用中文

### 「整体」板块意图处理
- 板块标注为「整体」的意图代表对**整个页面**的全局要求（如整体风格、品牌调性、整体可信度等）
- 这些意图**不对应某个特定 section**，而应体现在页面的多处：整体配色、footer 信息、header 设计、视觉语言等
- 贡献「整体」意图的角色在 attributionMap 中可记录为「整体风格」key，data-source 可赋给 <header> 或 <footer>

### 冲突处理
- 若同一板块存在矛盾意图，优先找折中方案，记录解决方式

### 归因规则
- attributionMap 中每个 key 为区块标题（如「首屏 Hero」），value 为贡献最多的角色 ID

### 最终自检（输出 HTML 前必须执行）
完成 HTML 生成后，逐一扫描所有 <section> 标签，确认：
1. 每个 <section> 都有 data-source 属性
2. 属性值是以下 6 个合法角色 ID 之一：designer | copywriter | developer | product | marketing | employee
3. attributionMap 的 key 数量与页面中有意义的 <section> 数量大致匹配
若发现任何缺失或非法值，**就地修正后再填入 generate_landing_page 工具参数** — 不得省略此步骤`;

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
