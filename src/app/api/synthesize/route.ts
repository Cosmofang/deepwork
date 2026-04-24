import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase-server';
import { ROLES } from '@/lib/roles';
import { Intent, Participant, RoleId } from '@/types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { roomId, intents } = await req.json() as {
    roomId: string;
    intents: (Intent & { participant: Participant })[];
  };

  const intentLines = intents
    .map(i => {
      const r = ROLES[i.participant?.role as RoleId];
      return `[${r?.label || '未知角色'}]: "${i.content}"`;
    })
    .join('\n');

  const prompt = `你是一个协作设计合成师。一个多角色团队共同表达了他们对产品落地页的意图，请将所有人的意图合成为一个统一的、高质量的 HTML 落地页。

团队意图：
${intentLines}

要求：
1. 生成完整的 HTML 落地页，使用内联 Tailwind CSS（通过 CDN 引入）
2. 页面要专业、现代、视觉效果好，可直接展示
3. 每个主要 section 必须加上 data-source 属性，值为该 section 主要来自的角色英文 ID：
   designer / copywriter / developer / product / marketing / employee
4. 智能处理冲突（如风格冲突），保留各方核心意图，并记录解决方式
5. 所有人的关键意图都要在产物中体现

返回严格 JSON（不要有任何其他文字）：
{
  "html": "<!DOCTYPE html>...",
  "attributionMap": {
    "section描述": "roleId"
  },
  "conflictsDetected": ["冲突描述"],
  "conflictsResolved": ["解决方式"]
}`;

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = (message.content[0] as { type: string; text: string }).text;

  let output: {
    html: string;
    attributionMap: Record<string, string>;
    conflictsDetected: string[];
    conflictsResolved: string[];
  };

  try {
    output = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json({ error: 'Invalid response from Claude' }, { status: 500 });
    }
    output = JSON.parse(match[0]);
  }

  const supabase = createClient();

  const { count } = await supabase
    .from('synthesis_results')
    .select('*', { count: 'exact', head: true })
    .eq('room_id', roomId);

  const { error } = await supabase.from('synthesis_results').insert({
    room_id: roomId,
    round: (count ?? 0) + 1,
    html_content: output.html,
    attribution_map: output.attributionMap,
    conflicts_resolved: output.conflictsResolved,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from('rooms').update({ status: 'done' }).eq('id', roomId);

  return NextResponse.json({ success: true });
}
