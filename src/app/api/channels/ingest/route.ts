import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseServerConfigStatus } from '@/lib/supabase-server';

// Channel → display color mapping (visible on the panel)
const CHANNEL_COLORS: Record<string, string> = {
  claude:   '#8b5cf6',  // purple
  openclaw: '#f59e0b',  // amber
  hermes:   '#10b981',  // emerald
  telegram: '#0ea5e9',  // sky
  feishu:   '#3b82f6',  // blue
};

const PRIORITY_SECTION: Record<string, string> = {
  normal:    '__REQ__',
  important: '__REQ_H__',
  urgent:    '__REQ_U__',
};

const PRIORITY_WEIGHT: Record<string, number> = {
  normal: 50, important: 75, urgent: 100,
};

// Sources that require panel confirmation before becoming active requirements
const PENDING_SOURCES = new Set(['skill', 'agent', 'openclaw', 'hermes', 'auto']);

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    projectCode?: string;
    content?: string;
    channel?: string;
    senderName?: string;
    priority?: string;
    source?: string;
  };

  const projectCode = body.projectCode?.trim().toUpperCase();
  const content = body.content?.trim();
  const channel = (body.channel?.toLowerCase() ?? 'claude').replace(/[^a-z0-9_-]/g, '');
  const senderName = (body.senderName?.trim() ?? '').slice(0, 80);
  const priority = (['normal', 'important', 'urgent'].includes(body.priority ?? '') ? body.priority : 'normal') as 'normal' | 'important' | 'urgent';
  const source = body.source?.toLowerCase() ?? channel;
  const needsConfirm = PENDING_SOURCES.has(source);

  if (!projectCode || !content) {
    return NextResponse.json({ error: 'projectCode and content are required' }, { status: 400 });
  }
  if (content.length > 2000) {
    return NextResponse.json({ error: 'content too long (max 2000 chars)' }, { status: 400 });
  }

  const configStatus = getSupabaseServerConfigStatus();
  if (!configStatus.ready) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const supabase = createClient();

  // Upsert room
  const { error: roomErr } = await supabase
    .from('rooms')
    .upsert({ id: projectCode, status: 'collecting' }, { onConflict: 'id' });
  if (roomErr) {
    return NextResponse.json({ error: roomErr.message }, { status: 500 });
  }

  // Bot participant name — deterministic so the same bot reuses the same row
  const botName = senderName
    ? `[${channel}] ${senderName}`
    : `[${channel}]`;
  const color = CHANNEL_COLORS[channel] ?? '#6366f1';

  // Find existing bot participant for this channel in this room
  const { data: existing } = await supabase
    .from('participants')
    .select('id')
    .eq('room_id', projectCode)
    .eq('name', botName)
    .maybeSingle();

  let participantId: string;
  if (existing?.id) {
    participantId = existing.id as string;
  } else {
    const { data: created, error: createErr } = await supabase
      .from('participants')
      .insert({ room_id: projectCode, name: botName, role: 'product', color })
      .select('id')
      .single();
    if (createErr) {
      // Unique violation (23505) = concurrent request beat us; re-fetch the row
      if (createErr.code === '23505') {
        const { data: refetched } = await supabase
          .from('participants').select('id').eq('room_id', projectCode).eq('name', botName).maybeSingle();
        if (!refetched?.id) {
          return NextResponse.json({ error: 'Participant creation conflict' }, { status: 500 });
        }
        participantId = refetched.id as string;
      } else {
        return NextResponse.json({ error: createErr.message }, { status: 500 });
      }
    } else if (!created) {
      return NextResponse.json({ error: 'Participant creation failed' }, { status: 500 });
    } else {
      participantId = created.id as string;
    }
  }

  // Insert the requirement — pending sources use __REQ_PENDING__ until confirmed
  const section = needsConfirm ? '__REQ_PENDING__' : (PRIORITY_SECTION[priority] ?? '__REQ__');
  const { data: intent, error: intentErr } = await supabase
    .from('intents')
    .insert({ room_id: projectCode, participant_id: participantId, section, content })
    .select('id, created_at')
    .single();

  if (intentErr || !intent) {
    return NextResponse.json({ error: intentErr?.message ?? 'Insert failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    requirementId: intent.id,
    projectId: projectCode,
    participantId,
    channel,
    priority,
    weight: needsConfirm ? 0 : (PRIORITY_WEIGHT[priority] ?? 50),
    pending: needsConfirm,
    createdAt: intent.created_at,
  });
}
