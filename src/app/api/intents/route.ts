import { NextRequest, NextResponse } from 'next/server';
import { normalizeSectionName } from '@/lib/sections';
import { syncRoomStateToWorkspace } from '@/lib/room-state';
import { createClient, getSupabaseServerConfigStatus } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    roomId?: string;
    participantId?: string;
    section?: string;
    content?: string;
  };

  const roomId = body.roomId?.trim().toUpperCase();
  const participantId = body.participantId?.trim();
  const content = body.content?.trim();
  const section = normalizeSectionName(body.section || '');

  if (!roomId || !participantId || !content) {
    return NextResponse.json({ error: 'Invalid intent request' }, { status: 400 });
  }

  const configStatus = getSupabaseServerConfigStatus();
  if (!configStatus.ready) {
    return NextResponse.json(
      {
        error: 'Supabase server environment is not configured',
        missing: {
          NEXT_PUBLIC_SUPABASE_URL: !configStatus.hasUrl,
          SUPABASE_SERVICE_ROLE_KEY: !configStatus.hasServiceRoleKey,
        },
        hint: 'Create .env.local from .env.local.example and set real Supabase values before submitting intents.',
      },
      { status: 503 }
    );
  }

  const supabase = createClient();
  const { data: participant } = await supabase
    .from('participants')
    .select('id, name, role, room_id')
    .eq('id', participantId)
    .maybeSingle();

  if (!participant || participant.room_id !== roomId) {
    return NextResponse.json({ error: 'Participant does not belong to room' }, { status: 403 });
  }

  await supabase
    .from('room_sections')
    .upsert(
      {
        room_id: roomId,
        name: section,
        created_by: participantId,
      },
      { onConflict: 'room_id,name' }
    );

  const { data: intent, error } = await supabase
    .from('intents')
    .insert({
      room_id: roomId,
      participant_id: participantId,
      section,
      content,
    })
    .select()
    .single();

  if (error || !intent) {
    return NextResponse.json({ error: error?.message || 'Insert failed' }, { status: 500 });
  }

  await syncRoomStateToWorkspace(roomId, {
    type: 'intent_created',
    participantId,
    participantName: participant?.name,
    role: participant?.role,
    section,
    summary: content,
    content,
  });

  return NextResponse.json({ intent });
}
