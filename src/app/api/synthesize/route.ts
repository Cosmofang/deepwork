import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

// Vercel: allow up to 120s for Claude synthesis (default is 10s)
export const maxDuration = 120;
import { createClient } from '@/lib/supabase-server';
import { syncRoomStateToWorkspace } from '@/lib/room-state';
import { ROLES } from '@/lib/roles';
import { DEFAULT_SECTION, normalizeSectionName } from '@/lib/sections';
import { RoleId } from '@/types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { roomId } = await req.json() as {
    roomId: string;
  };
  const normalizedRoomId = roomId.trim().toUpperCase();
  const supabase = createClient();

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

  await syncRoomStateToWorkspace(normalizedRoomId, {
    type: 'synthesis_started',
    summary: '开始合成最新共享结果',
  });

  const intentLines = intents
    .map(i => {
      const r = ROLES[i.participant?.role as RoleId];
      const section = normalizeSectionName(i.section || DEFAULT_SECTION);
  return `[${r?.label || '未知角色'}][板块: ${section}]: "${i.content}"`;
    })
    .join('\n');

  try {
    const prompt = `你是一个多角色协作设计合成师。你的任务是将一个团队的意图合成为一个高质量产品落地页 HTML。

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

### 冲突处理
- 若同一板块存在矛盾意图，优先找折中方案，记录解决方式

### 归因规则
- attributionMap 中每个 key 为区块标题（如「首屏 Hero」），value 为贡献最多的角色 ID

## 输出格式

返回严格的 JSON（禁止 markdown 代码块，禁止任何前缀文字，直接从 { 开始）：
{
  "html": "<!DOCTYPE html>...",
  "attributionMap": {
    "首屏 Hero": "designer",
    "价值主张": "copywriter"
  },
  "conflictsDetected": ["冲突描述"],
  "conflictsResolved": ["解决方式"]
}`;

    const timeoutMs = 90_000;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    let message: Awaited<ReturnType<typeof anthropic.messages.create>>;
    try {
      message = await anthropic.messages.create(
        {
          model: 'claude-opus-4-7',
          max_tokens: 16000,
          messages: [{ role: 'user', content: prompt }],
        },
        { signal: controller.signal }
      );
    } finally {
      clearTimeout(timeoutHandle);
    }

    const text = (message.content[0] as { type: string; text: string }).text;

    type SynthesisOutput = {
      html: string;
      attributionMap: Record<string, string>;
      conflictsDetected: string[];
      conflictsResolved: string[];
    };

    let output: SynthesisOutput | null = null;

    try {
      output = JSON.parse(text) as SynthesisOutput;
    } catch {
      // Find the outermost JSON object by tracking brace depth
      let start = text.indexOf('{');
      while (start !== -1 && output === null) {
        let depth = 0;
        let end = start;
        for (let i = start; i < text.length; i++) {
          if (text[i] === '{') depth++;
          else if (text[i] === '}') {
            depth--;
            if (depth === 0) { end = i; break; }
          }
        }
        try {
          output = JSON.parse(text.slice(start, end + 1)) as SynthesisOutput;
        } catch {
          start = text.indexOf('{', start + 1);
        }
      }
    }

    if (!output) {
      await supabase.from('rooms').update({ status: 'collecting' }).eq('id', normalizedRoomId);
      return NextResponse.json({ error: 'Invalid response from Claude' }, { status: 500 });
    }

    const { count } = await supabase
      .from('synthesis_results')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', normalizedRoomId);

    const { error } = await supabase.from('synthesis_results').insert({
      room_id: normalizedRoomId,
      round: (count ?? 0) + 1,
      html_content: output.html,
      attribution_map: output.attributionMap,
      conflicts_resolved: output.conflictsResolved,
    });

    if (error) {
      await supabase.from('rooms').update({ status: 'collecting' }).eq('id', normalizedRoomId);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabase.from('rooms').update({ status: 'done' }).eq('id', normalizedRoomId);
    await syncRoomStateToWorkspace(normalizedRoomId, {
      type: 'synthesis_completed',
      round: (count ?? 0) + 1,
      summary: `Round ${(count ?? 0) + 1} 已完成合成`,
    });

    return NextResponse.json({ success: true });
  } catch {
    await supabase.from('rooms').update({ status: 'collecting' }).eq('id', normalizedRoomId);
    return NextResponse.json({ error: 'Synthesis failed' }, { status: 500 });
  }
}
